import { randomUUID } from 'node:crypto';
import { openStudentDatabase } from './database.mjs';
import { documentStorage, StudentError, validatePdf } from './storage.mjs';
import { extractPdf } from '../documents/pdf.mjs';
import { recognizePdfImage } from '../documents/ocr.mjs';
import { createChunks } from '../documents/chunking.mjs';
import { createAIProviders, registryForProvider } from '../ai/providers.mjs';
import { searchCourseMaterials } from '../ai/retrieval.mjs';
import { createCourseChat } from '../ai/chat.mjs';
import { createMemoryService } from '../ai/memory.mjs';
import { createStudentActivity } from './activity.mjs';

function text(value, max, required = false) {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) throw new StudentError('invalidInput');
  return value.trim();
}
function date(value) {
  if (value === undefined || value === '' || value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new StudentError('invalidDate');
  return value;
}
const now = () => new Date().toISOString();

export function createStudentService(dir, options = {}) {
  const db = openStudentDatabase(dir), storage = documentStorage(dir);
  const aiRegistry = options.aiRegistry || (options.aiProvider ? registryForProvider(options.aiProvider) : createAIProviders());
  const aiProvider = aiRegistry.embedding;
  const embeddingId = aiProvider.providerId || (aiProvider.isMock ? 'mock' : 'openai');
  const processing = new Set();
  const progress = new Map();
  let processingTail = Promise.resolve();
  // A stopped server cannot finish its old in-memory jobs. Keep saved files/indexes and allow retry.
  db.prepare(`UPDATE documents SET status=CASE WHEN EXISTS(SELECT 1 FROM document_chunks c WHERE c.documentId=documents.id) THEN 'ready' ELSE 'failed' END,
    processingError='processingInterrupted' WHERE status='processing'`).run();
  const publicDocument = ({ storagePath, ...doc }) => ({ ...doc, ...progress.get(doc.id), indexReady: !!db.prepare('SELECT 1 FROM chunk_embeddings e JOIN document_chunks c ON c.id=e.chunkId WHERE c.documentId=? AND e.provider=? AND e.model=? AND e.dimensions=? AND e.modelVersion=? LIMIT 1').get(doc.id, embeddingId, aiProvider.model, aiProvider.dimensions, aiProvider.version || '') });
  if (options.studentDemo && !aiRegistry.isMock) { db.close(); throw new StudentError('aiMockDisabled'); }
  const memory = createMemoryService({ db });
  const activity = options.activity || createStudentActivity();
  const chat = createCourseChat({ db, aiProvider, memory, activity, aiRegistry });

  function semester(id) {
    const row = db.prepare('SELECT * FROM semesters WHERE id = ?').get(id);
    if (!row) throw new StudentError('notFound', 404);
    return row;
  }
  function course(id) {
    const row = db.prepare('SELECT * FROM courses WHERE id = ?').get(id);
    if (!row) throw new StudentError('notFound', 404);
    return row;
  }
  function writableCourse(id) {
    const row = course(id);
    if (row.status === 'archived' || semester(row.semesterId).status === 'archived') throw new StudentError('archived', 409);
    return row;
  }
  function document(id) {
    const row = db.prepare(`
      SELECT d.*,
             (SELECT COUNT(*) FROM document_chunks WHERE documentId = d.id) AS chunkCount
      FROM documents d WHERE d.id = ?
    `).get(id);
    if (!row) throw new StudentError('notFound', 404);
    return row;
  }

  return {
    close: () => { db.close(); if (!options.activity) activity.close(); },
    activity,
    get db() { return db; },
    get aiProvider() { return aiProvider; },
    chatHistory: chat.history,
    sendChat: chat.send,
    cancelChat: chat.cancel,
    localAIStatus: () => aiRegistry.localStatus ? aiRegistry.localStatus() : { connected: false, chatReady: false, embeddingReady: false, models: [], error: 'ollamaUnavailable' },
    aiSettings: () => ({ ...aiRegistry.settings(), studentDemo: options.studentDemo === true }),
    memories: memory.list,
    createMemory: memory.create,
    updateMemory: memory.update,
    deleteMemory: memory.remove,
    snapshot() {
      return {
        semesters: db.prepare('SELECT * FROM semesters ORDER BY createdAt DESC, id').all(),
        courses: db.prepare('SELECT c.*, (EXISTS(SELECT 1 FROM documents d WHERE d.courseId=c.id) OR EXISTS(SELECT 1 FROM chat_conversations h WHERE h.courseId=c.id) OR EXISTS(SELECT 1 FROM memories m WHERE m.courseId=c.id OR m.sourceCourseId=c.id)) AS hasData FROM courses c ORDER BY name, id').all(),
        recentMaterials: db.prepare(`
          SELECT d.*,
                 (SELECT COUNT(*) FROM document_chunks WHERE documentId = d.id) AS chunkCount
          FROM documents d
          JOIN courses c ON c.id=d.courseId
          JOIN semesters s ON s.id=c.semesterId
          WHERE c.status='active' AND s.isActive=1
          ORDER BY uploadedAt DESC LIMIT 8
        `).all().map(publicDocument),
      };
    },
    createSemester(input) {
      const name = text(input.name, 120, true), academicYear = text(input.academicYear, 60, true);
      const start = date(input.startDate), end = date(input.endDate);
      if (start && end && end < start) throw new StudentError('invalidDate');
      const id = randomUUID(), time = now();
      db.transaction(() => {
        const active = db.prepare('SELECT id FROM semesters WHERE isActive=1').get() ? 0 : 1;
        db.prepare('INSERT INTO semesters (id, name, academicYear, startDate, endDate, status, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, name, academicYear, start, end, 'active', active, time, time);
      })();
      return semester(id);
    },
    updateSemester(id, input) {
      semester(id);
      if (!['rename', 'activate', 'archive'].includes(input.action)) throw new StudentError('invalidInput');
      db.transaction(() => {
        const time = now();
        if (input.action === 'rename') db.prepare('UPDATE semesters SET name=?, updatedAt=? WHERE id=?').run(text(input.name, 120, true), time, id);
        if (input.action === 'activate') {
          if (semester(id).status === 'archived') throw new StudentError('archived', 409);
          db.prepare('UPDATE semesters SET isActive=0, updatedAt=? WHERE isActive=1').run(time);
          db.prepare('UPDATE semesters SET isActive=1, updatedAt=? WHERE id=?').run(time, id);
        }
        if (input.action === 'archive') {
          db.prepare("UPDATE semesters SET status='archived', isActive=0, updatedAt=? WHERE id=?").run(time, id);
          db.prepare("UPDATE courses SET status='archived', updatedAt=? WHERE semesterId=?").run(time, id);
        }
      })();
      return semester(id);
    },
    createCourse(input) {
      const semesterId = text(input.semesterId, 36, true);
      if (semester(semesterId).status === 'archived') throw new StudentError('archived', 409);
      const id = randomUUID(), time = now();
      db.prepare('INSERT INTO courses (id, semesterId, name, code, description, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, semesterId, text(input.name, 120, true), text(input.code, 40), text(input.description, 2000), 'active', time, time);
      return course(id);
    },
    updateCourse(id, input) {
      course(id);
      if (input.action === 'rename') db.prepare('UPDATE courses SET name=?, updatedAt=? WHERE id=?').run(text(input.name, 120, true), now(), id);
      else if (input.action === 'archive') db.prepare("UPDATE courses SET status='archived', updatedAt=? WHERE id=?").run(now(), id);
      else throw new StudentError('invalidInput');
      return course(id);
    },
    deleteCourse(id) {
      db.transaction(() => {
        course(id);
        if (db.prepare('SELECT id FROM documents WHERE courseId=? LIMIT 1').get(id) || db.prepare('SELECT id FROM chat_conversations WHERE courseId=?').get(id) || db.prepare('SELECT id FROM memories WHERE courseId=? OR sourceCourseId=? LIMIT 1').get(id, id)) throw new StudentError('courseNotEmpty', 409);
        db.prepare('DELETE FROM courses WHERE id=?').run(id);
      })();
    },
    materials(id) {
      course(id);
      return db.prepare(`
        SELECT d.*,
               (SELECT COUNT(*) FROM document_chunks WHERE documentId = d.id) AS chunkCount
        FROM documents d WHERE courseId=? ORDER BY uploadedAt DESC, id
      `).all(id).map(publicDocument);
    },
    addMaterial(courseId, bytes, filename, mimeType) {
      // Recheck after the upload completes: the semester may have been archived while bytes were arriving.
      writableCourse(courseId);
      const name = validatePdf(bytes, filename, mimeType), id = randomUUID();
      const storagePath = storage.write(id, bytes);
      try {
        db.prepare('INSERT INTO documents (id, courseId, filename, originalFilename, mimeType, storagePath, sizeBytes, pageCount, status, uploadedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, courseId, 'source.pdf', name, 'application/pdf', storagePath, bytes.length, null, 'uploaded', now());
      } catch (error) { storage.remove(id); throw error; }
      return publicDocument(document(id));
    },
    file(id) { return { document: publicDocument(document(id)), path: storage.location(id) }; },
    writableCourse,

    /**
     * Process an uploaded document into text pages, chunks, and embeddings.
     * Retries clear old incomplete chunks cleanly and re-index idempotently.
     *
     * @param {string} id Document ID
     * @returns {Promise<object>} The updated document
     */
    async processDocument(id) {
      const doc = document(id);
      writableCourse(doc.courseId);
      if (processing.has(id)) throw new StudentError('busy', 429);
      processing.add(id);
      let release;
      const previous = processingTail;
      if (embeddingId === 'ollama') processingTail = new Promise((resolve) => { release = resolve; });
      progress.set(id, { processingPhase: 'queued' });

      // Transition status to processing immediately
      db.prepare("UPDATE documents SET status = 'processing', processingError = NULL WHERE id = ?").run(id);

      try {
        if (embeddingId === 'ollama') await previous;
        writableCourse(doc.courseId);
        progress.set(id, { processingPhase: 'extracting' });
        const filePath = storage.location(id);
        // 1. Extract text per page
        const { pages, pageCount } = await extractPdf(filePath, {
          ...(embeddingId === 'ollama' && process.platform === 'win32' && { ocr: recognizePdfImage }),
          onOcr: (page, totalPages) => progress.set(id, { processingPhase: 'ocr', processingPage: page, processingPages: totalPages }),
        });

        // 2. Create page-aware chunks
        const chunks = createChunks(pages);
        if (!chunks || chunks.length === 0) {
          throw new StudentError('noTextExtracted', 422);
        }

        // 3. Generate embeddings in batch via AI provider
        const texts = chunks.map((c) => c.content);
        progress.set(id, { processingPhase: 'indexing', completedChunks: 0, totalChunks: texts.length });
        const embeddings = await aiProvider.embed(texts, { onProgress: (completedChunks, totalChunks) => {
          progress.set(id, { processingPhase: 'indexing', completedChunks, totalChunks });
        } });
        if (!embeddings || embeddings.length !== chunks.length || embeddings.some((vector) => vector.length !== aiProvider.dimensions || !vector.every(Number.isFinite))) {
          throw new StudentError('aiEmbeddingMismatch', 500);
        }

        // 4. Save chunks and embeddings atomically in transaction
        const time = now();
        db.transaction(() => {
          // Keep stable chunk IDs and indexes from other models when the extracted text is unchanged.
          const previous = db.prepare('SELECT * FROM document_chunks WHERE documentId=?').all(id);
          const retained = new Set();
          const insertChunk = db.prepare(`
            INSERT INTO document_chunks (id, documentId, courseId, pageNumber, chunkIndex, content, tokenCount, createdAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `);
          const insertEmbedding = db.prepare(`
            INSERT OR REPLACE INTO chunk_embeddings (chunkId, embedding, model, dimensions, modelVersion, createdAt, provider)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `);

          for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            const old = previous.find((row) => row.pageNumber === chunk.pageNumber && row.chunkIndex === chunk.chunkIndex && row.content === chunk.content);
            const chunkId = old?.id || randomUUID();
            retained.add(chunkId);
            if (!old) {
              db.prepare('DELETE FROM document_chunks WHERE documentId=? AND pageNumber=? AND chunkIndex=?').run(id, chunk.pageNumber, chunk.chunkIndex);
              insertChunk.run(
              chunkId,
              id,
              doc.courseId,
              chunk.pageNumber,
              chunk.chunkIndex,
              chunk.content,
              chunk.tokenCount,
              time
              );
            }

            // Store embedding as Float32Array binary BLOB
            const floatArray = new Float32Array(embeddings[i]);
            const blob = Buffer.from(floatArray.buffer, floatArray.byteOffset, floatArray.byteLength);
            insertEmbedding.run(
              chunkId,
              blob,
              aiProvider.model,
              aiProvider.dimensions,
              aiProvider.version || '',
              time,
              embeddingId
            );
          }
          for (const row of previous) if (!retained.has(row.id)) db.prepare('DELETE FROM document_chunks WHERE id=?').run(row.id);

          // Mark document ready
          db.prepare(`
            UPDATE documents
            SET status = 'ready', pageCount = ?, processingError = NULL, processedAt = ?
            WHERE id = ?
          `).run(pageCount, time, id);
        })();

        progress.delete(id);
        return publicDocument(document(id));
      } catch (err) {
        // Any failure transitions document to failed and records error message
        const errorCode = err instanceof StudentError ? err.code : 'processingFailed';
        db.prepare(`
          UPDATE documents
          SET status = ?, processingError = ?
          WHERE id = ?
        `).run(doc.status === 'ready' ? 'ready' : 'failed', errorCode, id);
        throw err;
      } finally { processing.delete(id); progress.delete(id); release?.(); }
    },

    /**
     * Search course materials using semantic retrieval.
     *
     * @param {string} courseId
     * @param {string} query
     * @param {number} [limit=5]
     * @param {boolean} [includeArchived=false]
     * @returns {Promise<{ results: any[] }>}
     */
    async search(courseId, query, limit = 5, includeArchived = false) {
      return searchCourseMaterials({
        db,
        courseId,
        query,
        limit,
        aiProvider,
        includeArchived,
      });
    },

    /**
     * Retrieve chunks for a specific document.
     *
     * @param {string} docId
     * @returns {object[]}
     */
    documentChunks(docId) {
      document(docId);
      return db.prepare(`
        SELECT id, documentId, courseId, pageNumber, chunkIndex, content, tokenCount, createdAt
        FROM document_chunks
        WHERE documentId = ?
        ORDER BY pageNumber, chunkIndex
      `).all(docId);
    },
  };
}
