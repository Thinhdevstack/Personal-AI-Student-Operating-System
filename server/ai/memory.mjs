import { createHash, randomUUID } from 'node:crypto';
import { StudentError } from '../student/storage.mjs';

export const MEMORY_LIMITS = Object.freeze({ contentChars: 1000, globalCount: 50, courseCount: 100, selected: 6, globalSelected: 2, contextChars: 3000 });
const uuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const normalize = (value) => value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
const publicMemory = ({ normalizedContent, ...row }) => row;
const only = (input, fields) => {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((key) => !fields.includes(key))) throw new StudentError('invalidInput');
};
const stopWords = new Set('the a an and or of to in on for is are be i my me you your this that with about explain example give please how what why can could would should tôi mình bạn của là và hay với trong về cho ví dụ giải thích hãy giúp phần đó này những các một được muốn thường ưu tiên'.split(' '));
function tokens(text) {
  return new Set(text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').match(/[\p{L}\p{N}]+/gu)?.filter((word) => word.length > 1 && !normalizedStops.has(word)) || []);
}
const normalizedStops = new Set([...stopWords].map((word) => word.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd')));

export function createMemoryService({ db }) {
  function course(id) {
    if (!uuid(id)) throw new StudentError('invalidInput');
    const row = db.prepare('SELECT c.*, s.status AS semesterStatus FROM courses c JOIN semesters s ON s.id=c.semesterId WHERE c.id=?').get(id);
    if (!row) throw new StudentError('notFound', 404);
    return row;
  }
  function target(input) {
    only(input, ['scope', 'courseId']);
    if (input.scope === 'global' && (input.courseId === undefined || input.courseId === null)) return { scope: 'global', courseId: null };
    if (input.scope !== 'course') throw new StudentError('invalidInput');
    course(input.courseId);
    return { scope: 'course', courseId: input.courseId };
  }
  function content(value) {
    if (typeof value !== 'string' || !value.trim() || value.length > MEMORY_LIMITS.contentChars) throw new StudentError('invalidInput');
    return value.trim().normalize('NFC');
  }
  function list(input) {
    const dest = target(input);
    return db.prepare('SELECT * FROM memories WHERE scope=? AND courseId IS ? ORDER BY updatedAt DESC, id').all(dest.scope, dest.courseId).map(publicMemory);
  }
  function get(id, input) {
    if (!uuid(id)) throw new StudentError('invalidInput');
    const dest = target(input);
    const row = db.prepare('SELECT * FROM memories WHERE id=? AND scope=? AND courseId IS ?').get(id, dest.scope, dest.courseId);
    if (!row) throw new StudentError('notFound', 404);
    return row;
  }
  function create(input) {
    only(input, ['scope', 'courseId', 'content', 'requestId', 'sourceMessageId', 'sourceCourseId']);
    const dest = target({ scope: input.scope, courseId: input.courseId });
    const value = content(input.content);
    if (!uuid(input.requestId)) throw new StudentError('invalidInput');
    const sourceMessageId = input.sourceMessageId ?? null, sourceCourseId = input.sourceCourseId ?? null;
    if ((sourceMessageId !== null || sourceCourseId !== null) && (!uuid(sourceMessageId) || !uuid(sourceCourseId))) throw new StudentError('invalidInput');
    const fingerprint = createHash('sha256').update(JSON.stringify({ ...dest, content: value, sourceMessageId, sourceCourseId })).digest('hex');
    return db.transaction(() => {
      const prior = db.prepare('SELECT * FROM memory_create_requests WHERE requestId=?').get(input.requestId);
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new StudentError('memoryRequestConflict', 409);
        if (!prior.memoryId) throw new StudentError('memoryDeleted', 409);
        return publicMemory(get(prior.memoryId, dest));
      }
      if (sourceMessageId) {
        const source = db.prepare("SELECT c.courseId FROM chat_messages m JOIN chat_conversations c ON c.id=m.conversationId JOIN chat_turns t ON t.id=m.turnId WHERE m.id=? AND t.status='completed'").get(sourceMessageId);
        if (source?.courseId !== sourceCourseId || (dest.scope === 'course' && sourceCourseId !== dest.courseId)) throw new StudentError('memorySourceMismatch', 400);
      }
      let row = db.prepare('SELECT * FROM memories WHERE scope=? AND courseId IS ? AND normalizedContent=?').get(dest.scope, dest.courseId, normalize(value));
      if (!row) {
        const count = db.prepare('SELECT count(*) AS n FROM memories WHERE scope=? AND courseId IS ?').get(dest.scope, dest.courseId).n;
        if (count >= (dest.scope === 'global' ? MEMORY_LIMITS.globalCount : MEMORY_LIMITS.courseCount)) throw new StudentError('memoryLimit', 409);
        const id = randomUUID(), time = new Date().toISOString();
        db.prepare('INSERT INTO memories (id, scope, courseId, content, normalizedContent, sourceMessageId, sourceCourseId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, dest.scope, dest.courseId, value, normalize(value), sourceMessageId, sourceCourseId, time, time);
        row = get(id, dest);
      }
      db.prepare('INSERT INTO memory_create_requests VALUES (?, ?, ?)').run(input.requestId, fingerprint, row.id);
      return publicMemory(row);
    }).immediate();
  }
  function update(id, input, changes) {
    only(changes, ['content']);
    const value = content(changes.content);
    return db.transaction(() => {
      const row = get(id, input);
      if (db.prepare('SELECT id FROM memories WHERE scope=? AND courseId IS ? AND normalizedContent=? AND id<>?').get(row.scope, row.courseId, normalize(value), id)) throw new StudentError('memoryDuplicate', 409);
      db.prepare('UPDATE memories SET content=?, normalizedContent=?, updatedAt=? WHERE id=?').run(value, normalize(value), new Date().toISOString(), id);
      return publicMemory(get(id, input));
    }).immediate();
  }
  function remove(id, input) {
    // Repeated delete is safe, but a different scope may never mutate the row.
    const dest = target(input);
    if (!uuid(id)) throw new StudentError('invalidInput');
    const row = db.prepare('SELECT scope, courseId FROM memories WHERE id=?').get(id);
    if (row && (row.scope !== dest.scope || row.courseId !== dest.courseId)) throw new StudentError('notFound', 404);
    db.prepare('DELETE FROM memories WHERE id=?').run(id);
  }
  function select({ courseId, query, includeArchived = false }) {
    const current = course(courseId);
    if ((current.status === 'archived' || current.semesterStatus === 'archived') && !includeArchived) throw new StudentError('archived', 409);
    const words = tokens(query);
    const rank = (item) => { const terms = tokens(item.content); return [...words].filter((word) => terms.has(word)).length; };
    const globals = list({ scope: 'global' }).map((item) => ({ item, score: rank(item) })).sort((a, b) => b.score - a.score).slice(0, MEMORY_LIMITS.globalSelected);
    const relevant = list({ scope: 'course', courseId }).map((item) => ({ item, score: rank(item) })).filter(({ score }) => score > 0).sort((a, b) => b.score - a.score);
    let budget = MEMORY_LIMITS.contextChars;
    return [...globals, ...relevant].slice(0, MEMORY_LIMITS.selected).flatMap(({ item }) => {
      // Whole memories only: clipping could reverse a preference's meaning.
      if (item.content.length > budget) return [];
      budget -= item.content.length;
      const { id, scope, courseId, content, updatedAt } = item;
      return [{ id, scope, courseId, content, updatedAt }];
    });
  }
  return { list, create, update, remove, select };
}
