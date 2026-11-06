import OpenAI from 'openai';
import { AI_CONFIG } from './config.mjs';
import { StudentError } from '../student/storage.mjs';

export function aiError(error) {
  if (error instanceof StudentError) return error;
  if (error?.name === 'APIConnectionTimeoutError' || error?.name === 'AbortError') return new StudentError('aiTimeout', 504);
  if (error?.name === 'APIConnectionError') return new StudentError('aiNetwork', 502);
  if (error?.status === 401) return new StudentError('aiKeyInvalid', 502);
  if (error?.status === 403 || error?.status === 404 || error?.code === 'model_not_found') return new StudentError('aiModelUnavailable', 502);
  if (error?.status === 429) return new StudentError('aiRateLimit', 429);
  return new StudentError('aiUnavailable', 502);
}

export const TUTOR_FORMAT = {
  type: 'json_schema', name: 'course_tutor', strict: true,
  schema: {
    type: 'object', additionalProperties: false,
    properties: {
      answer: { type: 'string' },
      basis: { type: 'string', enum: ['materials', 'general', 'insufficient'] },
      sourceIds: { type: 'array', items: { type: 'string' } },
    },
    required: ['answer', 'basis', 'sourceIds'],
  },
};

/** Embedding identity is immutable for the provider's lifetime and stored with every vector. */
export function createOpenAIProvider(options = {}) {
  if (process.env.AI_OFFLINE_MODE === '1') return createMockAIProvider(options);
  if (process.env.AI_MOCK_EMBEDDINGS === '1' || process.env.AI_MOCK_CHAT === '1') throw new StudentError('aiMockDisabled');
  const model = options.model || AI_CONFIG.embeddingModel;
  const dimensions = options.dimensions ?? AI_CONFIG.embeddingDimensions;
  const version = options.version ?? AI_CONFIG.embeddingVersion;
  const chatModel = options.chatModel || AI_CONFIG.chatModel;
  const batchSize = options.batchSize || AI_CONFIG.batchSize;
  if (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > 3072) throw new StudentError('aiEmbeddingMismatch');
  function client() {
    if (options.client) return options.client;
    const apiKey = options.apiKey || AI_CONFIG.apiKey;
    if (!apiKey) throw new StudentError('aiKeyMissing');
    return new OpenAI({ apiKey, timeout: AI_CONFIG.timeoutMs, maxRetries: 0 });
  }
  return {
    model, dimensions, version, chatModel, isMock: false,
    async embed(texts) {
      if (!Array.isArray(texts) || !texts.length) return [];
      const sdk = client(), embeddings = [];
      try {
        for (let start = 0; start < texts.length; start += batchSize) {
          const batch = texts.slice(start, start + batchSize);
          const response = await sdk.embeddings.create({ model, input: batch, encoding_format: 'float', ...(/^text-embedding-3-/.test(model) && { dimensions }) });
          const sorted = [...response.data].sort((a, b) => a.index - b.index);
          if (sorted.length !== batch.length || sorted.some((item, index) => item.index !== index || item.embedding.length !== dimensions || !item.embedding.every(Number.isFinite))) throw new StudentError('aiEmbeddingMismatch', 502);
          embeddings.push(...sorted.map((item) => item.embedding));
        }
        return embeddings;
      } catch (error) { throw aiError(error); }
    },
    async chat(context, { signal } = {}) {
      try {
        const response = await client().responses.create({
          model: chatModel, instructions: context.instructions, input: context.input,
          store: false, max_output_tokens: AI_CONFIG.maxOutputTokens,
          text: { format: TUTOR_FORMAT },
        }, { signal });
        if (response.output?.some((item) => item.content?.some((part) => part.type === 'refusal'))) throw new StudentError('aiRefused', 422);
        if (response.status !== 'completed' || !response.output_text) throw new StudentError('aiIncomplete', 502);
        let answer;
        try { answer = JSON.parse(response.output_text); } catch { throw new StudentError('aiInvalidResponse', 502); }
        return { ...answer, model: chatModel, isMock: false };
      } catch (error) { throw aiError(error); }
    },
  };
}

/** Explicit test injection or AI_OFFLINE_MODE=1 only; never selected by an API key. */
export function createMockAIProvider(options = {}) {
  const dimensions = options.dimensions || 64;
  return {
    model: 'mock-embedding-v1', dimensions, version: '', chatModel: 'mock-tutor-v1', isMock: true,
    async embed(texts) {
      return texts.map((text) => {
        const vec = new Float32Array(dimensions);
        let hash = 0;
        for (let i = 0; i < text.length; i++) { hash = (hash * 31 + text.charCodeAt(i)) >>> 0; vec[(hash + i) % dimensions] += 1; }
        for (const word of text.toLowerCase().split(/\W+/).filter(Boolean)) {
          let wordHash = 0;
          for (let i = 0; i < word.length; i++) wordHash = (wordHash * 37 + word.charCodeAt(i)) >>> 0;
          vec[wordHash % dimensions] += 2;
        }
        const norm = Math.hypot(...vec) || 1;
        return Array.from(vec, (value) => value / norm);
      });
    },
    async chat(context) {
      const source = context.sources[0];
      return {
        answer: source ? (context.lang === 'vi' ? 'Phản hồi thử nghiệm từ tài liệu: ' : 'Offline test excerpt: ') + source.content.slice(0, 600) : (context.lang === 'vi' ? 'Chưa có nguồn đủ liên quan.' : 'No sufficiently relevant source was found.'),
        basis: source ? 'materials' : 'insufficient', sourceIds: source ? [source.sourceId] : [],
        model: 'mock-tutor-v1', isMock: true,
      };
    },
  };
}
