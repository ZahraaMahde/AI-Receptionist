import OpenAI from 'openai';
import { config } from './config.js';

const openai = new OpenAI({
  apiKey: config.openai.apiKey,
});

/**
 * Generate a streaming response from GPT-4o-mini with RAG context.
 *
 * Buffers tiny LLM token chunks into natural speech chunks before sending to TTS.
 */
export async function* streamLLMResponse(
  userMessage,
  ragContext,
  conversationHistory = [],
  callerMemory = {}
) {
  const start = Date.now();
  let firstToken = true;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);

  const systemMessage = buildSystemMessage(ragContext, callerMemory);

  const messages = [
    { role: 'system', content: systemMessage },
    ...conversationHistory.slice(-6),
    { role: 'user', content: userMessage },
  ];

  try {
    const stream = await openai.chat.completions.create(
      {
        model: config.openai?.chatModel || 'gpt-4o-mini',
        messages,
        stream: true,
        temperature: 0.25,
        max_tokens: 60,
        presence_penalty: 0.1,
      },
      {
        signal: controller.signal,
      }
    );

    let fullResponse = '';
    let buffer = '';

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (!content) continue;

      if (firstToken) {
        console.log(`[LLM] First token in ${Date.now() - start}ms`);
        firstToken = false;
      }

      fullResponse += content;
      buffer += content;

      const shouldFlush =
        buffer.length >= 70 ||
        /[.!?]\s*$/.test(buffer);

      if (shouldFlush) {
        const output = buffer.trim();

        if (output) {
          yield `${output} `;
        }

        buffer = '';
      }
    }

    if (buffer.trim()) {
      yield `${buffer.trim()} `;
    }

    console.log(
      `[LLM] Complete in ${Date.now() - start}ms (${fullResponse.length} chars)`
    );
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Build the system message with RAG context and caller memory.
 */
function buildSystemMessage(ragContext, callerMemory = {}) {
  let prompt = config.systemPrompt;

  prompt += '\n\n## Important guidelines:\n';
  prompt += '- Keep responses very short and natural for phone conversation, usually 1 sentence and maximum 2.\n';
  prompt += '- Speak in a warm, professional tone.\n';
  prompt += '- If asked to transfer, say you will connect them.\n';
  prompt += '- Never mention that you are AI unless directly asked.\n';
  prompt += '- Avoid long introductions. Answer directly first, then offer transfer or follow-up if useful.\n';
  prompt += '- Do not use markdown, bullet points, or formatting. This is spoken audio.\n';
  prompt += '- Use the conversation history and caller memory to remember personal details shared during this call, such as caller name, company, needs, and preferences.\n';
  prompt += '- If the caller asks about something they already told you in this call, answer from caller memory and conversation history, not from the company knowledge base.\n';

  const memoryLines = [];

  if (callerMemory.name) {
    memoryLines.push(`Caller name: ${callerMemory.name}`);
  }

  if (callerMemory.company) {
    memoryLines.push(`Caller company: ${callerMemory.company}`);
  }

  if (callerMemory.position) {
    memoryLines.push(`Caller position: ${callerMemory.position}`);
  }

  if (callerMemory.needs?.length) {
    memoryLines.push(`Caller needs: ${callerMemory.needs.join('; ')}`);
  }

  if (memoryLines.length) {
    prompt += '\n## Caller memory from this call:\n';
    prompt += memoryLines.join('\n');
    prompt += '\n';
  }

  if (ragContext) {
    prompt += '\n## Company knowledge base:\n';
    prompt += ragContext;
    prompt += '\n\nUse the company knowledge base for company and service questions.';
    prompt += ' Use caller memory and conversation history for caller-specific questions.';
    prompt += ' If the company information is not available, say you do not have that information and offer to connect the caller with a team member.';
  }

  return prompt;
}

/**
 * Non-streaming version for simple responses.
 */
export async function generateQuickResponse(userMessage, type = 'greeting') {
  const prompts = {
    greeting: `You are a receptionist for ${config.companyName}. Generate a brief, warm phone greeting in 1 sentence. Do not ask how you can help. Just greet naturally.`,
    transfer: `You are a receptionist for ${config.companyName}. The caller wants to be transferred. Say a brief line confirming you will transfer them.`,
    farewell: `You are a receptionist for ${config.companyName}. Say a brief, warm goodbye to end the call.`,
    unclear: `You are a receptionist for ${config.companyName}. You could not understand the caller. Politely ask them to repeat in 1 sentence.`,
  };

  const response = await openai.chat.completions.create({
    model: config.openai?.chatModel || 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: prompts[type] || prompts.greeting,
      },
      {
        role: 'user',
        content: userMessage || 'Generate the response.',
      },
    ],
    temperature: 0.5,
    max_tokens: 40,
  });

  return response.choices[0].message.content;
}
