import { StudentError } from '../student/storage.mjs';

export function cosineSimilarity(a, b) {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; normA += a[i] ** 2; normB += b[i] ** 2; }
  const norm = Math.sqrt(normA * normB);
  return norm ? dot / norm : 0;
}

export async function searchCourseMaterials({ db, courseId, query, limit = 5, aiProvider, includeArchived = false, minScore = -1, signal }) {
  if (typeof query !== 'string' || !query.trim() || query.length > 4000) throw new StudentError('invalidInput');
  const course = db.prepare('SELECT c.status, s.status AS semesterStatus FROM courses c JOIN semesters s ON s.id=c.semesterId WHERE c.id=?').get(courseId);
  if (!course) throw new StudentError('notFound', 404);
  if ((course.status === 'archived' || course.semesterStatus === 'archived') && !includeArchived) throw new StudentError('archived', 409);
  const rows = db.prepare('SELECT c.id AS chunkId, c.documentId, c.pageNumber, c.chunkIndex, c.content, d.originalFilename AS documentName, e.embedding, e.provider, e.model, e.dimensions, e.modelVersion FROM document_chunks c JOIN chunk_embeddings e ON e.chunkId=c.id JOIN documents d ON d.id=c.documentId WHERE c.courseId=? AND d.courseId=? AND d.status=?').all(courseId, courseId, 'ready');
  if (!rows.length) return { results: [] };
  const compatible = rows.filter((row) => row.provider === (aiProvider.providerId || (aiProvider.isMock ? 'mock' : 'openai')) && row.model === aiProvider.model && row.dimensions === aiProvider.dimensions && row.modelVersion === (aiProvider.version || '') && row.embedding.length === row.dimensions * 4);
  if (!compatible.length) throw new StudentError('aiIndexMismatch', 409);
  const [queryVec] = await aiProvider.embed([query.trim()], { signal });
  if (!queryVec || queryVec.length !== aiProvider.dimensions || !queryVec.every(Number.isFinite)) throw new StudentError('aiEmbeddingMismatch', 502);

  // Stop terms that appear ubiquitously across course slides and must not dominate retrieval
  const STOP_TERMS = new Set(['cpu', 'os', 'hdh', 'pc', 'ram', 'rom', 'io']);
  const technicalTerms = [...new Set((query.match(/[A-Za-z][A-Za-z0-9_+-]{2,39}/g) || []).filter((term) => (term.match(/[A-Z]/g) || []).length >= 2).map((term) => term.toLowerCase()).filter((term) => !STOP_TERMS.has(term)))];
  const ocrKey = (word) => word.replace(/[i1]/g, 'l');

  const scored = compatible.map((row) => {
    // SQLite buffers can have unaligned byte offsets; DataView works for every buffer.
    const view = new DataView(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength);
    const vector = Array.from({ length: row.dimensions }, (_, i) => view.getFloat32(i * 4, true));
    const words = new Set((row.content.match(/[A-Za-z0-9_+-]+/g) || []).map((word) => word.toLowerCase()));
    const ocrWords = row.content.includes('[OCR:') ? new Set([...words].map(ocrKey)) : null;

    // Technical names outrank merely similar words (WSClock vs hardware clocks), including OCR typo tolerance.
    const namedMatch = technicalTerms.some((term) => words.has(term) || ocrWords?.has(ocrKey(term)));
    const sim = cosineSimilarity(queryVec, vector);
    const score = Math.min(1, sim + (namedMatch ? 0.3 : 0));

    return { chunkId: row.chunkId, documentId: row.documentId, documentName: row.documentName, pageNumber: row.pageNumber, chunkIndex: row.chunkIndex, content: row.content, score: Math.round(score * 10000) / 10000 };
  }).filter((row) => Number.isFinite(row.score) && row.score >= minScore);

  scored.sort((a, b) => b.score - a.score || a.chunkId.localeCompare(b.chunkId));
  return { results: scored.slice(0, Math.min(50, Math.max(1, Math.floor(Number(limit) || 5)))) };
}

