import { request } from '@/features/academic/api';
import type { ChatHistory, ChatProviderId, AISettings, LocalAIStatus } from './types';
import type { MemoryTarget, SavedMemory, MemorySource } from './types';

export interface ChatRequest {
  courseId: string;
  message: string;
  requestId: string;
  language: 'en' | 'vi';
  conversationId?: string;
  provider?: ChatProviderId;
  mode?: 'materials' | 'expanded';
  webSearch?: boolean;
  model?: string;
  documentId?: string;
  pageNumber?: number;
  sourceTarget?: { documentId?: string; pageNumber?: number };
}
export const localAIStatus = (signal?: AbortSignal) => request<LocalAIStatus>('ai/local', { signal });
export const verifyAIProvider = (body: { provider: ChatProviderId; model?: string }, signal?: AbortSignal) =>
  request<{ ok: boolean; state: string; error?: string; model?: string }>('ai/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
export const cancelChat = (courseId: string, requestId: string) => request<{ cancelled: boolean }>(`courses/${courseId}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId }) });
export const aiSettings = (signal?: AbortSignal) => request<AISettings>('ai', { signal });
export const chatHistory = (courseId: string, signal?: AbortSignal) => request<ChatHistory>(`courses/${courseId}/chat`, { signal });
export const sendChat = (body: ChatRequest, signal?: AbortSignal) => request<ChatHistory>('chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });

const targetQuery = (target: MemoryTarget) => new URLSearchParams({ scope: target.scope, ...(target.scope === 'course' && { courseId: target.courseId }) }).toString();
export const listMemories = (target: MemoryTarget, signal?: AbortSignal) => request<SavedMemory[]>(`memories?${targetQuery(target)}`, { signal });
export const createMemory = (target: MemoryTarget, content: string, requestId: string, source?: MemorySource) => request<SavedMemory>('memories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...target, content, requestId, ...source }) });
export const updateMemory = (id: string, target: MemoryTarget, content: string) => request<SavedMemory>(`memories/${id}?${targetQuery(target)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) });
export const deleteMemory = (id: string, target: MemoryTarget) => request<{ ok: true }>(`memories/${id}?${targetQuery(target)}`, { method: 'DELETE' });
