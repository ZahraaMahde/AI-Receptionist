import WebSocket from 'ws';
import { config } from './config.js';

const ELEVENLABS_WS_URL = 'wss://api.elevenlabs.io/v1/text-to-speech';

export function createTTSStream() {
  const voiceId = config.elevenlabs.voiceId;
  const wsUrl = `${ELEVENLABS_WS_URL}/${voiceId}/stream-input?model_id=eleven_turbo_v2_5&output_format=ulaw_8000`;

  let ws = null;
  let audioCallback = null;
  let isReady = false;
  let isClosed = false;
  let isConnecting = false;
  let textBuffer = '';
  let flushTimeout = null;

  function connect() {
    if (isClosed) return;
    if (isConnecting) return;
    if (ws && ws.readyState === WebSocket.OPEN) return;

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
          chunk_length_schedule: [120, 160, 250, 290],
        },
      }));

      isReady = true;
      isConnecting = false;

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
        }
      } catch (err) {
        console.error('[TTS] Parse error:', err.message);
      }
    });

    ws.on('error', (err) => {
      console.error('[TTS] WebSocket error:', err.message);
      isReady = false;
      isConnecting = false;
    });

    ws.on('close', (code, reason) => {
      console.log(`[TTS] WebSocket closed: ${code} ${reason?.toString() || ''}`);
      isReady = false;
      isConnecting = false;
      ws = null;

      if (!isClosed && textBuffer) {
        setTimeout(() => connect(), 100);
      }
    });
  }

  function canSend() {
    return !isClosed && isReady && ws && ws.readyState === WebSocket.OPEN;
  }

  function scheduleFlush(delay = 100) {
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
      scheduleFlush(150);
      return;
    }

    ws.send(JSON.stringify({
      text: textBuffer,
      try_trigger_generation: true,
    }));

    console.log(`[TTS] Sent: "${textBuffer.substring(0, 50)}..."`);
    textBuffer = '';
  }

  connect();

  return {
    sendText(text) {
      if (!text || isClosed) return;

      textBuffer += text;

      const sentenceEnd = /[.!?]\s*$/;
      const commaEnd = /,\s*$/;

      if (sentenceEnd.test(textBuffer) || textBuffer.length > 150) {
        flush();
      } else if (commaEnd.test(textBuffer) && textBuffer.length > 40) {
        flush();
      } else {
        scheduleFlush(100);
      }
    },

    finish() {
      clearTimeout(flushTimeout);

      if (textBuffer) {
        flush();
      }

      if (!canSend()) {
        console.warn('[TTS] Tried to finish, but WebSocket is not ready');
        return;
      }

      ws.send(JSON.stringify({ text: '' }));
      isReady = false;

      setTimeout(() => {
        if (!isClosed) {
          connect();
        }
      }, 150);
    },

    onAudio(callback) {
      audioCallback = callback;
    },

    interrupt() {
      clearTimeout(flushTimeout);
      textBuffer = '';

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
      }

      isReady = false;
      isConnecting = false;

      setTimeout(() => {
        if (!isClosed) {
          connect();
        }
      }, 100);
    },

    close() {
      isClosed = true;
      clearTimeout(flushTimeout);
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
