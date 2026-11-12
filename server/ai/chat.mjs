import { randomUUID } from 'node:crypto';
import { CHAT_LIMITS as L } from './config.mjs';
import { aiError } from './openai.mjs';
import { buildAIContext, retrievalQuestion, validateTutorAnswer } from './context.mjs';
import { searchCourseMaterials } from './retrieval.mjs';
import { resolveSourceTarget } from './targeting.mjs';
import { StudentError } from '../student/storage.mjs';
import { createMemoryService } from './memory.mjs';
import { registryForProvider } from './providers.mjs';

const uuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const time = () => new Date().toISOString();

function normalizeEchoText(text) {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\b(ban|toi|em|thay|co|minh|your|my|you|i)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isQuestionEcho(answer, question) {
  if (!answer || !question) return false;
  const aNorm = normalizeEchoText(answer);
  const qNorm = normalizeEchoText(question);
  if (!aNorm || !qNorm) return false;
  if (aNorm === qNorm) return true;
  const aTokens = new Set(aNorm.split(' ').filter(Boolean));
  const qTokens = new Set(qNorm.split(' ').filter(Boolean));
  let match = 0;
  for (const t of aTokens) {
    if (qTokens.has(t)) match++;
  }
  const jaccard = match / Math.max(aTokens.size, qTokens.size);
  return jaccard >= 0.8 && aTokens.size <= qTokens.size + 3;
}

export function createCourseChat({ db, aiProvider, memory = createMemoryService({ db }), activity, aiRegistry = registryForProvider(aiProvider) }) {
  const running = new Map();
  const key = (courseId, requestId) => courseId + ':' + requestId;
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
    const turns = db.prepare('SELECT id, sequence, requestId, status, errorCode, model, isMock, provider, mode, language, createdAt, sourceTarget FROM chat_turns WHERE conversationId=? ORDER BY sequence DESC LIMIT ?').all(row.id, L.visibleTurns).reverse();
    const messages = db.prepare('SELECT m.* FROM chat_messages m JOIN chat_turns t ON t.id=m.turnId WHERE m.conversationId=? AND t.sequence >= ? ORDER BY t.sequence, CASE m.role WHEN \'user\' THEN 0 ELSE 1 END').all(row.id, turns[0]?.sequence || 0);
    return {
      conversationId: row.id, isMock: !!aiProvider.isMock,
      turns: turns.map((turn) => ({
        ...turn,
        sourceTarget: turn.sourceTarget ? JSON.parse(turn.sourceTarget) : null,
        ...(turn.status === 'pending' && { phase: running.get(key(courseId, turn.requestId))?.phase }),
        isMock: !!turn.isMock,
        messages: messages.filter((message) => message.turnId === turn.id).map(({ id, role, content, basis, sources, memories, createdAt }) => ({ id, role, content, basis, sources: JSON.parse(sources), memories: JSON.parse(memories), createdAt })),
      })),
    };
  }
  async function send(input, { signal: callerSignal } = {}) {
    const fields = ['courseId', 'message', 'requestId', 'language', 'conversationId', 'provider', 'mode', 'webSearch', 'model', 'documentId', 'pageNumber', 'sourceTarget'];
    if (input?.provider !== undefined && !['openai', 'gemini', 'deepseek', 'ollama', 'ollama-cloud', 'mock'].includes(input.provider)) throw new StudentError('aiProviderInvalid');
    if (input?.mode !== undefined && !['materials', 'expanded'].includes(input.mode)) throw new StudentError('invalidInput');
    if (input?.webSearch !== undefined && typeof input.webSearch !== 'boolean') throw new StudentError('invalidInput');
    if (input?.webSearch) throw new StudentError('webNotConfigured', 409);
    if (!input || Object.keys(input).some((key) => !fields.includes(key)) || typeof input.message !== 'string' || !input.message.trim() || input.message.length > L.messageChars || (input.requestId !== undefined && !uuid(input.requestId)) || (input.conversationId !== undefined && !uuid(input.conversationId)) || (input.language !== undefined && !['en','vi'].includes(input.language))) throw new StudentError('invalidInput');
    const activeCourse = course(input.courseId), message = input.message.trim(), language = input.language || 'vi';
    const requestId = input.requestId || randomUUID();
    const explicitTarget = input.sourceTarget || (input.documentId ? { documentId: input.documentId, pageNumber: input.pageNumber } : undefined);
    const resolvedTarget = resolveSourceTarget({ db, courseId: activeCourse.id, message, explicitTarget, lang: language });
    const targetPayload = resolvedTarget?.target ? JSON.stringify(resolvedTarget.target) : null;

    const claimed = db.transaction(() => {
      let conv = conversation(activeCourse.id, input.conversationId);
      if (!conv) {
        conv = { id: randomUUID() };
        db.prepare('INSERT INTO chat_conversations VALUES (?, ?, ?, ?)').run(conv.id, activeCourse.id, time(), time());
      }
      recover(conv.id);
      const existing = db.prepare('SELECT * FROM chat_turns WHERE conversationId=? AND requestId=?').get(conv.id, requestId);
      const providerId = input.provider ?? existing?.provider ?? aiRegistry.defaultProvider;
      const mode = input.mode ?? existing?.mode ?? 'expanded';
      const model = input.model ?? existing?.model ?? null;
      const finalSourceTarget = targetPayload ?? existing?.sourceTarget ?? null;
      if (existing && (existing.userMessage !== message || existing.language !== language || existing.provider !== providerId || existing.mode !== mode || (input.model !== undefined && existing.model !== input.model) || (explicitTarget && targetPayload !== existing.sourceTarget))) throw new StudentError('chatRequestConflict', 409);
      if (existing?.status === 'completed') return { replay: true };
      if (db.prepare("SELECT id FROM chat_turns WHERE conversationId=? AND status='pending'").get(conv.id)) throw new StudentError('chatBusy', 409);
      if (existing && db.prepare('SELECT id FROM chat_turns WHERE conversationId=? AND sequence>? LIMIT 1').get(conv.id, existing.sequence)) throw new StudentError('chatStaleRetry', 409);
      const attemptId = randomUUID(), id = existing?.id || randomUUID();
      const leaseMs = (providerId === 'ollama' || providerId === 'ollama-cloud') ? 600_000 : L.leaseMs;
      if (existing) db.prepare("UPDATE chat_turns SET status='pending', errorCode=NULL, attemptId=?, leaseExpiresAt=? WHERE id=?").run(attemptId, Date.now() + leaseMs, id);
      else {
        db.prepare("INSERT INTO chat_turns (id, conversationId, requestId, userMessage, language, status, attemptId, leaseExpiresAt, createdAt, provider, mode, model, sourceTarget) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)").run(id, conv.id, requestId, message, language, attemptId, Date.now() + leaseMs, time(), providerId, mode, model, finalSourceTarget);
        db.prepare("INSERT INTO chat_messages (id, conversationId, turnId, role, content, createdAt) VALUES (?, ?, ?, 'user', ?, ?)").run(randomUUID(), conv.id, id, message, time());
      }
      return { id, conversationId: conv.id, attemptId, providerId, mode, model, resolvedTarget };
    }).immediate();
    if (claimed.replay) return history(activeCourse.id);
    const controller = new AbortController();
    const signal = callerSignal ? AbortSignal.any([callerSignal, controller.signal]) : controller.signal;
    const run = { controller, phase: 'library.search' };
    running.set(key(activeCourse.id, requestId), run);
    const checkCancelled = () => { if (signal.aborted) throw new StudentError('chatCancelled', 409); };
    let selection, selectionError;
    try { selection = aiRegistry.get(claimed.providerId); } catch (error) { selectionError = error; }
    const simulated = !!aiProvider.isMock || !!selection?.provider.isMock;
    let phase = 'library.search';
    let notify = () => {};
    try { notify = activity?.begin({ courseId: activeCourse.id, courseName: activeCourse.name, requestId, turnId: claimed.id, attemptId: claimed.attemptId, isMock: simulated }) || notify; } catch { /* Optional visualization. */ }
    const emit = (operation, status, count) => { run.phase = operation; try { notify(operation, status, count); } catch { /* Optional visualization. */ } };
    try {
      emit(phase, 'started');
      checkCancelled();
      if (selectionError) throw selectionError;
      if (!selection.configured) throw new StudentError('aiKeyMissing');

      // If document/page target is ambiguous or invalid, explain directly without calling AI
      if (claimed.resolvedTarget?.ambiguous || (claimed.resolvedTarget && claimed.resolvedTarget.valid === false)) {
        const directAnswer = {
          answer: claimed.resolvedTarget.explanation,
          basis: 'insufficient',
          sources: [],
        };
        db.transaction(() => {
          const turn = db.prepare("SELECT id FROM chat_turns WHERE id=? AND attemptId=? AND status='pending' AND leaseExpiresAt>?").get(claimed.id, claimed.attemptId, Date.now());
          if (!turn) throw new StudentError('chatInterrupted', 409);
          db.prepare("INSERT INTO chat_messages (id, conversationId, turnId, role, content, basis, sources, memories, createdAt) VALUES (?, ?, ?, 'assistant', ?, ?, ?, ?, ?)").run(randomUUID(), claimed.conversationId, claimed.id, directAnswer.answer, directAnswer.basis, JSON.stringify(directAnswer.sources), JSON.stringify([]), time());
          db.prepare("UPDATE chat_turns SET status='completed', model=?, isMock=? WHERE id=?").run(claimed.model || selection?.provider.chatModel || 'system', simulated ? 1 : 0, claimed.id);
          db.prepare('UPDATE chat_conversations SET updatedAt=? WHERE id=?').run(time(), claimed.conversationId);
        })();
        emit(phase, 'completed', 0); emit('turn', 'completed');
        return history(activeCourse.id);
      }

      const hasMaterials = !!db.prepare("SELECT id FROM documents WHERE courseId=? AND status='ready' LIMIT 1").get(activeCourse.id);
      if (!hasMaterials && claimed.mode === 'materials') throw new StudentError('chatNoMaterials', 409);
      if (!hasMaterials && input.mode === undefined) throw new StudentError('chatNoMaterials', 409);
      const recent = db.prepare("SELECT m.role, m.content FROM chat_messages m JOIN chat_turns t ON t.id=m.turnId WHERE m.conversationId=? AND t.status='completed' ORDER BY t.sequence DESC, CASE m.role WHEN 'assistant' THEN 0 ELSE 1 END LIMIT ?").all(claimed.conversationId, L.historyMessages).reverse();

      let retrievedResults = [];
      if (claimed.resolvedTarget?.valid && claimed.resolvedTarget.pageChunks?.length) {
        retrievedResults = [...claimed.resolvedTarget.pageChunks];
      }
      if (hasMaterials && retrievedResults.length < L.chunks) {
        const semantic = await searchCourseMaterials({ db, courseId: activeCourse.id, query: retrievalQuestion(message, recent), aiProvider, limit: L.chunks, minScore: L.retrievalMinScore, includeArchived: true, signal });
        const existingChunkIds = new Set(retrievedResults.map((r) => r.chunkId));
        for (const res of semantic.results) {
          if (!existingChunkIds.has(res.chunkId)) {
            retrievedResults.push(res);
          }
        }
      }
      checkCancelled();
      emit(phase, 'completed', retrievedResults.length);
      phase = 'memory.search'; emit(phase, 'started');
      const memories = memory.select({ courseId: activeCourse.id, query: retrievalQuestion(message, recent), includeArchived: true });
      const context = buildAIContext({ course: activeCourse, message, history: recent, results: retrievedResults.slice(0, L.chunks), memories, lang: language, mode: claimed.mode, contextChars: selection.provider.contextChars });
      if (claimed.model) context.model = claimed.model;
      emit(phase, 'completed', context.memories.length);
      phase = 'ai.respond'; emit(phase, 'started');
      let response = await selection.provider.chat(context, { signal });
      checkCancelled();
      const echoed = isQuestionEcho(response.answer, message);
      if ((claimed.mode === 'materials' && response.basis === 'general') || (response.basis === 'insufficient' && (echoed || response.answer?.trim().toLowerCase() === message.toLowerCase())) || (response.basis === 'materials' && echoed)) {
        const unavailable = claimed.mode === 'expanded'
          ? (language === 'vi' ? 'Mô hình chưa giải thích được câu này một cách tin cậy. Hãy bổ sung tài liệu mô tả chi tiết hoặc nêu rõ ngữ cảnh của thuật ngữ.' : 'The model could not explain this reliably. Add detailed material or clarify the context of the term.')
          : (language === 'vi' ? 'Tài liệu truy xuất chưa đủ căn cứ để trả lời câu hỏi này. Hãy bổ sung tài liệu hoặc chọn Tài liệu + mở rộng.' : 'The retrieved materials do not provide enough evidence. Add a document or choose Materials + expanded knowledge.');
        response = { ...response, answer: unavailable, basis: 'insufficient', sourceIds: [] };
      }
      if (response.basis === 'materials' && !context.sources.length) {
        response = { ...response, basis: 'insufficient', sourceIds: [] };
      }
      const answer = validateTutorAnswer(response, context.sources);
      db.transaction(() => {
        const turn = db.prepare("SELECT id FROM chat_turns WHERE id=? AND attemptId=? AND status='pending' AND leaseExpiresAt>?").get(claimed.id, claimed.attemptId, Date.now());
        if (!turn) throw new StudentError('chatInterrupted', 409);
        db.prepare("INSERT INTO chat_messages (id, conversationId, turnId, role, content, basis, sources, memories, createdAt) VALUES (?, ?, ?, 'assistant', ?, ?, ?, ?, ?)").run(randomUUID(), claimed.conversationId, claimed.id, answer.answer, answer.basis, JSON.stringify(answer.sources), JSON.stringify(context.memories), time());
        const finalModel = response.model || claimed.model || selection.provider.chatModel || 'unknown';
        db.prepare("UPDATE chat_turns SET status='completed', model=?, isMock=? WHERE id=?").run(finalModel, simulated ? 1 : 0, claimed.id);
        db.prepare('UPDATE chat_conversations SET updatedAt=? WHERE id=?').run(time(), claimed.conversationId);
      })();
      emit(phase, 'completed'); emit('turn', 'completed');
      return history(activeCourse.id);
    } catch (error) {
      const safe = signal.aborted ? new StudentError('chatCancelled', 409) : aiError(error);
      db.prepare("UPDATE chat_turns SET status='failed', errorCode=? WHERE id=? AND attemptId=? AND status='pending'").run(safe.code, claimed.id, claimed.attemptId);
      emit(phase, 'failed'); emit('turn', ['chatInterrupted', 'chatCancelled'].includes(safe.code) ? 'interrupted' : 'failed');
      throw safe;
    } finally { running.delete(key(activeCourse.id, requestId)); }
  }
  function cancel(courseId, requestId) {
    course(courseId);
    if (!uuid(requestId)) throw new StudentError('invalidInput');
    const run = running.get(key(courseId, requestId));
    run?.controller.abort();
    return { cancelled: !!run };
  }
  return { history, send, cancel };
}
