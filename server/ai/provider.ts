/**
 * AI Provider interface contract for embeddings.
 * Runtime implementation is in server/ai/openai.mjs.
 */

export interface EmbeddingResult {
  embedding: number[];
  model: string;
  dimensions: number;
}

export interface AIProvider {
  readonly model: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

