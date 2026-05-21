import { createSTTStream } from './stt.js';
import { createTTSStream } from './tts.js';
import { streamLLMResponse, generateQuickResponse } from './llm.js';
import { retrieveContext, cacheAnswer } from './rag.js';
import { config } from './config.js';

/**
 * Handle a single Twilio Media Stream WebSocket connection.
 * 
 * This is where the magic happens — orchestrating the full pipeline:
 * 1. Receive audio from Twilio → stream to Deepgram STT
 * 2. On utterance end → RAG retrieval from Supabase
 * 3. Stream LLM response → pipe tokens to ElevenLabs TTS
 * 4. Stream TTS audio back → send to Twilio
 * 
 * All steps overlap for minimum latency.
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

  // Initialize STT
  sttStream = createSTTStream();

  // Initialize TTS
  ttsStream = createTTSStream();

  // When TTS produces audio, send it back through Twilio
  ttsStream.onAudio((audioBuffer) => {
    if (!streamSid) return;

    const base64Audio = audioBuffer.toString('base64');

    ws.send(JSON.stringify({
      event: 'media',
      streamSid,
      media: {
        payload: base64Audio,
      },
    }));
  });

  // When a complete utterance is detected, process it
  sttStream.onUtteranceEnd(async (transcript) => {
    if (!transcript || isProcessing) return;

    console.log(`[Session] Processing: "${transcript}"`);
    isProcessing = true;

    const turnStart = Date.now();
    callTranscript.push({ role: 'user', text: transcript, timestamp: Date.now() });

    try {
      // Step 1: RAG retrieval (embedding + vector search) ~80-100ms
      const { context, cached, cachedAnswer, embedding } = await retrieveContext(transcript);

      let fullResponse = '';

      if (cached && cachedAnswer) {
        // Cache hit! Skip LLM entirely — send cached answer to TTS
        console.log(`[Session] Cache hit — skipping LLM`);
        fullResponse = cachedAnswer;
        ttsStream.sendText(cachedAnswer);
        ttsStream.finish();
      } else {
        // Step 2: Stream LLM response → pipe to TTS in real-time
        const llmStream = streamLLMResponse(transcript, context, conversationHistory);

        for await (const chunk of llmStream) {
          fullResponse += chunk;
          ttsStream.sendText(chunk);
        }
        ttsStream.finish();

        // Cache this Q&A pair in background (don't await)
        if (embedding) {
          cacheAnswer(transcript, fullResponse, embedding).catch(() => {});
        }
      }

      // Update conversation history
      conversationHistory.push(
        { role: 'user', content: transcript },
        { role: 'assistant', content: fullResponse }
      );

      callTranscript.push({ role: 'assistant', text: fullResponse, timestamp: Date.now() });

      console.log(`[Session] Turn complete in ${Date.now() - turnStart}ms`);
    } catch (err) {
      console.error('[Session] Processing error:', err);
      // Fallback: say a generic apology
      const fallback = "I'm sorry, I didn't quite catch that. Could you repeat your question?";
      ttsStream.sendText(fallback);
      ttsStream.finish();
    }

    isProcessing = false;
  });

  // Handle barge-in (caller starts speaking while AI is talking)
  sttStream.onTranscript(({ isFinal, speechFinal }) => {
    if (isProcessing && isFinal) {
      // Caller is speaking over the AI — interrupt TTS
      console.log('[Session] Barge-in detected — interrupting TTS');
      ttsStream.interrupt();

      // Clear the Twilio audio buffer
      if (streamSid) {
        ws.send(JSON.stringify({
          event: 'clear',
          streamSid,
        }));
      }
    }
  });

  // Handle Twilio WebSocket messages
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

          // Send greeting
          sendGreeting();
          break;

        case 'media':
          // Forward audio to Deepgram STT
          const audioData = Buffer.from(message.media.payload, 'base64');
          sttStream.send(audioData);
          break;

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

  async function sendGreeting() {
    try {
      const greeting = await generateQuickResponse('', 'greeting');
      ttsStream.sendText(greeting);
      ttsStream.finish();
      callTranscript.push({ role: 'assistant', text: greeting, timestamp: Date.now() });
    } catch (err) {
      console.error('[Session] Greeting error:', err);
      ttsStream.sendText(`Thank you for calling ${config.companyName}. How can I help you today?`);
      ttsStream.finish();
    }
  }

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
    // Log the call transcript to Supabase (fire and forget)
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
