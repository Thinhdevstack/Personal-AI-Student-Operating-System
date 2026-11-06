import { AI_CONFIG } from './config.mjs';
import { aiError } from './openai.mjs';
import { StudentError } from '../student/storage.mjs';

export function createGeminiEmbeddings(options = {}) {
  const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY ?? '';
  const apiModel = options.model || process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2';
  const dimensions = options.dimensions ?? Number(process.env.GEMINI_EMBEDDING_DIMENSIONS || 1536);
  const version = options.version ?? process.env.GEMINI_EMBEDDING_VERSION ?? '';
  if (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > 3072) throw new StudentError('aiEmbeddingMismatch');
  const fetcher = options.fetch || fetch;
  return {
    providerId: 'gemini', model: 'gemini/' + apiModel, dimensions, version, isMock: false,
    async embed(texts) {
      if (!Array.isArray(texts) || !texts.length) return [];
      if (!apiKey) throw new StudentError('aiKeyMissing');
      const result = [];
      try {
        for (let start = 0; start < texts.length; start += AI_CONFIG.batchSize) {
          const batch = texts.slice(start, start + AI_CONFIG.batchSize);
          const response = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(apiModel)}:batchEmbedContents`, {
            method: 'POST', redirect: 'error', signal: AbortSignal.timeout(AI_CONFIG.timeoutMs),
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            body: JSON.stringify({ requests: batch.map((text) => ({ model: 'models/' + apiModel, content: { parts: [{ text }] }, outputDimensionality: dimensions })) }),
          });
          // Bound provider bodies, including failures; no raw upstream text escapes to routes or logs.
          const reader = response.body?.getReader();
          if (!reader) throw new StudentError('aiInvalidResponse', 502);
          const chunks = []; let size = 0;
          try {
            for (;;) {
              const { done, value } = await reader.read(); if (done) break;
              size += value.byteLength;
              if (size > 8 * 1024 * 1024) { await reader.cancel(); throw new StudentError('aiInvalidResponse', 502); }
              chunks.push(value);
            }
          } finally { reader.releaseLock(); }
          let data;
          try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { if (response.ok) throw new StudentError('aiInvalidResponse', 502); data = {}; }
          if (!response.ok) {
            if (data?.error?.status === 'UNAUTHENTICATED' || (Array.isArray(data?.error?.details) && data.error.details.some((detail) => detail?.reason === 'API_KEY_INVALID'))) throw new StudentError('aiKeyInvalid', 502);
            throw { status: response.status };
          }
          if (!Array.isArray(data?.embeddings) || data.embeddings.length !== batch.length) throw new StudentError('aiEmbeddingMismatch', 502);
          for (const item of data.embeddings) {
            const values = item.values;
            if (!Array.isArray(values) || values.length !== dimensions || !values.every(Number.isFinite)) throw new StudentError('aiEmbeddingMismatch', 502);
            const norm = Math.hypot(...values);
            if (!Number.isFinite(norm) || !norm) throw new StudentError('aiEmbeddingMismatch', 502);
            result.push(values.map((value) => value / norm));
          }
        }
        return result;
      } catch (error) {
        if (error?.name === 'TimeoutError') throw new StudentError('aiTimeout', 504);
        if (error instanceof TypeError) throw new StudentError('aiNetwork', 502);
        throw aiError(error);
      }
    },
  };
}
