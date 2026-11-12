import { createHash, randomUUID } from 'node:crypto';
import { StudentError } from '../student/storage.mjs';
import { buildAIContext } from './context.mjs';
import { invokeTutor } from './tutor.mjs';
import { searchCourseMaterials } from './retrieval.mjs';
import { resolveSourceTarget } from './targeting.mjs';
import { CHAT_LIMITS as L } from './config.mjs';

const now = () => new Date().toISOString();
const uuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function createStudyAssistant({ db, aiRegistry, memory }) {
  const running = new Map();
  db.prepare("UPDATE assistant_turns SET status='failed', errorCode='chatInterrupted' WHERE status='pending'").run();
  function conversation(id) {
    if (!uuid(id)) throw new StudentError('invalidInput');
    const row = db.prepare('SELECT * FROM assistant_conversations WHERE id=?').get(id);
    if (!row) throw new StudentError('notFound', 404);
    return row;
  }
  function title(value) {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 120) throw new StudentError('invalidInput');
    return value.trim();
  }
  function history(id) {
    const thread = conversation(id);
    return { ...thread, turns: db.prepare('SELECT * FROM assistant_turns WHERE conversationId=? ORDER BY sequence').all(id).map(({ fingerprint, ...turn }) => ({ ...turn, scope: JSON.parse(turn.scope), answer: turn.answer ? JSON.parse(turn.answer) : null })) };
  }
  function cancel(id, requestId) {
    conversation(id);
    if (!uuid(requestId)) throw new StudentError('invalidInput');
    const controller = running.get(id + ':' + requestId);
    controller?.abort();
    return { cancelled: !!controller };
  }
  return {
    list: () => db.prepare('SELECT * FROM assistant_conversations ORDER BY updatedAt DESC, id').all(),
    create(input) {
      const id = randomUUID(), timestamp = now();
      db.prepare('INSERT INTO assistant_conversations VALUES (?, ?, ?, ?)').run(id, title(input.title), timestamp, timestamp);
      return history(id);
    },
    rename(id, input) { conversation(id); db.prepare('UPDATE assistant_conversations SET title=?, updatedAt=? WHERE id=?').run(title(input.title), now(), id); return history(id); },
    remove(id) {
      conversation(id);
      if (db.prepare("SELECT 1 FROM assistant_turns WHERE conversationId=? AND status='pending'").get(id)) throw new StudentError('chatBusy', 409);
      db.prepare('DELETE FROM assistant_conversations WHERE id=?').run(id);
    },
    history, cancel,
    close() { for (const controller of running.values()) controller.abort(); },
    async send(id, input, { signal: callerSignal } = {}) {
      conversation(id);
      const fields = ['message', 'requestId', 'courseIds', 'language', 'provider', 'mode'];
      if (!input || Object.keys(input).some((key) => !fields.includes(key)) || typeof input.message !== 'string' || !input.message.trim() || input.message.length > L.messageChars || !uuid(input.requestId) || !Array.isArray(input.courseIds) || input.courseIds.length > 8 || input.courseIds.some((value) => !uuid(value)) || !['vi', 'en'].includes(input.language) || !['materials', 'expanded'].includes(input.mode)) throw new StudentError('invalidInput');
      const courseIds = [...new Set(input.courseIds)].sort();
      const courses = courseIds.map((courseId) => {
        const course = db.prepare('SELECT c.*, s.status AS semesterStatus FROM courses c JOIN semesters s ON s.id=c.semesterId WHERE c.id=?').get(courseId);
        if (!course) throw new StudentError('notFound', 404);
        if (course.status === 'archived' || course.semesterStatus === 'archived') throw new StudentError('archived', 409);
        return course;
      });
      const old = db.prepare('SELECT * FROM assistant_turns WHERE conversationId=? AND requestId=?').get(id, input.requestId);
      const providerId = input.provider || old?.provider || aiRegistry.defaultProvider;
      const scope = JSON.stringify(courseIds);
      const fingerprint = createHash('sha256').update(JSON.stringify({ message: input.message.trim(), courseIds, language: input.language, mode: input.mode, provider: providerId })).digest('hex');
      if (old && old.fingerprint !== fingerprint) throw new StudentError('chatRequestConflict', 409);
      if (old?.status === 'completed') return history(id);
      const selection = aiRegistry.get(providerId);
      if (!selection.configured) throw new StudentError('aiKeyMissing');
      if (db.prepare("SELECT 1 FROM assistant_turns WHERE conversationId=? AND status='pending'").get(id)) throw new StudentError('chatBusy', 409);
      if (old && db.prepare('SELECT 1 FROM assistant_turns WHERE conversationId=? AND sequence>?').get(id, old.sequence)) throw new StudentError('chatStaleRetry', 409);
      const turnId = old?.id || randomUUID();
      if (old) db.prepare("UPDATE assistant_turns SET status='pending', errorCode=NULL WHERE id=?").run(turnId);
      else db.prepare("INSERT INTO assistant_turns (id, conversationId, requestId, fingerprint, scope, message, language, provider, model, mode, status, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,'pending',?)").run(turnId, id, input.requestId, fingerprint, scope, input.message.trim(), input.language, providerId, selection.provider.chatModel || null, input.mode, now());
      const controller = new AbortController(), key = id + ':' + input.requestId;
      running.set(key, controller);
      const signal = callerSignal ? AbortSignal.any([callerSignal, controller.signal]) : controller.signal;
      try {
        // Only history created under the same scope is eligible for this context.
        const recent = db.prepare("SELECT message, answer FROM assistant_turns WHERE conversationId=? AND scope=? AND status='completed' ORDER BY sequence DESC LIMIT ?").all(id, scope, Math.floor(L.historyMessages / 2)).reverse().flatMap((turn) => [{ role: 'user', content: turn.message }, { role: 'assistant', content: JSON.parse(turn.answer).answer }]);
        let clarification;
        const targets = courses.map((course) => ({ course, resolved: resolveSourceTarget({ db, courseId: course.id, message: input.message, lang: input.language }) }));
        const matches = targets.filter(({ resolved }) => resolved?.target || resolved?.targetDoc || resolved?.ambiguous);
        if (matches.length > 1 || matches.some(({ resolved }) => resolved.ambiguous)) clarification = input.language === 'vi' ? 'Có nhiều tài liệu phù hợp. Hãy chọn một môn và nêu rõ tên PDF.' : 'Multiple materials match. Select one course and specify the PDF.';
        const target = matches.length === 1 ? matches[0] : null;
        if (target?.resolved.valid === false) clarification = target.resolved.explanation;
        const results = [];
        if (!clarification) {
          const groups = [];
          for (const course of courses) {
            if (target && target.course.id !== course.id) continue;
            const found = target?.resolved.pageChunks || (await searchCourseMaterials({ db, courseId: course.id, documentId: target?.resolved.targetDoc?.id, query: input.message, aiProvider: aiRegistry.embedding, signal, limit: L.chunks, minScore: L.retrievalMinScore })).results;
            groups.push(found.map((source) => ({ ...source, courseId: course.id, courseName: course.name, documentName: course.name + ' · ' + source.documentName })));
          }
          // Round-robin selection prevents one course from consuming the entire budget.
          for (let index = 0; index < L.chunks; index++) for (const group of groups) if (group[index] && results.length < L.chunks) results.push(group[index]);
        }
        const globals = memory.list({ scope: 'global' }).slice(0, 2);
        const notes = courses.flatMap((course) => memory.select({ courseId: course.id, query: input.message })).filter((note, index, all) => all.findIndex((item) => item.id === note.id) === index);
        const selectedNotes = [...globals, ...notes].filter((note, index, all) => all.findIndex((item) => item.id === note.id) === index);
        const context = buildAIContext({ course: { id: id, name: 'Personal study assistant', code: '', selectedCourseIds: courseIds }, message: input.message, history: recent, results, memories: selectedNotes, lang: input.language, mode: input.mode, contextChars: selection.provider.contextChars });
        if (old?.model) context.model = old.model;
        let answer;
        if (clarification) answer = { answer: clarification, basis: 'insufficient', sources: [], model: 'system', isMock: false };
        else if (!courseIds.length && input.mode === 'materials') answer = { answer: input.language === 'vi' ? 'Hãy chọn môn để hỏi theo tài liệu hoặc chọn chế độ mở rộng.' : 'Select materials or use expanded mode.', basis: 'insufficient', sources: [], model: 'system', isMock: false };
        else answer = await invokeTutor(selection.provider, context, signal);
        if (signal.aborted) throw new StudentError('chatCancelled', 409);
        db.transaction(() => {
          db.prepare("UPDATE assistant_turns SET status='completed', answer=?, model=? WHERE id=?").run(JSON.stringify({ ...answer, memories: context.memories }), answer.model, turnId);
          db.prepare('UPDATE assistant_conversations SET updatedAt=? WHERE id=?').run(now(), id);
        })();
        return history(id);
      } catch (error) {
        db.prepare("UPDATE assistant_turns SET status='failed', errorCode=? WHERE id=?").run(signal.aborted ? 'chatCancelled' : error.code || 'aiUnavailable', turnId);
        throw signal.aborted ? new StudentError('chatCancelled', 409) : error;
      } finally { running.delete(key); }
    },
  };
}
