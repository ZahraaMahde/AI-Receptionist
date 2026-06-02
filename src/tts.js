import WebSocket from 'ws';
import { config } from './config.js';

const ELEVENLABS_WS_URL = 'wss://api.elevenlabs.io/v1/text-to-speech';

export function createTTSStream() {
  const voiceId = config.elevenlabs.voiceId;
  const wsUrl = `${ELEVENLABS_WS_URL}/${voiceId}/stream-input?model_id=eleven_turbo_v2_5&output_format=ulaw_8000`;

  let ws = null;
  let audioCallback = null;
  let finalCallback = null;
  let isReady = false;
  let isClosed = false;
  let isConnecting = false;
  let textBuffer = '';
  let flushTimeout = null;
  let reconnectTimer = null;
  let readyResolvers = [];

  function connect() {
    if (isClosed || isConnecting) return;
    if (ws && ws.readyState === WebSocket.OPEN) return;

    clearTimeout(reconnectTimer);
    reconnectTimer = null;

    isConnecting = true;
    isReady = false;

    ws = new WebSocket(wsUrl, {
      headers: {
        'xi-api-key': config.elevenlabs.apiKey,
      },
    });

    ws.on('open', () => {
      console.log('[TTS] ElevenLabs WebSocket connected');

      ws.send(JSON.stringify({
        text: ' ',
        xi_api_key: config.elevenlabs.apiKey,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          use_speaker_boost: true,
        },
        generation_config: {
          // Keep chunks small enough for low latency, but not so small that
          // the voice sounds broken or incomplete.
          chunk_length_schedule: [120, 160, 250, 290],
        },
      }));

      isReady = true;
      isConnecting = false;

      readyResolvers.forEach(({ resolve }) => resolve());
      readyResolvers = [];

      if (textBuffer) {
        scheduleFlush(30);
      }
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());

        if (message.audio) {
          console.log(`[TTS] Audio received: ${message.audio.length} chars`);

          const audioBuffer = Buffer.from(message.audio, 'base64');

          if (audioCallback) {
            audioCallback(audioBuffer);
          } else {
            console.warn('[TTS] Audio received but no audioCallback registered');
          }
        }

        if (message.error) {
          console.error('[TTS] ElevenLabs error:', message.error);
        }

        if (message.isFinal) {
          console.log('[TTS] Stream complete');
          if (finalCallback) finalCallback();
        }
      } catch (err) {
        console.error('[TTS] Parse error:', err.message);
      }
    });

    ws.on('error', (err) => {
      console.error('[TTS] WebSocket error:', err.message);
      isReady = false;
      isConnecting = false;

      readyResolvers.forEach(({ reject }) => reject(err));
      readyResolvers = [];
    });

    ws.on('close', (code, reason) => {
      console.log(`[TTS] WebSocket closed: ${code} ${reason?.toString() || ''}`);
      isReady = false;
      isConnecting = false;
      ws = null;

      // Safe warm reconnect: ElevenLabs stream-input normally closes after a
      // finalized response. Reconnect immediately after normal close so the
      // next turn usually has a ready socket, without skipping finalization.
      if (!isClosed) {
        scheduleReconnect(120);
      }
    });
  }

  function scheduleReconnect(delayMs = 120) {
    if (isClosed || reconnectTimer || isConnecting) return;

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delayMs);
  }

  function waitUntilReady(timeoutMs = 5000) {
    if (canSend()) return Promise.resolve();

    connect();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        readyResolvers = readyResolvers.filter((item) => item.resolve !== wrappedResolve);
        reject(new Error('[TTS] Timed out waiting for ElevenLabs WebSocket'));
      }, timeoutMs);

      function wrappedResolve() {
        clearTimeout(timeout);
        resolve();
      }

      function wrappedReject(err) {
        clearTimeout(timeout);
        reject(err);
      }

      readyResolvers.push({ resolve: wrappedResolve, reject: wrappedReject });
    });
  }

  function canSend() {
    return !isClosed && isReady && ws && ws.readyState === WebSocket.OPEN;
  }

  function scheduleFlush(delay = 90) {
    clearTimeout(flushTimeout);
    flushTimeout = setTimeout(() => {
      flush();
    }, delay);
  }

  function flush() {
    if (!textBuffer) return;

    if (!canSend()) {
      console.log('[TTS] WebSocket not ready, reconnecting before flush');
      connect();
      scheduleFlush(120);
      return;
    }

    const text = textBuffer;
    textBuffer = '';

    ws.send(JSON.stringify({
      text,
      try_trigger_generation: true,
    }));

    console.log(`[TTS] Sent: "${text.substring(0, 50)}..."`);
  }

  connect();

  return {
    sendText(text) {
      if (!text || isClosed) return;

      textBuffer += text;

      const sentenceEnd = /[.!?]\s*$/;
      const commaEnd = /,\s*$/;

      if (sentenceEnd.test(textBuffer) || textBuffer.length > 140) {
        flush();
      } else if (commaEnd.test(textBuffer) && textBuffer.length > 45) {
        flush();
      } else {
        scheduleFlush(90);
      }
    },

    async waitUntilReady(timeoutMs = 5000) {
      return waitUntilReady(timeoutMs);
    },

    async finish() {
      clearTimeout(flushTimeout);

      if (!canSend()) {
        try {
          await waitUntilReady();
        } catch (err) {
          console.warn(err.message || '[TTS] Tried to finish, but WebSocket is not ready');
          return;
        }
      }

      if (textBuffer) {
        flush();
      }

      if (!canSend()) {
        console.warn('[TTS] Tried to finish, but WebSocket is not ready');
        return;
      }

      // Important: this finalizes ElevenLabs generation. Without it, the last
      // part of a sentence can be delayed or never produced consistently.
      ws.send(JSON.stringify({ text: '' }));
      isReady = false;
    },

    onAudio(callback) {
      audioCallback = callback;
    },

    onFinal(callback) {
      finalCallback = callback;
    },

    interrupt() {
      clearTimeout(flushTimeout);
      textBuffer = '';

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close(1000, 'barge-in');
      }

      isReady = false;
      isConnecting = false;
      scheduleReconnect(80);
    },

    close() {
      isClosed = true;
      clearTimeout(flushTimeout);
      clearTimeout(reconnectTimer);
      textBuffer = '';

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
      }

      ws = null;
      isReady = false;
      isConnecting = false;
    },
  };
}

export async function synthesizeSpeech(text) {
  const start = Date.now();

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${config.elevenlabs.voiceId}?output_format=ulaw_8000`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': config.elevenlabs.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_turbo_v2_5',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`[TTS] ElevenLabs REST error ${response.status}: ${errorText}`);
  }

  const audioBuffer = Buffer.from(await response.arrayBuffer());

  console.log(`[TTS] One-shot synthesis in ${Date.now() - start}ms (${audioBuffer.length} bytes)`);

  return audioBuffer;
}
