import OpenAI from 'openai';
import { AI_CONFIG } from './config.mjs';
import { StudentError } from '../student/storage.mjs';

/**
 * Creates an OpenAI embedding provider with batching and error handling.
 *
 * @param {object} [options]
 * @param {string} [options.apiKey]
 * @param {string} [options.model]
 * @param {number} [options.dimensions]
 * @param {number} [options.batchSize]
 * @returns {{ model: string; dimensions: number; embed: (texts: string[]) => Promise<number[][]> }}
 */
export function createOpenAIProvider(options = {}) {
  if (process.env.AI_MOCK_EMBEDDINGS === '1' || process.env.OPENAI_API_KEY === 'mock') {
    return createMockAIProvider(options);
  }
  const model = options.model || AI_CONFIG.embeddingModel;
  const dimensions = options.dimensions || AI_CONFIG.embeddingDimensions;
  const batchSize = options.batchSize || AI_CONFIG.batchSize;

  function getClient() {
    const apiKey = options.apiKey || AI_CONFIG.apiKey;
    if (!apiKey) {
      throw new StudentError('aiKeyMissing', 400);
    }
    return new OpenAI({ apiKey, timeout: AI_CONFIG.timeoutMs });
  }

  return {
    model,
    dimensions,
    async embed(texts) {
      if (!Array.isArray(texts) || texts.length === 0) return [];

      const client = getClient();
      const allEmbeddings = [];

      // Batch requests to prevent hitting payload or rate limits
      for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        try {
          const response = await client.embeddings.create({
            model,
            input: batch,
          });

          // Sort response data by index just in case order is not guaranteed
          const sorted = [...response.data].sort((a, b) => a.index - b.index);
          for (const item of sorted) {
            allEmbeddings.push(item.embedding);
          }
        } catch (err) {
          if (err instanceof StudentError) throw err;
          const status = err.status || 500;
          if (status === 401 || err.code === 'invalid_api_key') {
            throw new StudentError('aiKeyInvalid', 401);
          }
          if (status === 429) {
            throw new StudentError('aiRateLimit', 429);
          }
          throw new StudentError(`aiError: ${err.message || 'embedding failed'}`, 502);
        }
      }

      return allEmbeddings;
    },
  };
}

/**
 * Creates a deterministic mock AI provider for testing and offline environments.
 * Generates reproducible unit-length vectors using a hash of the text.
 *
 * @param {object} [options]
 * @param {number} [options.dimensions]
 * @returns {{ model: string; dimensions: number; embed: (texts: string[]) => Promise<number[][]> }}
 */
export function createMockAIProvider(options = {}) {
  const model = 'mock-embedding-v1';
  const dimensions = options.dimensions || 64;

  return {
    model,
    dimensions,
    async embed(texts) {
      if (!Array.isArray(texts) || texts.length === 0) return [];
      return texts.map((text) => {
        const vec = new Float32Array(dimensions);
        let hash = 0;
        for (let i = 0; i < text.length; i++) {
          hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
          const idx = (hash + i) % dimensions;
          vec[idx] += 1.0;
        }

        // Also add term-specific activation so word matches produce higher cosine similarity
        const words = text.toLowerCase().split(/\W+/).filter(Boolean);
        for (const word of words) {
          let wordHash = 0;
          for (let i = 0; i < word.length; i++) {
            wordHash = (wordHash * 37 + word.charCodeAt(i)) >>> 0;
          }
          vec[wordHash % dimensions] += 2.0;
        }

        // Normalize to unit vector
        let norm = 0;
        for (let i = 0; i < dimensions; i++) norm += vec[i] * vec[i];
        norm = Math.sqrt(norm) || 1;
        const normalized = [];
        for (let i = 0; i < dimensions; i++) normalized.push(vec[i] / norm);
        return normalized;
      });
    },
  };
}
