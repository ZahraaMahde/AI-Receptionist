import { createSTTStream } from './stt.js';
import { createTTSStream } from './tts.js';
import { streamLLMResponse } from './llm.js';
import { retrieveContext, cacheAnswer, warmUp } from './rag.js';
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
  let greetingSent = false;
  let greetingPlaying = false;
  let conversationHistory = [];
  let callTranscript = [];

  // BARGE-IN IS DISABLED BY DEFAULT.
  // On a normal phone line with no echo cancellation, Deepgram hears the bot's
  // OWN voice and transcribes it ("Hello?" in your logs = the greeting echoing
  // back). With barge-in on, that phantom transcript kills the bot mid-sentence
  // and gets processed as a fake question. Until proper echo suppression is in
  // place, leaving this off gives clean, complete replies.
  // Set to true ONLY if your audio path has echo cancellation.
  const ENABLE_BARGE_IN = false;

  const ECHO_GUARD_MS = 1500;

  // Timestamp until which we treat the line as "bot is talking" — any STT
  // result arriving before this is the bot's own audio echoing back, so we
  // drop it instead of replying to ourselves.
  let botSpeakingUntil = 0;

  sttStream = createSTTStream();
  ttsStream = createTTSStream();

  // The greeting needs two things in place: the TTS socket must be connected
  // AND Twilio must have sent its `start` (so we have streamSid to route audio
  // back). Whichever happens second triggers the greeting, exactly once.
  let ttsReady = false;
  function maybeSendGreeting() {
    if (greetingSent || !ttsReady || !streamSid) return;
    greetingSent = true;
    sendOpeningGreeting();
  }

  ttsStream.onReady(() => {
    ttsReady = true;
    maybeSendGreeting();
  });

  ttsStream.onAudio((audioBuffer) => {
    if (!streamSid || !ws) return;

    // Mark that the bot is actively producing audio. Used to suppress echo:
    // any "transcript" arriving while/just after we speak is the bot hearing
    // itself, not the caller.
    botSpeakingUntil = Date.now() + ECHO_GUARD_MS;

    console.log(`[Twilio] Sending TTS audio: ${audioBuffer.length} bytes`);

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

    // ECHO SUPPRESSION: if the bot is (or just was) speaking, this transcript
    // is almost certainly the bot's own voice bleeding into the mic. Drop it.
    if (Date.now() < botSpeakingUntil) {
      console.log(`[Session] Ignored (echo while bot speaking): "${transcript}"`);
      sttStream.resetTranscript();
      return;
    }

    console.log(`[Session] Processing: "${transcript}"`);
    isProcessing = true;
    greetingPlaying = false;

    const turnStart = Date.now();
    callTranscript.push({
      role: 'user',
      text: transcript,
      timestamp: Date.now(),
    });

    try {
      const { context, cached, cachedAnswer, embedding } =
        await retrieveContext(transcript);

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

      // Flushes remaining text and keeps the TTS socket warm for the next turn.
      ttsStream.finish();

      conversationHistory.push(
        { role: 'user', content: transcript },
        { role: 'assistant', content: fullResponse }
      );

      callTranscript.push({
        role: 'assistant',
        text: fullResponse,
        timestamp: Date.now(),
      });

      console.log(`[Session] Turn complete in ${Date.now() - turnStart}ms`);
    } catch (err) {
      console.error('[Session] Processing error:', err);

      const fallback = "I'm sorry, I didn't quite catch that. Could you repeat your question?";
      ttsStream.sendText(fallback);
      ttsStream.finish();
    } finally {
      isProcessing = false;
    }
  });

  sttStream.onTranscript(({ isFinal }) => {
    // Barge-in: the caller is speaking while audio is playing — either the
    // Barge-in: the caller speaking over the bot. Only act on this if it's
    // explicitly enabled. (Requires echo cancellation on the audio path, or it
    // trips on the bot's own voice — see ENABLE_BARGE_IN note above.)
    if (!ENABLE_BARGE_IN) return;

    if ((isProcessing || greetingPlaying) && isFinal) {
      console.log('[Session] Barge-in detected — interrupting TTS');
      greetingPlaying = false;
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

          // Prime OpenAI + Supabase connections so the first real question
          // doesn't pay cold-start latency. Fire-and-forget.
          warmUp().catch(() => {});

          // Greeting fires when BOTH this start event and the TTS socket are
          // ready (see maybeSendGreeting). Whichever lands second wins.
          maybeSendGreeting();

          break;

        case 'media': {
          const audioData = Buffer.from(message.media.payload, 'base64');
          if (sttStream) {
            sttStream.send(audioData);
          }
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

  function sendOpeningGreeting() {
    const greeting = `Hello, ${config.companyName}. How can I help?`;

    console.log(`[Session] Sending opening greeting: "${greeting}"`);

    callTranscript.push({
      role: 'assistant',
      text: greeting,
      timestamp: Date.now(),
    });

    ttsStream.sendText(greeting);
    ttsStream.finish();
    greetingPlaying = true;
  }
}
