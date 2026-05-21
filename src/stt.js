import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import { config } from './config.js';

const deepgram = createClient(config.deepgram.apiKey);

/**
 * Create a streaming STT connection to Deepgram
 * 
 * Returns an object with:
 * - send(audioBuffer): feed audio chunks
 * - onTranscript(callback): called with { text, isFinal }
 * - close(): cleanup
 * 
 * Deepgram streams interim results every ~200ms, final results on speech pauses.
 * We use interim results to start the RAG pipeline early (speculative execution).
 */
export function createSTTStream() {
  const connection = deepgram.listen.live({
    model: 'nova-2',           // Best accuracy/speed tradeoff
    language: 'en',
    smart_format: true,         // Punctuation, capitalization
    interim_results: true,      // Get partial results for early processing
    utterance_end_ms: 1000,     // Detect end of utterance after 1s silence
    vad_events: true,           // Voice activity detection
    endpointing: 300,           // Endpoint after 300ms of silence
    encoding: 'mulaw',          // Twilio sends mulaw
    sample_rate: 8000,          // Twilio sends 8kHz
    channels: 1,
  });

  let transcriptCallback = null;
  let utteranceEndCallback = null;
  let currentTranscript = '';

  connection.on(LiveTranscriptionEvents.Open, () => {
    console.log('[STT] Deepgram connection opened');
  });

  connection.on(LiveTranscriptionEvents.Transcript, (data) => {
    const transcript = data.channel?.alternatives?.[0]?.transcript;
    if (!transcript) return;

    const isFinal = data.is_final;
    
    if (isFinal) {
      currentTranscript += (currentTranscript ? ' ' : '') + transcript;
      console.log(`[STT] Final: "${transcript}"`);
    } else {
      console.log(`[STT] Interim: "${transcript}"`);
    }

    if (transcriptCallback) {
      transcriptCallback({
        text: transcript,
        fullText: currentTranscript + (isFinal ? '' : ' ' + transcript),
        isFinal,
        speechFinal: data.speech_final || false,
      });
    }
  });

  connection.on(LiveTranscriptionEvents.UtteranceEnd, () => {
    console.log(`[STT] Utterance end. Full: "${currentTranscript}"`);
    if (utteranceEndCallback && currentTranscript) {
      utteranceEndCallback(currentTranscript.trim());
      currentTranscript = '';
    }
  });

  connection.on(LiveTranscriptionEvents.Error, (err) => {
    console.error('[STT] Deepgram error:', err.message);
  });

  connection.on(LiveTranscriptionEvents.Close, () => {
    console.log('[STT] Deepgram connection closed');
  });

  return {
    send(audioBuffer) {
      if (connection.getReadyState() === 1) {
        connection.send(audioBuffer);
      }
    },

    onTranscript(callback) {
      transcriptCallback = callback;
    },

    onUtteranceEnd(callback) {
      utteranceEndCallback = callback;
    },

    resetTranscript() {
      currentTranscript = '';
    },

    close() {
      connection.requestClose();
    },
  };
}
