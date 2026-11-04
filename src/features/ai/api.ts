import { request } from '@/features/academic/api';
import type { ChatHistory } from './types';

export interface ChatRequest { courseId: string; message: string; requestId: string; language: 'en' | 'vi'; conversationId?: string }
export const chatHistory = (courseId: string, signal?: AbortSignal) => request<ChatHistory>(`courses/${courseId}/chat`, { signal });
export const sendChat = (body: ChatRequest, signal?: AbortSignal) => request<ChatHistory>('chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
