import 'dotenv/config';

export const config = {
  port: parseInt(process.env.PORT || '3000'),
  serverUrl: process.env.SERVER_URL || 'http://localhost:3000',

  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
  },

  supabase: {
    url: process.env.SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_KEY,
  },

  openai: {
    apiKey: process.env.OPENAI_API_KEY,
  },

  deepgram: {
    apiKey: process.env.DEEPGRAM_API_KEY,
  },

  elevenlabs: {
    apiKey: process.env.ELEVENLABS_API_KEY,
    voiceId: process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM',
  },

  companyName: process.env.COMPANY_NAME || 'Our Company',

  systemPrompt: (process.env.SYSTEM_PROMPT || 
    'You are a friendly and professional receptionist for {COMPANY_NAME}. ' +
    'Answer questions accurately based on the provided context. ' +
    'If you don\'t know the answer, politely say you\'ll transfer them to a team member. ' +
    'Keep responses concise — under 3 sentences for simple questions.'
  ).replace('{COMPANY_NAME}', process.env.COMPANY_NAME || 'Our Company'),

  // RAG settings
  rag: {
    matchThreshold: 0.7,
    matchCount: 5,
    embeddingModel: 'text-embedding-3-small',
  },

  // Cache settings (semantic cache for common questions)
  cache: {
    enabled: true,
    ttlMs: 1000 * 60 * 60, // 1 hour
    similarityThreshold: 0.95,
  },
};
