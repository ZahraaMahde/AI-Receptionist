-- Enable the pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================
-- Knowledge base documents table
-- ============================================
CREATE TABLE IF NOT EXISTS documents (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  content       TEXT NOT NULL,
  metadata      JSONB DEFAULT '{}',
  embedding     vector(1536),       -- text-embedding-3-small dimensions
  token_count   INTEGER,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- HNSW index for fast approximate nearest neighbor search
-- This gives ~98% recall with much faster queries than exact search
CREATE INDEX IF NOT EXISTS idx_documents_embedding
  ON documents
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Index on metadata for filtered queries
CREATE INDEX IF NOT EXISTS idx_documents_metadata
  ON documents
  USING gin (metadata);

-- ============================================
-- Semantic cache table
-- Caches frequent question-answer pairs to skip RAG + LLM
-- ============================================
CREATE TABLE IF NOT EXISTS semantic_cache (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  question      TEXT NOT NULL,
  answer        TEXT NOT NULL,
  embedding     vector(1536),
  hit_count     INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  expires_at    TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '1 hour')
);

CREATE INDEX IF NOT EXISTS idx_cache_embedding
  ON semantic_cache
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Auto-cleanup expired cache entries
CREATE INDEX IF NOT EXISTS idx_cache_expires
  ON semantic_cache (expires_at);

-- ============================================
-- Call logs table (for analytics)
-- ============================================
CREATE TABLE IF NOT EXISTS call_logs (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  call_sid      TEXT,
  caller_number TEXT,
  transcript    JSONB DEFAULT '[]',
  duration_ms   INTEGER,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Row Level Security (optional but recommended)
-- ============================================
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE semantic_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_logs ENABLE ROW LEVEL SECURITY;

-- Service role can do everything
CREATE POLICY "Service role full access on documents"
  ON documents FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on cache"
  ON semantic_cache FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on call_logs"
  ON call_logs FOR ALL
  USING (auth.role() = 'service_role');
