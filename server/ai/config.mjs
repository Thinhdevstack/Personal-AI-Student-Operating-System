/**
 * Centralized server-only configuration for embeddings and Course Tutor.
 * No hardcoded models across multiple files.
 */

export const AI_CONFIG = {
  get apiKey() {
    return process.env.OPENAI_API_KEY || '';
  },
  get embeddingModel() {
    return process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
  },
  get embeddingDimensions() { return Number(process.env.OPENAI_EMBEDDING_DIMENSIONS || 1536); },
  get embeddingVersion() { return process.env.OPENAI_EMBEDDING_VERSION || ''; },
  get chatModel() { return process.env.OPENAI_CHAT_MODEL || 'gpt-5-mini'; },
  maxOutputTokens: 4096,
  batchSize: 64,
  timeoutMs: 30000,
};

export const CHAT_LIMITS = Object.freeze({
  messageChars: 4000, historyMessages: 10, historyChars: 8000, sourceChars: 12000,
  chunkChars: 2400, chunks: 5, contextChars: 28000, answerChars: 16000,
  retrievalMinScore: 0.25, leaseMs: 120_000, visibleTurns: 40,
});

