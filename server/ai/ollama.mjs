import { StudentError } from '../student/storage.mjs';
import { TUTOR_FORMAT } from './openai.mjs';

const integer = (value, fallback, min, max) => {
  const n = Number(value ?? fallback);
  if (!Number.isInteger(n) || n < min || n > max) throw new StudentError('ollamaConfig');
  return n;
};

/** One shared client serializes inference across chat and document embedding on a small GPU. */
export function createOllama(options = {}) {
  let base;
  try { base = new URL(options.baseURL || process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434'); }
  catch { throw new StudentError('ollamaConfig'); }
  if (base.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw new StudentError('ollamaConfig');
  const fetcher = options.fetch || fetch;
  const chatModel = options.chatModel || process.env.OLLAMA_CHAT_MODEL || 'qwen3:4b';
  const embedModel = options.embeddingModel || process.env.OLLAMA_EMBEDDING_MODEL || 'embeddinggemma:latest';
  if ([chatModel, embedModel].some((model) => !/^[a-zA-Z0-9_./:-]{1,120}$/.test(model) || /(?:cloud|\/)/i.test(model))) throw new StudentError('ollamaConfig');
  const dimensions = integer(options.dimensions ?? process.env.OLLAMA_EMBEDDING_DIMENSIONS, 768, 1, 4096);
  const timeoutMs = integer(options.timeoutMs ?? process.env.OLLAMA_TIMEOUT_MS, 180000, 10, 240000);
  const numCtx = integer(process.env.OLLAMA_CONTEXT_SIZE, 8192, 2048, 16384);
  let busy = false;
  const waiters = [];
  async function request(endpoint, body, signal, timeout = timeoutMs) {
    const deadline = AbortSignal.timeout(timeout);
    const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
    try {
      const response = await fetcher(new URL(endpoint, base), {
        method: body ? 'POST' : 'GET', redirect: 'error', signal: combined,
        headers: { 'Content-Type': 'application/json' }, ...(body && { body: JSON.stringify(body) }),
      });
      const reader = response.body?.getReader();
      if (!reader) throw new StudentError('aiInvalidResponse', 502);
      const chunks = []; let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read(); if (done) break;
          size += value.byteLength;
          if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new StudentError('aiInvalidResponse', 502); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      let data;
      try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { throw new StudentError('aiInvalidResponse', 502); }
      if (!response.ok || data.error) {
        if (response.status === 404) throw new StudentError('ollamaModelMissing', 409);
        if (/memory|out of memory|allocat/i.test(String(data.error))) throw new StudentError('ollamaMemory', 503);
        throw new StudentError('ollamaUnavailable', 503);
      }
      return data;
    } catch (error) {
      if (signal?.aborted) throw new StudentError('chatCancelled', 409);
      if (deadline.aborted || error?.name === 'TimeoutError') throw new StudentError('aiTimeout', 504);
      if (error instanceof StudentError) throw error;
      throw new StudentError('ollamaUnavailable', 503);
    }
  }
  async function exclusive(work, signal, wait = false) {
    if (signal?.aborted) throw new StudentError('chatCancelled', 409);
    if (busy) {
      if (!wait || waiters.length >= 32) throw new StudentError('ollamaBusy', 429);
      await new Promise((resolve, reject) => {
        const entry = { resolve: () => { signal?.removeEventListener('abort', abort); resolve(); } };
        const abort = () => {
          const index = waiters.indexOf(entry);
          if (index >= 0) waiters.splice(index, 1);
          reject(new StudentError('chatCancelled', 409));
        };
        waiters.push(entry);
        signal?.addEventListener('abort', abort, { once: true });
      });
    }
    busy = true;
    try {
      if (signal?.aborted) throw new StudentError('chatCancelled', 409);
      return await work();
    } finally {
      const next = waiters.shift();
      if (next) next.resolve(); else busy = false;
    }
  }
  const embedding = {
    providerId: 'ollama', model: 'ollama/' + embedModel, dimensions,
    version: process.env.OLLAMA_EMBEDDING_VERSION || '', isMock: false, configured: true,
    async embed(texts, { signal, onProgress } = {}) {
      if (!Array.isArray(texts) || !texts.length) return [];
      return exclusive(async () => {
        const vectors = [];
        for (let start = 0; start < texts.length; start += 8) {
          const batch = texts.slice(start, start + 8);
          const data = await request('/api/embed', { model: embedModel, input: batch, dimensions, truncate: false, keep_alive: '2m' }, signal);
          if (!Array.isArray(data.embeddings) || data.embeddings.length !== batch.length) throw new StudentError('aiEmbeddingMismatch', 502);
          for (const v of data.embeddings) {
            if (!Array.isArray(v) || v.length !== dimensions || !v.every(Number.isFinite)) throw new StudentError('aiEmbeddingMismatch', 502);
            const norm = Math.hypot(...v);
            if (!Number.isFinite(norm) || !norm) throw new StudentError('aiEmbeddingMismatch', 502);
            vectors.push(v.map((n) => n / norm));
          }
          onProgress?.(vectors.length, texts.length);
        }
        return vectors;
      }, signal, true);
    },
  };
  const chat = {
    providerId: 'ollama', chatModel, isMock: false,
    // Bound the serialized context for a small local model; the main builder trims history/sources first.
    contextChars: 16000,
    async chat(context, { signal } = {}) {
      return exclusive(async () => {
        const structuredParts = context.mode === 'expanded';
        const schema = structuredParts ? {
          ...TUTOR_FORMAT.schema,
          properties: { ...TUTOR_FORMAT.schema.properties, additionalKnowledge: { type: 'string' } },
          required: [...TUTOR_FORMAT.schema.required, 'additionalKnowledge'],
        } : TUTOR_FORMAT.schema;
        const partsInstruction = structuredParts ? '\nEXPANDED RESPONSE SCHEMA: additionalKnowledge is a required string. Put ONLY statements supported by excerpts in answer. Put your own explanation, example and model knowledge in additionalKnowledge. If excerpts do not support the question but you know the course concept, use basis=general, answer="", sourceIds=[] and give a useful explanation in additionalKnowledge. Do not just repeat the question or stop at saying the PDF lacks information. Use basis=insufficient only if you cannot explain reliably even from your own knowledge; then explain the limitation in answer and leave additionalKnowledge empty. Never claim web research. Keep additions short; avoid uncertain factual claims and sweeping rules. The application adds section headings; do not duplicate them.' : '\nReuse the example entities present in the excerpts. Do not introduce new examples or technical facts absent from the excerpts. If an excerpt only lists an algorithm in a table with a short assessment, report only that and explain that its steps are not described. Do not infer its mechanism, expand acronyms or make performance comparisons not stated in the excerpts.';
        const data = await request('/api/chat', {
          model: chatModel, stream: false, think: false, keep_alive: '2m',
          messages: [{ role: 'system', content: context.instructions + partsInstruction }, ...context.input],
          format: schema, options: { num_ctx: numCtx, num_predict: 2048, temperature: 0.2 },
        }, signal);
        if (!data.done || data.done_reason === 'length') throw new StudentError('aiIncomplete', 502);
        if (typeof data.message?.content !== 'string' || data.message.content.length > 100000) throw new StudentError('aiInvalidResponse', 502);
        let answer;
        try { answer = JSON.parse(data.message.content); } catch { throw new StudentError('aiInvalidResponse', 502); }
        if (structuredParts) {
          if (typeof answer.additionalKnowledge !== 'string' || typeof answer.answer !== 'string' || answer.additionalKnowledge.length > 8000) throw new StudentError('aiInvalidResponse', 502);
          if (answer.basis === 'materials' && !answer.answer.trim()) throw new StudentError('aiInvalidResponse', 502);
          const fromFile = context.lang === 'vi' ? 'Theo tài liệu:' : 'From your materials:';
          const fromModel = context.lang === 'vi' ? 'Bổ sung từ kiến thức mô hình (chưa xác minh):' : 'Additional model knowledge (unverified):';
          const parts = [];
          if (answer.basis === 'materials' && answer.answer.trim()) parts.push(fromFile + '\n' + answer.answer.trim());
          else if (answer.basis === 'insufficient' && answer.answer.trim()) parts.push(answer.answer.trim());
          const extra = answer.basis === 'insufficient' ? '' : [answer.basis === 'general' ? answer.answer.trim() : '', answer.additionalKnowledge.trim()].filter(Boolean).join('\n');
          if (extra) parts.push(fromModel + '\n' + extra);
          answer = { ...answer, answer: parts.join('\n\n') };
        }
        return { ...answer, model: chatModel, isMock: false };
      }, signal);
    },
  };
  return {
    embedding, chat,
    async status() {
      try {
        const data = await request('/api/tags', null, undefined, 3000);
        const models = (Array.isArray(data.models) ? data.models : []).slice(0, 100).map((m) => ({ name: String(m.name || '').slice(0, 120), size: Number(m.size) || 0 }));
        const has = (name) => models.some((m) => m.name === name || m.name === name + ':latest');
        return { connected: true, chatReady: has(chatModel), embeddingReady: has(embedModel), chatModel, embeddingModel: embedModel, busy, models };
      } catch (error) { return { connected: false, chatReady: false, embeddingReady: false, chatModel, embeddingModel: embedModel, busy, models: [], error: error.code || 'ollamaUnavailable' }; }
    },
  };
}
