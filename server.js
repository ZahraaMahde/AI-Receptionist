import Fastify from 'fastify';
import fastifyWebSocket from '@fastify/websocket';
import fastifyFormBody from '@fastify/formbody';
import { handleMediaStream } from './websocket-handler.js';
import { config } from './config.js';

const app = Fastify({ logger: true });

// Register plugins
await app.register(fastifyFormBody);
await app.register(fastifyWebSocket);

// ============================================
// Health check
// ============================================
app.get('/', async () => {
  return { 
    status: 'ok', 
    service: 'ai-receptionist',
    company: config.companyName,
  };
});

// ============================================
// Twilio Voice Webhook — returns TwiML to start Media Stream
// This is called when someone dials your Twilio number
// ============================================
app.post('/twilio/voice', async (request, reply) => {
  const callSid = request.body?.CallSid || 'unknown';
  const from = request.body?.From || 'unknown';
  console.log(`[Twilio] Incoming call from ${from} (${callSid})`);

  // Return TwiML that connects the call to our WebSocket
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://${new URL(config.serverUrl).host}/twilio/media-stream">
      <Parameter name="callSid" value="${callSid}" />
      <Parameter name="callerNumber" value="${from}" />
    </Stream>
  </Connect>
</Response>`;

  reply
    .header('Content-Type', 'text/xml')
    .send(twiml);
});

// ============================================
// WebSocket endpoint for Twilio Media Streams
// ============================================
app.register(async function (fastify) {
  fastify.get('/twilio/media-stream', { websocket: true }, (socket, req) => {
    console.log('[Server] New WebSocket connection');
    handleMediaStream(socket);
  });
});

// ============================================
// API endpoints for managing the knowledge base
// ============================================
app.post('/api/ingest', async (request, reply) => {
  const { text, metadata } = request.body || {};
  
  if (!text) {
    return reply.status(400).send({ error: 'text is required' });
  }

  const { ingestDocument } = await import('./rag.js');
  const ids = await ingestDocument(text, metadata || {});

  return { success: true, chunks: ids.length, ids };
});

app.get('/api/search', async (request, reply) => {
  const { q } = request.query || {};
  
  if (!q) {
    return reply.status(400).send({ error: 'q query parameter is required' });
  }

  const { retrieveContext } = await import('./rag.js');
  const result = await retrieveContext(q);

  return { 
    cached: result.cached,
    cachedAnswer: result.cachedAnswer || null,
    context: result.context || null,
  };
});

// ============================================
// Start the server
// ============================================
const start = async () => {
  try {
    await app.listen({ port: config.port, host: '0.0.0.0' });
    console.log(`
╔══════════════════════════════════════════════════╗
║           AI Receptionist Server                 ║
╠══════════════════════════════════════════════════╣
║  Company:    ${config.companyName.padEnd(35)}║
║  Port:       ${String(config.port).padEnd(35)}║
║  Voice URL:  ${(config.serverUrl + '/twilio/voice').padEnd(35)}║
║  WS URL:     ${('wss://' + new URL(config.serverUrl).host + '/twilio/media-stream').substring(0, 35).padEnd(35)}║
╚══════════════════════════════════════════════════╝
    `);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
