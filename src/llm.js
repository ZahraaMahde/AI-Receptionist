import OpenAI from 'openai';
import { config } from './config.js';

const openai = new OpenAI({ apiKey: config.openai.apiKey });

/**
 * Generate a streaming response from GPT-4o-mini with RAG context
 * 
 * Uses streaming to get first token in ~400ms.
 * Each token is yielded as it arrives so TTS can start immediately.
 * 
 * @param {string} userMessage - The caller's transcribed question
 * @param {string} ragContext - Retrieved documents from Supabase
 * @param {Array} conversationHistory - Previous turns in the call
 * @returns {AsyncGenerator<string>} - Yields text chunks
 */
export async function* streamLLMResponse(userMessage, ragContext, conversationHistory = []) {
  const start = Date.now();
  let firstToken = true;

  const systemMessage = buildSystemMessage(ragContext);

  const messages = [
    { role: 'system', content: systemMessage },
    ...conversationHistory.slice(-6), // Keep last 3 exchanges for context
    { role: 'user', content: userMessage },
  ];

  const stream = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages,
    stream: true,
    temperature: 0.3,          // Lower temp for factual accuracy
    max_tokens: 60,           // Keep responses concise for phone
    presence_penalty: 0.1,     // Slight penalty to avoid repetition
  });

  let fullResponse = '';

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content;
    if (!content) continue;

    if (firstToken) {
      console.log(`[LLM] First token in ${Date.now() - start}ms`);
      firstToken = false;
    }

    fullResponse += content;
    yield content;
  }

  console.log(`[LLM] Complete in ${Date.now() - start}ms (${fullResponse.length} chars)`);
}

/**
 * Build the system message with RAG context injected
 */
function buildSystemMessage(ragContext) {
  let prompt = config.systemPrompt;

  prompt += '\n\n## Important guidelines:\n';
  prompt += '- Keep responses SHORT and natural for phone conversation (1-3 sentences)\n';
  prompt += '- Speak in a warm, professional tone\n';
  prompt += '- If asked to transfer, say you will connect them\n';
  prompt += '- Never mention that you are AI unless directly asked\n';
  prompt += '- Use natural filler words occasionally (well, sure, of course)\n';
  prompt += '- Don\'t use markdown, bullet points, or formatting — this is spoken\n';
  prompt += '- Reply in one short sentence unless the caller asks for details.\n';
  prompt += '- If the caller only greets you, reply briefly and ask what they need, without repeating the full greeting.\n';
  
  if (ragContext) {
    prompt += '\n## Company knowledge base (use this to answer questions):\n';
    prompt += ragContext;
    prompt += '\n\nAnswer ONLY based on the above context. If the information is not in the context, say you don\'t have that information and offer to transfer to a team member.';
  }

  return prompt;
}

/**
 * Non-streaming version for simple responses (greetings, transfers)
 */
export async function generateQuickResponse(userMessage, type = 'greeting') {
  const prompts = {
    greeting: `You are a receptionist for ${config.companyName}. Generate a brief, warm phone greeting (1 sentence). Don't ask how you can help — just greet naturally.`,
    transfer: `You are a receptionist for ${config.companyName}. The caller wants to be transferred. Say a brief line confirming you'll transfer them.`,
    farewell: `You are a receptionist for ${config.companyName}. Say a brief, warm goodbye to end the call.`,
    unclear: `You are a receptionist for ${config.companyName}. You couldn't understand the caller. Politely ask them to repeat — keep it to 1 sentence.`,
  };

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: prompts[type] || prompts.greeting },
      { role: 'user', content: userMessage || 'Generate the response.' },
    ],
    temperature: 0.7,
    max_tokens: 60,
  });

  return response.choices[0].message.content;
}
