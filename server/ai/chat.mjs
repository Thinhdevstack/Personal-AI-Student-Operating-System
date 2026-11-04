import { randomUUID } from 'node:crypto';
import { CHAT_LIMITS as L } from './config.mjs';
import { aiError } from './openai.mjs';
import { buildAIContext, retrievalQuestion, validateTutorAnswer } from './context.mjs';
import { searchCourseMaterials } from './retrieval.mjs';
import { StudentError } from '../student/storage.mjs';
import { createMemoryService } from './memory.mjs';

const uuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const time = () => new Date().toISOString();

export function createCourseChat({ db, aiProvider, memory = createMemoryService({ db }), activity }) {
  function course(id) {
    if (!uuid(id)) throw new StudentError('invalidInput');
    const row = db.prepare('SELECT * FROM courses WHERE id=?').get(id);
    if (!row) throw new StudentError('notFound', 404);
    return row;
  }
  function recover(conversationId) {
    db.prepare("UPDATE chat_turns SET status='failed', errorCode='chatInterrupted' WHERE conversationId=? AND status='pending' AND leaseExpiresAt<=?").run(conversationId, Date.now());
  }
  function conversation(courseId, conversationId) {
    const row = db.prepare('SELECT * FROM chat_conversations WHERE courseId=?').get(courseId);
    if (conversationId && (!uuid(conversationId) || row?.id !== conversationId)) throw new StudentError('notFound', 404);
    return row;
  }
  function history(courseId, conversationId) {
    course(courseId);
    const row = conversation(courseId, conversationId);
    if (!row) return { conversationId: null, turns: [], isMock: !!aiProvider.isMock };
    recover(row.id);
    const turns = db.prepare('SELECT id, sequence, requestId, status, errorCode, model, isMock, language, createdAt FROM chat_turns WHERE conversationId=? ORDER BY sequence DESC LIMIT ?').all(row.id, L.visibleTurns).reverse();
    const messages = db.prepare('SELECT m.* FROM chat_messages m JOIN chat_turns t ON t.id=m.turnId WHERE m.conversationId=? AND t.sequence >= ? ORDER BY t.sequence, CASE m.role WHEN \'user\' THEN 0 ELSE 1 END').all(row.id, turns[0]?.sequence || 0);
    return {
      conversationId: row.id, isMock: !!aiProvider.isMock,
      turns: turns.map((turn) => ({ ...turn, isMock: !!turn.isMock, messages: messages.filter((message) => message.turnId === turn.id).map(({ id, role, content, basis, sources, memories, createdAt }) => ({ id, role, content, basis, sources: JSON.parse(sources), memories: JSON.parse(memories), createdAt })) })),
    };
  }
  async function send(input) {
    const fields = ['courseId', 'message', 'requestId', 'language', 'conversationId'];
    if (!input || Object.keys(input).some((key) => !fields.includes(key)) || typeof input.message !== 'string' || !input.message.trim() || input.message.length > L.messageChars || (input.requestId !== undefined && !uuid(input.requestId)) || (input.conversationId !== undefined && !uuid(input.conversationId)) || (input.language !== undefined && !['en','vi'].includes(input.language))) throw new StudentError('invalidInput');
    const activeCourse = course(input.courseId), message = input.message.trim(), language = input.language || 'vi';
    const requestId = input.requestId || randomUUID();
    const claimed = db.transaction(() => {
      let conv = conversation(activeCourse.id, input.conversationId);
      if (!conv) {
        conv = { id: randomUUID() };
        db.prepare('INSERT INTO chat_conversations VALUES (?, ?, ?, ?)').run(conv.id, activeCourse.id, time(), time());
      }
      recover(conv.id);
      const existing = db.prepare('SELECT * FROM chat_turns WHERE conversationId=? AND requestId=?').get(conv.id, requestId);
      if (existing && (existing.userMessage !== message || existing.language !== language)) throw new StudentError('chatRequestConflict', 409);
      if (existing?.status === 'completed') return { replay: true };
      if (db.prepare("SELECT id FROM chat_turns WHERE conversationId=? AND status='pending'").get(conv.id)) throw new StudentError('chatBusy', 409);
      if (existing && db.prepare('SELECT id FROM chat_turns WHERE conversationId=? AND sequence>? LIMIT 1').get(conv.id, existing.sequence)) throw new StudentError('chatStaleRetry', 409);
      const attemptId = randomUUID(), id = existing?.id || randomUUID();
      if (existing) db.prepare("UPDATE chat_turns SET status='pending', errorCode=NULL, attemptId=?, leaseExpiresAt=? WHERE id=?").run(attemptId, Date.now() + L.leaseMs, id);
      else {
        db.prepare("INSERT INTO chat_turns (id, conversationId, requestId, userMessage, language, status, attemptId, leaseExpiresAt, createdAt) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)").run(id, conv.id, requestId, message, language, attemptId, Date.now() + L.leaseMs, time());
        db.prepare("INSERT INTO chat_messages (id, conversationId, turnId, role, content, createdAt) VALUES (?, ?, ?, 'user', ?, ?)").run(randomUUID(), conv.id, id, message, time());
      }
      return { id, conversationId: conv.id, attemptId };
    }).immediate();
    if (claimed.replay) return history(activeCourse.id);
    let phase = 'library.search';
    let notify = () => {};
    try { notify = activity?.begin({ courseId: activeCourse.id, courseName: activeCourse.name, requestId, turnId: claimed.id, attemptId: claimed.attemptId, isMock: !!aiProvider.isMock }) || notify; } catch { /* Optional visualization. */ }
    const emit = (operation, status, count) => { try { notify(operation, status, count); } catch { /* Optional visualization. */ } };
    try {
      emit(phase, 'started');
      if (!db.prepare("SELECT id FROM documents WHERE courseId=? AND status='ready' LIMIT 1").get(activeCourse.id)) throw new StudentError('chatNoMaterials', 409);
      const recent = db.prepare("SELECT m.role, m.content FROM chat_messages m JOIN chat_turns t ON t.id=m.turnId WHERE m.conversationId=? AND t.status='completed' ORDER BY t.sequence DESC, CASE m.role WHEN 'assistant' THEN 0 ELSE 1 END LIMIT ?").all(claimed.conversationId, L.historyMessages).reverse();
      const retrieved = await searchCourseMaterials({ db, courseId: activeCourse.id, query: retrievalQuestion(message, recent), aiProvider, limit: L.chunks, minScore: L.retrievalMinScore, includeArchived: true });
      emit(phase, 'completed', retrieved.results.length);
      phase = 'memory.search'; emit(phase, 'started');
      const memories = memory.select({ courseId: activeCourse.id, query: retrievalQuestion(message, recent), includeArchived: true });
      const context = buildAIContext({ course: activeCourse, message, history: recent, results: retrieved.results, memories, lang: language });
      emit(phase, 'completed', context.memories.length);
      phase = 'ai.respond'; emit(phase, 'started');
      const response = await aiProvider.chat(context);
      const answer = validateTutorAnswer(response, context.sources);
      db.transaction(() => {
        const turn = db.prepare("SELECT id FROM chat_turns WHERE id=? AND attemptId=? AND status='pending' AND leaseExpiresAt>?").get(claimed.id, claimed.attemptId, Date.now());
        if (!turn) throw new StudentError('chatInterrupted', 409);
        db.prepare("INSERT INTO chat_messages (id, conversationId, turnId, role, content, basis, sources, memories, createdAt) VALUES (?, ?, ?, 'assistant', ?, ?, ?, ?, ?)").run(randomUUID(), claimed.conversationId, claimed.id, answer.answer, answer.basis, JSON.stringify(answer.sources), JSON.stringify(context.memories), time());
        db.prepare("UPDATE chat_turns SET status='completed', model=?, isMock=? WHERE id=?").run(aiProvider.chatModel || response.model || 'unknown', aiProvider.isMock ? 1 : 0, claimed.id);
        db.prepare('UPDATE chat_conversations SET updatedAt=? WHERE id=?').run(time(), claimed.conversationId);
      })();
      emit(phase, 'completed'); emit('turn', 'completed');
      return history(activeCourse.id);
    } catch (error) {
      const safe = aiError(error);
      db.prepare("UPDATE chat_turns SET status='failed', errorCode=? WHERE id=? AND attemptId=? AND status='pending'").run(safe.code, claimed.id, claimed.attemptId);
      emit(phase, 'failed'); emit('turn', safe.code === 'chatInterrupted' ? 'interrupted' : 'failed');
      throw safe;
    }
  }
  return { history, send };
}
