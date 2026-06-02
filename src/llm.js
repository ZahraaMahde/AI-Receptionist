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
export async function* streamLLMResponse(userMessage, ragContext, conversationHistory = [], callerMemory = {}) {
  const start = Date.now();
  let firstToken = true;

  const systemMessage = buildSystemMessage(ragContext, callerMemory);

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
    max_tokens: 90,            // Lower latency: keep spoken responses concise
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
function buildSystemMessage(ragContext, callerMemory = {}) {
  let prompt = config.systemPrompt;

  prompt += '\n\n## Important guidelines:\n';
  prompt += '- Keep responses very short and natural for phone conversation (usually 1 sentence, maximum 2)\n';
  prompt += '- Speak in a warm, professional tone\n';
  prompt += '- If asked to transfer, say you will connect them\n';
  prompt += '- Never mention that you are AI unless directly asked\n';
  prompt += '- Avoid long introductions. Answer directly first, then offer transfer or follow-up if useful.\n';
  prompt += '- Don\'t use markdown, bullet points, or formatting — this is spoken\n';
  prompt += '- Use the conversation history and caller memory to remember personal details shared during this call, such as the caller name, company, needs, and preferences.\n';
  prompt += '- If the caller asks about something they already told you in this call, answer from the conversation memory, not from the company knowledge base.\n';

  const memoryLines = [];
  if (callerMemory.name) memoryLines.push(`Caller name: ${callerMemory.name}`);
  if (callerMemory.company) memoryLines.push(`Caller company: ${callerMemory.company}`);
  if (callerMemory.position) memoryLines.push(`Caller position: ${callerMemory.position}`);
  if (callerMemory.needs?.length) memoryLines.push(`Caller needs: ${callerMemory.needs.join('; ')}`);

  if (memoryLines.length) {
    prompt += '\n## Caller memory from this call:\n';
    prompt += memoryLines.join('\n');
    prompt += '\n';
  }

  if (ragContext) {
    prompt += '\n## Company knowledge base (use this to answer questions):\n';
    prompt += ragContext;
    prompt += '\n\nFor company/service questions, answer based on the company knowledge above. For caller-specific questions, like their name or what they already told you, use caller memory and conversation history. If company information is not in the knowledge base, say you do not have that information and offer to transfer to a team member.';
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
