import OpenAI from 'openai';
import { spawn } from 'child_process';
import { config } from './config.js';

const openai = new OpenAI({
  apiKey: config.openai.apiKey,
});

export function createTTSStream() {
  let audioCallback = null;
  let textBuffer = '';
  let isClosed = false;
  let generationId = 0;

  return {
    sendText(text) {
      if (!text || isClosed) return;
      textBuffer += text;
    },

    async finish() {
      if (isClosed) return;

      const currentGeneration = generationId;

      const text = textBuffer.trim();
      textBuffer = '';

      if (!text) return;

      try {
        console.log(`[TTS] Generating OpenAI speech: "${text.substring(0, 80)}..."`);

        const response = await openai.audio.speech.create({
          model: 'tts-1',
          voice: config.openai.ttsVoice || 'alloy',
          input: text,
          response_format: 'mp3',
        });

        if (currentGeneration !== generationId || isClosed) {
          console.log('[TTS] Discarding interrupted audio before reading response');
          return;
        }

        const mp3Buffer = Buffer.from(await response.arrayBuffer());
        console.log(`[TTS] OpenAI audio received: ${mp3Buffer.length} bytes`);

        const mulawBuffer = await convertToMulaw8000(mp3Buffer);

        if (currentGeneration !== generationId || isClosed) {
          console.log('[TTS] Discarding interrupted audio');
          return;
        }

        console.log(`[TTS] Converted to mulaw 8k: ${mulawBuffer.length} bytes`);

        if (audioCallback) {
          audioCallback(mulawBuffer);
        } else {
          console.warn('[TTS] Audio ready but no audio callback registered');
        }
      } catch (err) {
        console.error('[TTS] OpenAI TTS error:', err.message);
      }
    },

    onAudio(callback) {
      audioCallback = callback;
    },

    interrupt() {
      generationId++;
      textBuffer = '';
      console.log(`[TTS] Interrupt requested (generation ${generationId})`);
    },

    close() {
      generationId++;
      isClosed = true;
      textBuffer = '';
    },
  };
}

function convertToMulaw8000(inputBuffer) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-hide_banner',
      '-loglevel', 'error',
      '-i', 'pipe:0',
      '-ar', '8000',
      '-ac', '1',
      '-f', 'mulaw',
      'pipe:1',
    ]);

    const chunks = [];
    const errors = [];

    ffmpeg.stdout.on('data', (chunk) => {
      chunks.push(chunk);
    });

    ffmpeg.stderr.on('data', (chunk) => {
      errors.push(chunk);
    });

    ffmpeg.on('error', (err) => {
      reject(err);
    });

    ffmpeg.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(Buffer.concat(errors).toString() || `ffmpeg exited with code ${code}`));
        return;
      }

      resolve(Buffer.concat(chunks));
    });

    ffmpeg.stdin.write(inputBuffer);
    ffmpeg.stdin.end();
  });
}

export async function synthesizeSpeech(text) {
  const response = await openai.audio.speech.create({
    model: 'tts-1',
    voice: config.openai.ttsVoice || 'alloy',
    input: text,
    response_format: 'mp3',
  });

  const mp3Buffer = Buffer.from(await response.arrayBuffer());
  return convertToMulaw8000(mp3Buffer);
}
