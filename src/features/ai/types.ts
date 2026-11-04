export interface ChatSource {
  sourceId: string; chunkId: string; documentId: string; documentName: string; pageNumber: number; chunkIndex: number;
}
export interface ChatMessage {
  id: string; role: 'user' | 'assistant'; content: string;
  basis: 'materials' | 'general' | 'insufficient' | null; sources: ChatSource[]; memories: MemorySnapshot[]; createdAt: string;
}
export interface ChatTurn {
  id: string; sequence: number; requestId: string; status: 'pending' | 'completed' | 'failed';
  errorCode: string | null; model: string | null; isMock: boolean; language: 'en' | 'vi'; createdAt: string; messages: ChatMessage[];
}
export interface ChatHistory { conversationId: string | null; isMock: boolean; turns: ChatTurn[] }

export type MemoryTarget = { scope: 'global'; courseId?: null } | { scope: 'course'; courseId: string };
export interface MemorySnapshot { id: string; scope: 'global' | 'course'; courseId: string | null; content: string; updatedAt: string }
export interface SavedMemory extends MemorySnapshot { sourceMessageId: string | null; sourceCourseId: string | null; createdAt: string }
export interface MemorySource { sourceMessageId: string; sourceCourseId: string }
