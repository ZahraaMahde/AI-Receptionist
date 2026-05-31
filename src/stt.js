import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import { config } from './config.js';

const deepgram = createClient(config.deepgram.apiKey);

/**
 * Create a streaming STT connection to Deepgram
 *
 * Returns an object with:
 * - send(audioBuffer): feed audio chunks
 * - onTranscript(callback): called with { text, isFinal, speechFinal }
 * - onUtteranceEnd(callback): called with the finished transcript string
 * - close(): cleanup
 *
 * LATENCY FIX: we now drive the turn off Deepgram's `speech_final` flag
 * (fires ~`endpointing` ms after the caller stops talking) instead of the
 * slower `UtteranceEnd` event (gated by `utterance_end_ms`). UtteranceEnd is
 * kept only as a fallback in case speech_final never arrives.
 */
export function createSTTStream() {
  const connection = deepgram.listen.live({
    model: 'nova-2',
    language: 'en',
    smart_format: true,
    interim_results: true,
    utterance_end_ms: 700,   // FALLBACK only now (was 1000)
    vad_events: true,
    endpointing: 300,        // speech_final fires ~300ms after speech stops
    encoding: 'mulaw',
    sample_rate: 8000,
    channels: 1,
  });

  let transcriptCallback = null;
  let utteranceEndCallback = null;
  let currentTranscript = '';

  // Fire the turn exactly once, then clear the buffer so the fallback
  // (UtteranceEnd) doesn't double-trigger on the same utterance.
  function fireTurn(source) {
    if (!currentTranscript || !utteranceEndCallback) return;
    const finalText = currentTranscript.trim();
    currentTranscript = '';
    if (!finalText) return;
    console.log(`[STT] Turn triggered via ${source}: "${finalText}"`);
    utteranceEndCallback(finalText);
  }

  connection.on(LiveTranscriptionEvents.Open, () => {
    console.log('[STT] Deepgram connection opened');
  });

  connection.on(LiveTranscriptionEvents.Transcript, (data) => {
    const transcript = data.channel?.alternatives?.[0]?.transcript;
    if (!transcript) return;

    const isFinal = data.is_final;
    const speechFinal = data.speech_final || false;

    if (isFinal) {
      currentTranscript += (currentTranscript ? ' ' : '') + transcript;
      console.log(`[STT] Final: "${transcript}"`);
    } else {
      console.log(`[STT] Interim: "${transcript}"`);
    }

    // Still expose every result for barge-in detection in the handler.
    if (transcriptCallback) {
      transcriptCallback({
        text: transcript,
        fullText: currentTranscript + (isFinal ? '' : ' ' + transcript),
        isFinal,
        speechFinal,
      });
    }

    // EARLY TRIGGER: as soon as Deepgram says the caller finished speaking,
    // kick off the turn. This removes the ~700ms-1s wait you had before.
    if (speechFinal) {
      fireTurn('speech_final');
    }
  });

  // FALLBACK: only fires if speech_final never came (rare). Buffer is usually
  // already empty here because fireTurn() cleared it.
  connection.on(LiveTranscriptionEvents.UtteranceEnd, () => {
    fireTurn('UtteranceEnd');
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
