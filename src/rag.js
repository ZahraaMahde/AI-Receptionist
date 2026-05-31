import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { config } from './config.js';

const supabase = createClient(config.supabase.url, config.supabase.serviceKey);
const openai = new OpenAI({ apiKey: config.openai.apiKey });

/**
 * Generate embedding for a text query using OpenAI.
 */
export async function generateEmbedding(text) {
  const start = Date.now();

  const response = await openai.embeddings.create({
    model: config.rag.embeddingModel,
    input: text,
  });

  console.log(`[RAG] Embedding generated in ${Date.now() - start}ms`);

  return response.data[0].embedding;
}

/**
 * Check semantic cache first.
 */
export async function checkCache(embedding) {
  if (!config.cache.enabled) return null;

  try {
    const start = Date.now();

    const { data, error } = await supabase.rpc('check_semantic_cache_ai', {
      query_embedding: embedding,
      similarity_threshold: config.cache.similarityThreshold,
    });

    if (error) throw error;

    if (data && data.length > 0) {
      console.log(
        `[RAG] Cache HIT in ${Date.now() - start}ms (similarity: ${data[0].similarity.toFixed(3)})`
      );

      supabase
        .from('semantic_cache_ai')
        .update({ hit_count: data[0].hit_count + 1 })
        .eq('id', data[0].id)
        .then(() => {});

      return data[0].answer;
    }

    console.log(`[RAG] Cache miss in ${Date.now() - start}ms`);
    return null;
  } catch (err) {
    console.error('[RAG] Cache check error:', err.message);
    return null;
  }
}

/**
 * Store a question-answer pair in the semantic cache.
 */
export async function cacheAnswer(question, answer, embedding) {
  if (!config.cache.enabled) return;

  try {
    await supabase.rpc('upsert_cache_entry_ai', {
      p_question: question,
      p_answer: answer,
      p_embedding: embedding,
      p_ttl_hours: 1,
    });

    console.log('[RAG] Answer cached');
  } catch (err) {
    console.error('[RAG] Cache write error:', err.message);
  }
}

/**
 * Search the knowledge base for relevant documents.
 */
export async function searchDocuments(embedding) {
  const start = Date.now();

  const { data, error } = await supabase.rpc('match_documents_ai', {
    query_embedding: embedding,
    match_threshold: config.rag.matchThreshold,
    match_count: config.rag.matchCount,
  });

  if (error) {
    console.error('[RAG] Search error:', error.message);
    return [];
  }

  console.log(`[RAG] Found ${data.length} documents in ${Date.now() - start}ms`);

  return data || [];
}

/**
 * Full RAG pipeline.
 */
export async function retrieveContext(userMessage) {
  const totalStart = Date.now();

  const embedding = await generateEmbedding(userMessage);

  const cachedAnswer = await checkCache(embedding);

  if (cachedAnswer) {
    return {
      context: '',
      cached: true,
      cachedAnswer,
      embedding,
    };
  }

  const documents = await searchDocuments(embedding);

  const context = documents
    .map((doc, i) => `[${i + 1}] ${doc.content}`)
    .join('\n\n');

  console.log(`[RAG] Total retrieval in ${Date.now() - totalStart}ms`);

  return {
    context,
    cached: false,
    embedding,
  };
}

/**
 * Ingest a document into the knowledge base.
 */
export async function ingestDocument(text, metadata = {}) {
  const chunks = splitIntoChunks(text, 2000);
  console.log(`[RAG] Ingesting ${chunks.length} chunks...`);

  const results = [];

  for (const chunk of chunks) {
    const embedding = await generateEmbedding(chunk);

    const { data, error } = await supabase
      .from('documents_ai')
      .insert({
        content: chunk,
        metadata,
        embedding,
        token_count: Math.ceil(chunk.length / 4),
      })
      .select('id')
      .single();

    if (error) {
      console.error('[RAG] Ingest error:', error.message);
      continue;
    }

    results.push(data.id);
  }

  console.log(`[RAG] Ingested ${results.length}/${chunks.length} chunks`);

  return results;
}

/**
 * Split text into overlapping chunks for better retrieval.
 */
function splitIntoChunks(text, maxChars = 2000, overlap = 200) {
  const chunks = [];
  const paragraphs = text.split(/\n\n+/);

  let currentChunk = '';

  for (const para of paragraphs) {
    if (currentChunk.length + para.length > maxChars && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());

      const words = currentChunk.split(' ');
      const overlapWords = words.slice(-Math.floor(overlap / 5));

      currentChunk = overlapWords.join(' ') + '\n\n' + para;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + para;
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}
