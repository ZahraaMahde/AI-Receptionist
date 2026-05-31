import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import { config } from './config.js';

const deepgram = createClient(config.deepgram.apiKey);

export function createSTTStream() {
  const connection = deepgram.listen.live({
    model: 'nova-2',
    language: 'en',
    smart_format: true,
    interim_results: true,
    utterance_end_ms: 1000,
    vad_events: true,
    endpointing: 300,
    encoding: 'mulaw',
    sample_rate: 8000,
    channels: 1,
  });

  let transcriptCallback = null;
  let utteranceEndCallback = null;

  let currentTranscript = '';
  let lastInterimTranscript = '';
  let hasProcessedCurrentUtterance = false;

  function resetCurrentUtterance() {
    currentTranscript = '';
    lastInterimTranscript = '';
    hasProcessedCurrentUtterance = false;
  }

  function processCurrentUtterance(reason = 'unknown') {
    const finalText = (currentTranscript || lastInterimTranscript).trim();

    if (!finalText || hasProcessedCurrentUtterance) return;

    console.log(`[STT] Processing utterance via ${reason}. Full: "${finalText}"`);

    hasProcessedCurrentUtterance = true;

    if (utteranceEndCallback) {
      utteranceEndCallback(finalText);
    }

    currentTranscript = '';
    lastInterimTranscript = '';
  }

  connection.on(LiveTranscriptionEvents.Open, () => {
    console.log('[STT] Deepgram connection opened');
  });

  connection.on(LiveTranscriptionEvents.Transcript, (data) => {
    const transcript = data.channel?.alternatives?.[0]?.transcript;
    if (!transcript) return;

    const isFinal = data.is_final === true;
    const speechFinal = data.speech_final === true;

    if (isFinal) {
      currentTranscript += (currentTranscript ? ' ' : '') + transcript;
      lastInterimTranscript = '';
      console.log(`[STT] Final: "${transcript}"`);
    } else {
      lastInterimTranscript = transcript;
      hasProcessedCurrentUtterance = false;
      console.log(`[STT] Interim: "${transcript}"`);
    }

    if (transcriptCallback) {
      transcriptCallback({
        text: transcript,
        fullText: currentTranscript || lastInterimTranscript,
        isFinal,
        speechFinal,
      });
    }

    if (speechFinal) {
      processCurrentUtterance('speech_final');
    }
  });

  connection.on(LiveTranscriptionEvents.UtteranceEnd, () => {
    processCurrentUtterance('utterance_end');
  });

  connection.on(LiveTranscriptionEvents.Error, (err) => {
    console.error('[STT] Deepgram error:', JSON.stringify(err, null, 2));
  });

  connection.on(LiveTranscriptionEvents.Close, () => {
    processCurrentUtterance('connection_close');
    console.log('[STT] Deepgram connection closed');
  });

  return {
    send(audioBuffer) {
      try {
        if (connection.getReadyState() === 1) {
          connection.send(audioBuffer);
        }
      } catch (err) {
        console.error('[STT] Send error:', err.message);
      }
    },

    onTranscript(callback) {
      transcriptCallback = callback;
    },

    onUtteranceEnd(callback) {
      utteranceEndCallback = callback;
    },

    resetTranscript() {
      resetCurrentUtterance();
    },

    close() {
      try {
        processCurrentUtterance('manual_close');
        connection.requestClose();
      } catch (err) {
        console.error('[STT] Close error:', err.message);
      }
    },
  };
}
