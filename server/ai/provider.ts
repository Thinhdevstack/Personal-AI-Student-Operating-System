/**
 * Server-only provider contracts. Runtime adapters are selected by providers.mjs.
 */

export interface EmbeddingResult {
  embedding: number[];
  model: string;
  dimensions: number;
}

export interface AIProvider {
  readonly providerId?: string;
  readonly model: string;
  readonly dimensions: number;
  readonly version?: string;
  readonly isMock?: boolean;
  embed(texts: string[]): Promise<number[][]>;
}

export type ChatProviderId = 'openai' | 'gemini' | 'deepseek' | 'mock';
export interface TutorContext { instructions: string; input: { role: string; content: string }[] }
export interface TutorResponse { answer: string; basis: 'materials' | 'general' | 'insufficient'; sourceIds: string[]; model?: string; isMock?: boolean }
export interface ChatProvider { readonly providerId?: ChatProviderId; readonly chatModel: string; readonly isMock: boolean; chat(context: TutorContext): Promise<TutorResponse> }

