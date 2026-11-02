import { StudentError } from '../student/storage.mjs';

/**
 * Compute cosine similarity between two Float32 / number vectors.
 *
 * @param {ArrayLike<number>} a
 * @param {ArrayLike<number>} b
 * @returns {number}
 */
export function cosineSimilarity(a, b) {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const valA = a[i];
    const valB = b[i];
    dot += valA * valB;
    normA += valA * valA;
    normB += valB * valB;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

/**
 * Perform a course-scoped semantic retrieval search over indexed chunks.
 *
 * @param {object} params
 * @param {import('better-sqlite3').Database} params.db
 * @param {string} params.courseId
 * @param {string} params.query
 * @param {number} [params.limit=5]
 * @param {object} params.aiProvider
 * @param {boolean} [params.includeArchived=false]
 * @returns {Promise<{ results: { documentId: string; documentName: string; pageNumber: number; chunkIndex: number; content: string; score: number }[] }>}
 */
export async function searchCourseMaterials({ db, courseId, query, limit = 5, aiProvider, includeArchived = false }) {
  if (!query || typeof query !== 'string' || !query.trim()) {
    throw new StudentError('invalidInput', 400);
  }
  const cleanQuery = query.trim().slice(0, 1000);
  const maxResults = Math.min(Math.max(1, Number(limit) || 5), 50);

  // Validate course exists
  const course = db.prepare('SELECT id, status FROM courses WHERE id = ?').get(courseId);
  if (!course) {
    throw new StudentError('notFound', 404);
  }

  // If course is archived, check if archived course search is allowed
  // By specification: "nếu request explicitly chỉ định course archived thì vẫn search được"
  // Here courseId is explicitly specified in the course-scoped search.
  // But if includeArchived is explicitly false and course is archived:
  if (course.status === 'archived' && includeArchived === false && !courseId) {
    return { results: [] };
  }

  // Generate embedding for query
  const [queryVec] = await aiProvider.embed([cleanQuery]);
  if (!queryVec || queryVec.length === 0) {
    return { results: [] };
  }

  // Query only ready documents belonging strictly to this course
  const rows = db.prepare(`
    SELECT
      c.id AS chunkId,
      c.documentId,
      c.pageNumber,
      c.chunkIndex,
      c.content,
      d.originalFilename AS documentName,
      e.embedding,
      e.model,
      e.dimensions
    FROM document_chunks c
    JOIN chunk_embeddings e ON e.chunkId = c.id
    JOIN documents d ON d.id = c.documentId
    WHERE c.courseId = ? AND d.status = 'ready'
  `).all(courseId);

  if (!rows || rows.length === 0) {
    return { results: [] };
  }

  const scored = [];
  for (const row of rows) {
    const rawBuffer = row.embedding;
    const chunkVec = new Float32Array(rawBuffer.buffer, rawBuffer.byteOffset, rawBuffer.byteLength / 4);
    if (chunkVec.length !== queryVec.length) continue; // Skip mismatching dimension

    const score = cosineSimilarity(queryVec, chunkVec);
    scored.push({
      documentId: row.documentId,
      documentName: row.documentName,
      pageNumber: row.pageNumber,
      chunkIndex: row.chunkIndex,
      content: row.content,
      score: Math.round(score * 10000) / 10000,
    });
  }

  // Sort descending by score
  scored.sort((a, b) => b.score - a.score);

  return { results: scored.slice(0, maxResults) };
}

