import { createSTTStream } from './stt.js';
import { createTTSStream } from './tts.js';
import { streamLLMResponse } from './llm.js';
import { retrieveContext, cacheAnswer, warmUp } from './rag.js';
import { classifyFAQIntent, INTENTS } from './intent-router.js';
import { getFAQAnswer } from './faq-answers.js';
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
  let pendingTranscript = null;
  let conversationHistory = [];

  let callerMemory = {
    name: null,
    company: null,
    position: null,
    needs: [],
  };

  let callTranscript = [];
  let isAssistantSpeaking = false;
  let hasInterruptedCurrentSpeech = false;

  let hasSentOpeningGreeting = false;
  let isOpeningGreetingActive = false;
  let openingGreetingFallbackTimer = null;

  sttStream = createSTTStream();
  ttsStream = createTTSStream();

  ttsStream.onAudio((audioBuffer) => {
    if (!streamSid || !ws) return;

    if (isOpeningGreetingActive) {
      hasSentOpeningGreeting = true;
    }

    isAssistantSpeaking = true;

    console.log(`[Twilio] Sending OpenAI TTS audio: ${audioBuffer.length} bytes`);

    ws.send(JSON.stringify({
      event: 'media',
      streamSid,
      media: {
        payload: audioBuffer.toString('base64'),
      },
    }));
  });

  ttsStream.onFinal(() => {
    isAssistantSpeaking = false;

    if (isOpeningGreetingActive) {
      isOpeningGreetingActive = false;
      hasSentOpeningGreeting = true;

      clearTimeout(openingGreetingFallbackTimer);
      openingGreetingFallbackTimer = null;

      console.log('[Session] Opening greeting completed');
    }
  });

  sttStream.onUtteranceEnd(async (transcript) => {
    if (!transcript) return;

    if (isProcessing) {
      pendingTranscript = transcript;
      console.log(`[Session] Queued interrupted utterance: "${transcript}"`);
      return;
    }

    await processTranscript(transcript);
  });

  sttStream.onTranscript(({ text, fullText, isFinal }) => {
    const heardText = (text || fullText || '').trim();
    const wordCount = heardText.split(/\s+/).filter(Boolean).length;

    if (!hasSentOpeningGreeting || isOpeningGreetingActive) {
      return;
    }

    const looksLikeRealSpeech =
      isFinal || wordCount >= 2 || heardText.length >= 8;

    if (
      (isAssistantSpeaking || isProcessing) &&
      looksLikeRealSpeech &&
      !hasInterruptedCurrentSpeech
    ) {
      console.log('[Session] Barge-in detected — interrupting TTS');

      hasInterruptedCurrentSpeech = true;

      if (isAssistantSpeaking) {
        isAssistantSpeaking = false;
        ttsStream.interrupt();

        if (streamSid) {
          ws.send(JSON.stringify({
            event: 'clear',
            streamSid,
          }));
        }
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

          warmUp().catch((err) => {
            console.error('[RAG] Warmup failed:', err.message);
          });

          sendOpeningGreeting().catch((err) => {
            console.error('[Session] Opening greeting error:', err);
          });

          break;

        case 'media': {
          if (!hasSentOpeningGreeting || isOpeningGreetingActive) {
            break;
          }

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

  async function processTranscript(transcript) {
    if (!transcript) return;

    transcript = transcript.trim();

    console.log(`[Session] Processing: "${transcript}"`);

    if (isTranscriptFragment(transcript)) {
      console.log('[Session] Ignoring transcript fragment');
      return;
    }

    isProcessing = true;
    hasInterruptedCurrentSpeech = false;

    updateCallerMemory(transcript);

    const turnStart = Date.now();

    callTranscript.push({
      role: 'user',
      text: transcript,
      timestamp: Date.now(),
    });

    try {
      let fullResponse = '';

      const directResponse = getDirectResponse(transcript);

      if (directResponse) {
        fullResponse = directResponse;

        console.log('[FastIntent] Direct response — skipping FAQ, RAG and LLM');
        ttsStream.sendText(fullResponse);
      } else {
        const faqIntent = await classifyFAQIntent(transcript);

        if (hasInterruptedCurrentSpeech) {
          return;
        }

        if (faqIntent !== INTENTS.UNKNOWN) {
          const faqAnswer = getFAQAnswer(faqIntent);

          if (faqAnswer) {
            fullResponse = faqAnswer;

            console.log(`[FAQ] Matched intent ${faqIntent} — skipping RAG and LLM`);
            ttsStream.sendText(fullResponse);
          }
        }

        if (!fullResponse) {
          const { context, cached, cachedAnswer, embedding } =
            await retrieveContext(transcript);

          if (hasInterruptedCurrentSpeech) {
            return;
          }

          if (cached && cachedAnswer) {
            console.log('[Session] Cache hit — skipping LLM');

            fullResponse = cachedAnswer;
            ttsStream.sendText(cachedAnswer);
          } else {
            const llmStream = streamLLMResponse(
              transcript,
              context,
              conversationHistory,
              callerMemory
            );

            for await (const chunk of llmStream) {
              if (hasInterruptedCurrentSpeech) break;

              fullResponse += chunk;
              ttsStream.sendText(chunk);
            }

            if (embedding && fullResponse && !hasInterruptedCurrentSpeech) {
              cacheAnswer(transcript, fullResponse, embedding).catch(() => {});
            }
          }
        }
      }

      if (!hasInterruptedCurrentSpeech) {
        await ttsStream.finish();
      }

      isAssistantSpeaking = false;

      if (fullResponse) {
        conversationHistory.push(
          { role: 'user', content: transcript },
          { role: 'assistant', content: fullResponse }
        );

        conversationHistory = conversationHistory.slice(-16);

        callTranscript.push({
          role: 'assistant',
          text: fullResponse,
          timestamp: Date.now(),
        });
      }

      console.log(`[Session] Turn complete in ${Date.now() - turnStart}ms`);
    } catch (err) {
      console.error('[Session] Processing error:', err);

      const fallback =
        "I'm sorry, I didn't quite catch that. Could you repeat your question?";

      ttsStream.sendText(fallback);
      await ttsStream.finish();

      isAssistantSpeaking = false;
    } finally {
      isProcessing = false;

      if (pendingTranscript) {
        const nextTranscript = pendingTranscript;
        pendingTranscript = null;

        setImmediate(() => {
          processTranscript(nextTranscript).catch((err) => {
            console.error('[Session] Pending transcript error:', err);
          });
        });
      }
    }
  }

  function updateCallerMemory(transcript) {
    const text = transcript.trim();

    const namePatterns = [
      /\b(?:my name is|this is|call me)\s+([a-zA-Z][a-zA-Z' -]{1,40})\b/i,
      /^(?:hello|hi|hey)?\.?\s*(?:i am|i'm)\s+([a-zA-Z][a-zA-Z' -]{1,40})[.!?]?$/i,
    ];

    for (const pattern of namePatterns) {
      const match = text.match(pattern);

      if (match?.[1]) {
        const rawName = cleanName(match[1]);

        if (isValidName(rawName)) {
          callerMemory.name = rawName;
          console.log(`[Memory] Caller name remembered: ${callerMemory.name}`);
        }
      }
    }

    const companyMatch = text.match(
      /\b(?:my company is|company is|we are)\s
