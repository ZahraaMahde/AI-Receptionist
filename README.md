# AI Receptionist — Voice Agent with Supabase RAG

A low-latency AI phone receptionist that answers company calls using your knowledge base stored in Supabase. Target latency: **1–1.5 seconds** mouth-to-ear.

## Architecture

```
Caller → Twilio (PSTN) → WebSocket Server → Deepgram STT (streaming)
                                           → OpenAI Embeddings → Supabase pgvector (RAG)
                                           → GPT-4o-mini (streaming)
                                           → ElevenLabs TTS (streaming)
                                           → Twilio → Caller hears response
```

## Latency Budget

| Component          | Latency   | Notes                              |
|--------------------|-----------|------------------------------------|
| Deepgram STT       | ~200ms    | Streaming interim results          |
| OpenAI Embedding   | ~50ms     | text-embedding-3-small             |
| Supabase pgvector  | ~30-50ms  | HNSW index, cosine similarity      |
| GPT-4o-mini        | ~400ms    | Streaming, first token             |
| ElevenLabs TTS     | ~300ms    | Streaming, first audio chunk       |
| **Total**          | **~1-1.5s** | With pipeline overlap            |

## Prerequisites

- **Node.js** >= 18
- **Twilio** account with a phone number
- **Supabase** project with pgvector enabled
- **OpenAI** API key
- **Deepgram** API key
- **ElevenLabs** API key

## Quick Start

### 1. Set up Supabase

Run the SQL migrations in your Supabase SQL editor:

```bash
# Run sql/001_create_tables.sql
# Run sql/002_create_functions.sql
```

### 2. Ingest your knowledge base

```bash
npm install
cp .env.example .env
# Fill in your API keys

# Ingest documents
node scripts/ingest.js --file ./data/company-info.txt
```

### 3. Configure Twilio

1. Buy a phone number in Twilio Console
2. Set the Voice webhook URL to: `https://your-server.com/twilio/voice`
3. Make sure WebSocket is accessible (use ngrok for local dev)

### 4. Start the server

```bash
npm start
# or for development:
npm run dev
```

### 5. Test it

Call your Twilio phone number and ask a question!

## Environment Variables

```env
# Server
PORT=3000
SERVER_URL=https://your-server.com

# Twilio
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Supabase
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJxxxxxxxxxxxxxxxx

# OpenAI
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxx

# Deepgram
DEEPGRAM_API_KEY=xxxxxxxxxxxxxxxx

# ElevenLabs
ELEVENLABS_API_KEY=xxxxxxxxxxxxxxxx
ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM
```

## Project Structure

```
├── src/
│   ├── server.js            # Fastify server + Twilio webhook
│   ├── websocket-handler.js # WebSocket session manager
│   ├── stt.js               # Deepgram streaming STT
│   ├── llm.js               # GPT-4o-mini with RAG context
│   ├── tts.js               # ElevenLabs streaming TTS
│   ├── rag.js               # Supabase vector search
│   └── config.js            # Environment config
├── sql/
│   ├── 001_create_tables.sql
│   └── 002_create_functions.sql
├── scripts/
│   └── ingest.js            # Document ingestion script
├── package.json
└── .env.example
```

## Optimizations for Low Latency

1. **Streaming everything** — STT, LLM, and TTS all stream; we don't wait for full results
2. **Pipeline overlap** — TTS starts generating audio as LLM tokens stream in
3. **HNSW index** — pgvector uses HNSW for fast approximate nearest neighbor search
4. **Semantic cache** — Common questions cached to skip RAG + LLM entirely
5. **Connection pooling** — Persistent connections to all APIs
6. **Edge deployment** — Deploy close to your Twilio region
