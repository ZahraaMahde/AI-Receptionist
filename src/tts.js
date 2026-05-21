import { config } from './config.js';

const ELEVENLABS_WS_URL = 'wss://api.elevenlabs.io/v1/text-to-speech';

/**
 * Create a streaming TTS connection to ElevenLabs
 * 
 * Uses WebSocket for lowest latency (~300ms to first audio chunk).
 * Text is sent in small chunks as LLM tokens arrive.
 * Audio is streamed back in mulaw format for Twilio.
 * 
 * @returns {Object} TTS stream controller
 */
export function createTTSStream() {
  const voiceId = config.elevenlabs.voiceId;
  const wsUrl = `${ELEVENLABS_WS_URL}/${voiceId}/stream-input?model_id=eleven_turbo_v2_5&output_format=ulaw_8000`;

  let ws = null;
  let audioCallback = null;
  let isReady = false;
  let textBuffer = '';
  let flushTimeout = null;

  function connect() {
    ws = new WebSocket(wsUrl, {
      headers: {
        'xi-api-key': config.elevenlabs.apiKey,
      },
    });

    ws.on('open', () => {
      console.log('[TTS] ElevenLabs WebSocket connected');

      // Send initial config - BOS (beginning of stream)
      ws.send(JSON.stringify({
        text: ' ',
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
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());

        if (message.audio) {
          // Audio chunk received (base64 encoded mulaw)
          const audioBuffer = Buffer.from(message.audio, 'base64');
          if (audioCallback) {
            audioCallback(audioBuffer);
          }
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
    });

    ws.on('close', () => {
      console.log('[TTS] WebSocket closed');
      isReady = false;
    });
  }

  connect();

  return {
    /**
     * Send text to be synthesized.
     * Buffers small chunks and flushes on sentence boundaries
     * for more natural-sounding speech.
     */
    sendText(text) {
      if (!isReady || !ws) return;

      textBuffer += text;

      // Flush on sentence boundaries for natural prosody
      const sentenceEnd = /[.!?]\s*$/;
      const commaEnd = /,\s*$/;

      if (sentenceEnd.test(textBuffer) || textBuffer.length > 150) {
        this._flush();
      } else if (commaEnd.test(textBuffer) && textBuffer.length > 40) {
        this._flush();
      } else {
        // Auto-flush after 100ms if no sentence boundary
        clearTimeout(flushTimeout);
        flushTimeout = setTimeout(() => this._flush(), 100);
      }
    },

    _flush() {
      if (!textBuffer || !isReady) return;

      clearTimeout(flushTimeout);

      ws.send(JSON.stringify({
        text: textBuffer,
        try_trigger_generation: true,
      }));

      console.log(`[TTS] Sent: "${textBuffer.substring(0, 50)}..."`);
      textBuffer = '';
    },

    /**
     * Signal end of text input — flush remaining buffer
     * and send EOS (end of stream)
     */
    finish() {
      if (!isReady || !ws) return;

      clearTimeout(flushTimeout);

      // Flush any remaining text
      if (textBuffer) {
        ws.send(JSON.stringify({
          text: textBuffer,
          try_trigger_generation: true,
        }));
        textBuffer = '';
      }

      // Send EOS signal
      ws.send(JSON.stringify({ text: '' }));
    },

    /**
     * Register callback for audio chunks
     * @param {Function} callback - Called with Buffer of mulaw audio
     */
    onAudio(callback) {
      audioCallback = callback;
    },

    /**
     * Interrupt current speech (for barge-in handling)
     */
    interrupt() {
      clearTimeout(flushTimeout);
      textBuffer = '';
      // Close and reconnect for clean state
      if (ws) {
        ws.close();
        setTimeout(() => connect(), 50);
      }
    },

    close() {
      clearTimeout(flushTimeout);
      if (ws) {
        ws.close();
      }
    },
  };
}

/**
 * Simple one-shot TTS using REST API (for greetings/short responses)
 * Returns base64 mulaw audio
 */
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

  const audioBuffer = Buffer.from(await response.arrayBuffer());
  console.log(`[TTS] One-shot synthesis in ${Date.now() - start}ms (${audioBuffer.length} bytes)`);

  return audioBuffer;
}
