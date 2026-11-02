/**
 * Centralized AI configuration for Milestone 2 (Embeddings only).
 * No hardcoded models across multiple files.
 */

export const AI_CONFIG = {
  get apiKey() {
    return process.env.OPENAI_API_KEY || '';
  },
  get embeddingModel() {
    return process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
  },
  embeddingDimensions: 1536,
  batchSize: 64,
  timeoutMs: 30000,
};

