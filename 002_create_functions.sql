-- ============================================
-- Match documents by embedding similarity
-- Used by the RAG pipeline to find relevant context
-- ============================================
CREATE OR REPLACE FUNCTION match_documents(
  query_embedding vector(1536),
  match_threshold FLOAT DEFAULT 0.7,
  match_count INT DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  metadata JSONB,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    d.id,
    d.content,
    d.metadata,
    1 - (d.embedding <=> query_embedding) AS similarity
  FROM documents d
  WHERE 1 - (d.embedding <=> query_embedding) > match_threshold
  ORDER BY d.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- ============================================
-- Check semantic cache for a similar question
-- Returns cached answer if similarity > 0.95
-- ============================================
CREATE OR REPLACE FUNCTION check_semantic_cache(
  query_embedding vector(1536),
  similarity_threshold FLOAT DEFAULT 0.95
)
RETURNS TABLE (
  id UUID,
  question TEXT,
  answer TEXT,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    sc.id,
    sc.question,
    sc.answer,
    1 - (sc.embedding <=> query_embedding) AS similarity
  FROM semantic_cache sc
  WHERE sc.expires_at > NOW()
    AND 1 - (sc.embedding <=> query_embedding) > similarity_threshold
  ORDER BY sc.embedding <=> query_embedding
  LIMIT 1;
END;
$$;

-- ============================================
-- Upsert cache entry and bump hit count
-- ============================================
CREATE OR REPLACE FUNCTION upsert_cache_entry(
  p_question TEXT,
  p_answer TEXT,
  p_embedding vector(1536),
  p_ttl_hours INT DEFAULT 1
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  result_id UUID;
BEGIN
  INSERT INTO semantic_cache (question, answer, embedding, expires_at)
  VALUES (p_question, p_answer, p_embedding, NOW() + (p_ttl_hours || ' hours')::INTERVAL)
  RETURNING id INTO result_id;
  
  RETURN result_id;
END;
$$;

-- ============================================
-- Clean up expired cache entries (run via cron)
-- ============================================
CREATE OR REPLACE FUNCTION cleanup_expired_cache()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM semantic_cache
  WHERE expires_at < NOW();
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;
