import WebSocket from 'ws';
import { config } from './config.js';

export function createTTSStream() {
  const apiKey =
    config.elevenlabs?.apiKey ||
    config.elevenLabs?.apiKey ||
    process.env.ELEVENLABS_API_KEY;

  const voiceId =
    config.elevenlabs?.voiceId ||
    config.elevenLabs?.voiceId ||
    process.env.ELEVENLABS_VOICE_ID;

  const modelId =
    config.elevenlabs?.modelId ||
    config.elevenLabs?.modelId ||
    process.env.ELEVENLABS_MODEL_ID ||
    'eleven_flash_v2_5';

  const outputFormat =
    config.elevenlabs?.outputFormat ||
    config.elevenLabs?.outputFormat ||
    process.env.ELEVENLABS_OUTPUT_FORMAT ||
    'ulaw_8000';

  let ws = null;
  let isReady = false;
  let isClosedByUser = false;

  let audioHandler = null;
  let finalHandler = null;

  let readyResolvers = [];
  let finalResolvers = [];

  let keepAliveTimer = null;
  let reconnecting = false;
  let finishing = false;

  function connect() {
    if (
      ws &&
      (ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    isReady = false;

    const url =
      `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream-input` +
      `?model_id=${modelId}&output_format=${outputFormat}`;

    ws = new WebSocket(url);

    ws.on('open', () => {
      isReady = true;
      reconnecting = false;

      console.log('[TTS] ElevenLabs WebSocket connected');

      sendRaw({
        text: ' ',
        xi_api_key: apiKey,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.8,
        },
        generation_config: {
          chunk_length_schedule: [50, 80, 120],
        },
      });

      startKeepAlive();

      readyResolvers.forEach((resolve) => resolve());
      readyResolvers = [];
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());

        if (message.audio) {
          const audioBuffer = Buffer.from(message.audio, 'base64');

          console.log(`[TTS] Audio received: ${message.audio.length} chars`);

          if (audioHandler) {
            audioHandler(audioBuffer);
          }
        }

        if (message.isFinal || message.is_final) {
          console.log('[TTS] Stream complete');

          finishing = false;
          resolveFinals();

          if (finalHandler) {
            finalHandler();
          }
        }

        if (message.error) {
          handleElevenLabsError(message.error);
        }
      } catch (err) {
        console.error('[TTS] Message parse error:', err.message);
      }
    });

    ws.on('close', (code, reasonBuffer) => {
      const reason = reasonBuffer?.toString?.() || '';

      isReady = false;
      finishing = false;
      stopKeepAlive();

      console.log(`[TTS] WebSocket closed: ${code} ${reason}`);

      resolveFinals();

      if (isClosedByUser) {
        return;
      }

      if (
        code === 1008 ||
        reason.includes('input_timeout_exceeded') ||
        reason.includes('Have not received a new text input')
      ) {
        console.log('[TTS] ElevenLabs idle timeout — will reconnect on next text');
        return;
      }

      scheduleReconnect();
    });

    ws.on('error', (err) => {
      const message = err?.message || '';

      if (message.includes('input_timeout_exceeded')) {
        console.log('[TTS] ElevenLabs idle timeout — ignored');
        return;
      }

      console.error('[TTS] ElevenLabs error:', message);
    });
  }

  function handleElevenLabsError(error) {
    const message =
      typeof error === 'string'
        ? error
        : error?.message || JSON.stringify(error);

    if (message.includes('input_timeout_exceeded')) {
      console.log('[TTS] ElevenLabs idle timeout — ignored');
      return;
    }

    console.error('[TTS] ElevenLabs error:', message);
  }

  function scheduleReconnect() {
    if (reconnecting || isClosedByUser) return;

    reconnecting = true;

    setTimeout(() => {
      if (!isClosedByUser) {
        connect();
      }
    }, 250);
  }

  function sendRaw(payload) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    ws.send(JSON.stringify(payload));
    return true;
  }

  async function waitUntilReady() {
    if (ws?.readyState === WebSocket.OPEN && isReady) {
      return;
    }

    connect();

    return new Promise((resolve) => {
      readyResolvers.push(resolve);
    });
  }

  function startKeepAlive() {
    stopKeepAlive();

    keepAliveTimer = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN && !finishing) {
        sendRaw({ text: ' ' });
      }
    }, 15000);
  }

  function stopKeepAlive() {
    if (keepAliveTimer) {
      clearInterval(keepAliveTimer);
      keepAliveTimer = null;
    }
  }

  function resolveFinals() {
    finalResolvers.forEach((resolve) => resolve());
    finalResolvers = [];
  }

  connect();

  return {
    onAudio(handler) {
      audioHandler = handler;
    },

    onFinal(handler) {
      finalHandler = handler;
    },

    async waitUntilReady() {
      await waitUntilReady();
    },

    async sendText(text) {
      if (!text || !text.trim()) return;

      await waitUntilReady();

      const safeText = text.endsWith(' ') ? text : `${text} `;

      console.log(`[TTS] Sent: "${safeText.slice(0, 50)}..."`);

      sendRaw({
        text: safeText,
        try_trigger_generation: true,
      });
    },

    async finish() {
      await waitUntilReady();

      if (finishing) {
        return new Promise((resolve) => {
          finalResolvers.push(resolve);
        });
      }

      finishing = true;

      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          finishing = false;
          resolveFinals();
          resolve();
        }, 700);

        finalResolvers.push(() => {
          clearTimeout(timeout);
          finishing = false;
          resolve();
        });

        sendRaw({
          text: ' ',
          flush: true,
        });
      });
    },

    interrupt() {
      console.log('[TTS] Interrupt requested');

      finishing = false;
      resolveFinals();

      if (
        ws?.readyState === WebSocket.OPEN ||
        ws?.readyState === WebSocket.CONNECTING
      ) {
        try {
          ws.close(1000, 'barge-in');
        } catch {
          // ignore
        }
      }

      isReady = false;
      stopKeepAlive();

      if (!isClosedByUser) {
        setTimeout(() => connect(), 100);
      }
    },

    close() {
      isClosedByUser = true;
      finishing = false;

      stopKeepAlive();
      resolveFinals();

      if (ws) {
        try {
          sendRaw({ text: '' });
          ws.close(1000, 'call-ended');
        } catch {
          // ignore
        }
      }

      ws = null;
      isReady = false;
    },
  };
}
