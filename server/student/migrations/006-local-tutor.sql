-- Preserve old embeddings while allowing separate indexes for each provider/model/version.
ALTER TABLE chunk_embeddings RENAME TO chunk_embeddings_legacy;
DROP INDEX embeddings_model;
CREATE TABLE chunk_embeddings (
  chunkId TEXT NOT NULL REFERENCES document_chunks(id) ON DELETE CASCADE,
  embedding BLOB NOT NULL,
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL CHECK(dimensions > 0),
  modelVersion TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(chunkId, provider, model, dimensions, modelVersion)
);
INSERT INTO chunk_embeddings (chunkId, embedding, model, dimensions, modelVersion, createdAt, provider)
SELECT chunkId, embedding, model, dimensions, modelVersion, createdAt,
  CASE WHEN model LIKE 'gemini/%' THEN 'gemini'
       WHEN model LIKE 'mock-%' THEN 'mock' ELSE 'openai' END
FROM chunk_embeddings_legacy;
DROP TABLE chunk_embeddings_legacy;
CREATE INDEX embeddings_model ON chunk_embeddings(provider, model, dimensions, modelVersion);
-- Expand the old column-level CHECK without rebuilding chat history or its foreign keys.
ALTER TABLE chat_turns RENAME COLUMN provider TO legacyProvider;
ALTER TABLE chat_turns ADD COLUMN provider TEXT NOT NULL DEFAULT 'openai' CHECK(provider IN ('openai','gemini','deepseek','ollama','mock'));
UPDATE chat_turns SET provider=legacyProvider;
ALTER TABLE chat_turns DROP COLUMN legacyProvider;
ALTER TABLE chat_turns ADD COLUMN mode TEXT NOT NULL DEFAULT 'expanded' CHECK(mode IN ('materials','expanded'));
