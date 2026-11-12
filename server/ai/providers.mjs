import { createOpenAIProvider, createMockAIProvider } from './openai.mjs';
import { createCompatibleChatProvider } from './compatible.mjs';
import { createGeminiEmbeddings } from './gemini.mjs';
import { createOllama } from './ollama.mjs';
import { StudentError } from '../student/storage.mjs';

const LABELS = {
  openai: 'OpenAI / ChatGPT',
  gemini: 'Google Gemini',
  deepseek: 'DeepSeek',
  ollama: 'Ollama · AI local',
  'ollama-cloud': 'Ollama · AI Cloud',
  mock: 'Offline test provider',
};
const ids = ['openai', 'gemini', 'deepseek', 'ollama', 'ollama-cloud'];

export const DEFAULT_CLOUD_MODELS = [
  'glm-5.3-flash:cloud',
  'qwen2.5:cloud',
  'deepseek-r1:cloud',
  'llama3.3:cloud',
];

/** Also used for dependency injection: old tests can still supply one combined embed/chat provider. */
export function createProviderRegistry({ embedding, entries, defaultProvider = 'openai', isMock = false, localStatus, cloudModels = DEFAULT_CLOUD_MODELS }) {
  const available = new Map(entries.map((entry) => [entry.id, entry]));
  if (!available.has(defaultProvider)) throw new StudentError('aiProviderInvalid');
  return {
    embedding, defaultProvider, isMock, localStatus, cloudModels,
    get(id) {
      const entry = available.get(id);
      if (!entry) throw new StudentError(id === 'mock' ? 'aiMockDisabled' : 'aiProviderInvalid');
      return entry;
    },
    async verifyProvider(id, { model, signal } = {}) {
      if (id === 'ollama-cloud') {
        const entry = available.get('ollama-cloud');
        if (entry?.provider?.verify) {
          return await entry.provider.verify(model, { signal });
        }
        return { ok: false, state: 'not_configured', error: 'aiProviderInvalid' };
      }
      if (id === 'ollama') {
        const st = await (localStatus ? localStatus() : { connected: false });
        return { ok: !!(st.connected && st.chatReady), state: st.connected && st.chatReady ? 'connected' : st.connected ? 'missing_model' : 'disconnected' };
      }
      const entry = available.get(id);
      return { ok: !!entry?.configured, state: entry?.configured ? 'configured' : 'not_configured' };
    },
    settings() {
      return {
        defaultProvider, isMock, webSearch: { configured: false },
        cloudModels,
        chatProviders: entries.filter((entry) => entry.id !== 'mock' || defaultProvider === 'mock').map(({ id, provider, configured }) => ({ id, label: LABELS[id] || id, model: provider.chatModel, configured: !!configured, isMock: !!provider.isMock || !!embedding.isMock })),
        embedding: { provider: embedding.providerId || (embedding.isMock ? 'mock' : 'openai'), model: embedding.model, dimensions: embedding.dimensions, configured: embedding.configured !== false, isMock: !!embedding.isMock },
      };
    },
  };
}
export function registryForProvider(provider) {
  const id = provider.providerId || (provider.isMock ? 'mock' : 'openai');
  return createProviderRegistry({ embedding: provider, entries: [{ id, provider, configured: true }], defaultProvider: id, isMock: !!provider.isMock });
}
export function createAIProviders() {
  const defaultProvider = process.env.AI_CHAT_PROVIDER || 'openai';
  const embeddingId = process.env.AI_EMBEDDING_PROVIDER || 'openai';
  if (!ids.includes(defaultProvider) || !['openai', 'gemini', 'ollama'].includes(embeddingId)) throw new StudentError('aiProviderInvalid');
  const cloudModels = (process.env.OLLAMA_CLOUD_MODELS
    ? process.env.OLLAMA_CLOUD_MODELS.split(',').map((s) => s.trim()).filter(Boolean)
    : DEFAULT_CLOUD_MODELS);
  if (process.env.AI_OFFLINE_MODE === '1') {
    const embedding = createMockAIProvider();
    const entries = [...ids.filter((id) => !id.startsWith('ollama') || defaultProvider === id), 'mock'].map((id) => ({ id, configured: true, provider: { ...createMockAIProvider(), providerId: id, chatModel: 'mock-' + id + '-tutor' } }));
    return createProviderRegistry({ embedding, entries, defaultProvider, isMock: true, cloudModels });
  }
  if (process.env.AI_MOCK_EMBEDDINGS === '1' || process.env.AI_MOCK_CHAT === '1') throw new StudentError('aiMockDisabled');
  const openai = createOpenAIProvider();
  const ollama = createOllama();
  const entries = [
    { id: 'openai', provider: openai, configured: !!process.env.OPENAI_API_KEY },
    { id: 'gemini', provider: createCompatibleChatProvider({ id: 'gemini', apiKey: process.env.GEMINI_API_KEY || '', model: process.env.GEMINI_CHAT_MODEL || 'gemini-3.6-flash' }), configured: !!process.env.GEMINI_API_KEY },
    { id: 'deepseek', provider: createCompatibleChatProvider({ id: 'deepseek', apiKey: process.env.DEEPSEEK_API_KEY || '', model: process.env.DEEPSEEK_CHAT_MODEL || 'deepseek-flash' }), configured: !!process.env.DEEPSEEK_API_KEY },
    { id: 'ollama', provider: ollama.chat, configured: true },
    { id: 'ollama-cloud', provider: ollama.cloudChat, configured: true },
  ];
  const embedding = embeddingId === 'ollama' ? ollama.embedding : embeddingId === 'gemini' ? createGeminiEmbeddings() : openai;
  embedding.configured = embeddingId === 'ollama' || !!process.env[embeddingId === 'gemini' ? 'GEMINI_API_KEY' : 'OPENAI_API_KEY'];
  return createProviderRegistry({ embedding, entries, defaultProvider, localStatus: ollama.status, cloudModels });
}
