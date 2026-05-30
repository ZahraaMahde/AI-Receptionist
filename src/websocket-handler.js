import { createSTTStream } from './stt.js';
import { createTTSStream } from './tts.js';
import { streamLLMResponse } from './llm.js';
import { retrieveContext, cacheAnswer } from './rag.js';
import { config } from './config.js';

/**
 * Handle a single Twilio Media Stream WebSocket connection.
 */
export function handleMediaStream(ws) {
  console.log('[Session] New call connected');

  let streamSid = null;
  let callSid = null;
  let sttStream = null;
  let ttsStream = null;
  let isProcessing = false;
  let conversationHistory = [];
  let callTranscript = [];

  sttStream = createSTTStream();
  ttsStream = createTTSStream();

  ttsStream.onAudio((audioBuffer) => {
    if (!streamSid || !ws) return;

    const base64Audio = audioBuffer.toString('base64');

    ws.send(JSON.stringify({
      event: 'media',
      streamSid,
      media: {
        payload: base64Audio,
      },
    }));
  });

  sttStream.onUtteranceEnd(async (transcript) => {
    if (!transcript || isProcessing) return;

    console.log(`[Session] Processing: "${transcript}"`);
    isProcessing = true;

    const turnStart = Date.now();
    callTranscript.push({ role: 'user', text: transcript, timestamp: Date.now() });

    try {
      const { context, cached, cachedAnswer, embedding } = await retrieveContext(transcript);

      let fullResponse = '';

      if (cached && cachedAnswer) {
        console.log('[Session] Cache hit — skipping LLM');
        fullResponse = cachedAnswer;
        ttsStream.sendText(cachedAnswer);
      } else {
        const llmStream = streamLLMResponse(transcript, context, conversationHistory);

        for await (const chunk of llmStream) {
          fullResponse += chunk;
          ttsStream.sendText(chunk);
        }

        if (embedding) {
          cacheAnswer(transcript, fullResponse, embedding).catch(() => {});
        }
      }

      ttsStream.finish();

      conversationHistory.push(
        { role: 'user', content: transcript },
        { role: 'assistant', content: fullResponse }
      );

      callTranscript.push({ role: 'assistant', text: fullResponse, timestamp: Date.now() });

      console.log(`[Session] Turn complete in ${Date.now() - turnStart}ms`);
    } catch (err) {
      console.error('[Session] Processing error:', err);

      const fallback = "I'm sorry, I didn't quite catch that. Could you repeat your question?";
      ttsStream.sendText(fallback);
      ttsStream.finish();
    }

    isProcessing = false;
  });

  sttStream.onTranscript(({ isFinal }) => {
    if (isProcessing && isFinal) {
      console.log('[Session] Barge-in detected — interrupting TTS');
      ttsStream.interrupt();

      if (streamSid) {
        ws.send(JSON.stringify({
          event: 'clear',
          streamSid,
        }));
      }
    }
  });

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());

      switch (message.event) {
        case 'connected':
          console.log('[Twilio] Media stream connected');
          break;

        case 'start':
          streamSid = message.start.streamSid;
          callSid = message.start.callSid;
          console.log(`[Twilio] Stream started: ${streamSid}`);

          // Greeting disabled because calling ttsStream.finish()
          // before the user speaks closes the ElevenLabs WebSocket.
          break;

        case 'media': {
          const audioData = Buffer.from(message.media.payload, 'base64');
          sttStream.send(audioData);
          break;
        }

        case 'stop':
          console.log('[Twilio] Stream stopped');
          cleanup();
          break;

        default:
          break;
      }
    } catch (err) {
      console.error('[Twilio] Message parse error:', err);
    }
  });

  ws.on('close', () => {
    console.log('[Session] WebSocket closed');
    cleanup();
    logCall();
  });

  ws.on('error', (err) => {
    console.error('[Session] WebSocket error:', err);
    cleanup();
  });

  function cleanup() {
    if (sttStream) {
      sttStream.close();
      sttStream = null;
    }

    if (ttsStream) {
      ttsStream.close();
      ttsStream = null;
    }
  }

  async function logCall() {
    try {
      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(config.supabase.url, config.supabase.serviceKey);

      await supabase.from('call_logs').insert({
        call_sid: callSid,
        transcript: callTranscript,
        duration_ms: callTranscript.length > 0
          ? Date.now() - callTranscript[0].timestamp
          : 0,
      });

      console.log('[Session] Call logged');
    } catch (err) {
      console.error('[Session] Log error:', err.message);
    }
  }
}
