import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { createOllama } from '../../server/ai/ollama.mjs';
import { createProviderRegistry } from '../../server/ai/providers.mjs';
import { createMockAIProvider } from '../../server/ai/openai.mjs';
import { createStudentService } from '../../server/student/service.mjs';
import { configureStudentLocal } from '../../server/student/local-config.mjs';
import { createStudentRoutes } from '../../server/student/routes.mjs';
import { studentPdf } from '../fixtures/student-pdf.mjs';
import { demoPdf } from '../../server/student/demo-pdf.mjs';

async function upstream(t, handler) {
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
    handler(req, res, body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return 'http://127.0.0.1:' + server.address().port;
}
const ctx = { instructions: 'Return JSON.', input: [{ role: 'user', content: 'Explain SQL.' }] };
const answer = { answer: 'A primary key identifies a row.', basis: 'general', sourceIds: [] };

test('Ollama native HTTP contract: local status, bounded batches, normalized embedding, schema and non-thinking chat', async (t) => {
  const calls = [];
  const baseURL = await upstream(t, (req, res, body) => {
    calls.push({ url: req.url, body, headers: req.headers });
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'qwen3:4b' }, { name: 'embeddinggemma:latest' }] }));
    if (req.url === '/api/embed') return res.end(JSON.stringify({ embeddings: body.input.map(() => [3, 4, 0]) }));
    res.end(JSON.stringify({ done: true, done_reason: 'stop', message: { content: JSON.stringify(answer) } }));
  });
  const client = createOllama({ baseURL, dimensions: 3 });
  const status = await client.status();
  assert.equal(status.connected && status.chatReady && status.embeddingReady, true);
  assert.deepEqual((await client.embedding.embed(Array(9).fill('Primary keys')))[0], [0.6, 0.8, 0]);
  assert.equal(calls.filter((c) => c.url === '/api/embed').length, 2);
  assert.equal((await client.chat.chat(ctx)).answer, answer.answer);
  const request = calls.at(-1);
  assert.equal(request.url, '/api/chat'); assert.equal(request.body.stream, false);
  assert.equal(request.body.think, false); assert.equal(request.body.format.type, 'object');
  assert.equal(request.body.options.num_ctx, 8192); assert.equal(request.body.options.num_predict, 2048);
  assert.ok(calls.every((c) => !c.headers.authorization));
  assert.match(client.embedding.model, /^ollama\//);
});

test('Ollama failures are sanitized: missing model, memory, connection, invalid JSON/vectors and incomplete answer', async () => {
  for (const [status, data, code] of [
    [404, { error: 'PRIVATE model not found' }, 'ollamaModelMissing'],
    [500, { error: 'PRIVATE not enough memory' }, 'ollamaMemory'],
    [500, { error: 'PRIVATE other error' }, 'ollamaUnavailable'],
    [200, { done: false }, 'aiIncomplete'],
    [200, { done: true, done_reason: 'length' }, 'aiIncomplete'],
    [200, { done: true, message: { content: 'invalid JSON' } }, 'aiInvalidResponse'],
  ]) {
    const client = createOllama({ fetch: async () => Response.json(data, { status }) });
    await assert.rejects(client.chat.chat(ctx), (e) => e.code === code && !e.message.includes('PRIVATE'));
  }
  const disconnected = createOllama({ fetch: async () => { throw new TypeError('PRIVATE'); } });
  assert.equal((await disconnected.status()).connected, false);
  await assert.rejects(disconnected.embedding.embed(['SQL']), /ollamaUnavailable/);
  for (const vectors of [[[0, 0, 0]], [[1, 2]], [[1, null, 3]], []]) {
    await assert.rejects(createOllama({ dimensions: 3, fetch: async () => Response.json({ embeddings: vectors }) }).embedding.embed(['SQL']), /aiEmbeddingMismatch/);
  }
  for (const baseURL of ['https://example.com', 'http://192.168.1.1:11434', 'http://127.0.0.1/a', 'http://user:secret@localhost:11434']) assert.throws(() => createOllama({ baseURL }), /ollamaConfig/);
});

test('Ollama permits one inference; cancellation and timeout release its slot', async (t) => {
  const baseURL = await upstream(t, () => {});
  const client = createOllama({ baseURL, timeoutMs: 100 });
  const controller = new AbortController();
  const pending = client.chat.chat(ctx, { signal: controller.signal });
  const checked = assert.rejects(pending, /chatCancelled/);
  await assert.rejects(client.embedding.embed(['SQL']), /ollamaBusy/);
  controller.abort(); await checked;
  await assert.rejects(client.chat.chat(ctx), /aiTimeout/);
  // A timed out request must not leave the client permanently busy.
  await assert.rejects(client.chat.chat(ctx), /aiTimeout/);
});

test('expanded Ollama responses separate supplied evidence and additional model knowledge into visible sections', async () => {
  let sent;
  const client = createOllama({ fetch: async (_url, init) => {
    sent = JSON.parse(init.body);
    return Response.json({ done: true, message: { content: JSON.stringify({ answer: 'Primary keys identify rows.', basis: 'materials', sourceIds: ['S1'], additionalKnowledge: 'An extra SQL example.' }) } });
  } });
  const response = await client.chat.chat({ ...ctx, mode: 'expanded', lang: 'vi' });
  assert.match(response.answer, /^Theo tài liệu:/);
  assert.match(response.answer, /Bổ sung từ kiến thức mô hình \(chưa xác minh\):\nAn extra SQL example/);
  assert.ok(sent.format.required.includes('additionalKnowledge'));
  assert.deepEqual(response.sourceIds, ['S1']);
});

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'student-local-'));
  const embedding = { ...createMockAIProvider(), providerId: 'ollama', model: 'ollama/test-embed', isMock: false };
  const calls = [];
  const chat = { providerId: 'ollama', chatModel: 'test-chat', isMock: false, async chat(context) { calls.push(context); return { answer: 'Model explanation', basis: 'materials', sourceIds: [context.sources[0]?.sourceId] }; } };
  const registry = createProviderRegistry({ embedding, entries: [{ id: 'ollama', provider: chat, configured: true }], defaultProvider: 'ollama' });
  let service = createStudentService(dir, { aiRegistry: registry });
  const semester = service.createSemester({ name: 'Semester', academicYear: '2026' });
  const oop = service.createCourse({ semesterId: semester.id, name: 'OOP' });
  const database = service.createCourse({ semesterId: semester.id, name: 'Database' });
  t.after(() => { service.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { dir, embedding, chat, calls, oop, database, get service() { return service; }, reopen() { service.close(); service = createStudentService(dir, { aiRegistry: registry }); } };
}
const question = (courseId, mode = 'materials') => ({ courseId, mode, provider: 'ollama', language: 'vi', message: 'Explain aggregation and composition', requestId: randomUUID() });
async function add(f, course, text, name = 'course.pdf') {
  const doc = f.service.addMaterial(course.id, studentPdf([text]), name, 'application/pdf');
  await f.service.processDocument(doc.id); return doc;
}

test('local RAG is course scoped; mode and provider survive retry/replay/reopen; document-only guards general answers', async (t) => {
  const f = fixture(t);
  const doc = await add(f, f.oop, 'Aggregation and composition in OOP.', 'OOP.pdf');
  await add(f, f.database, 'SQL primary keys and database transactions.', 'Database.pdf');
  const input = question(f.oop.id);
  const response = await f.service.sendChat(input);
  assert.equal(response.isMock, false);
  assert.equal(response.turns[0].mode, 'materials');
  assert.equal(response.turns[0].messages[1].sources[0].documentId, doc.id);
  assert.ok(!JSON.stringify(f.calls[0].input).includes('Database.pdf'));
  assert.match(f.calls[0].instructions, /DOCUMENT-ONLY MODE/);
  f.reopen();
  assert.deepEqual(await f.service.sendChat(input), response);
  await assert.rejects(f.service.sendChat({ ...input, mode: 'expanded' }), /chatRequestConflict/);
  f.chat.chat = async () => answer;
  const strict = await f.service.sendChat(question(f.oop.id));
  assert.equal(strict.turns.at(-1).messages[1].basis, 'insufficient');
  const expanded = await f.service.sendChat(question(f.oop.id, 'expanded'));
  assert.equal(expanded.turns.at(-1).messages[1].basis, 'general');
  assert.deepEqual(expanded.turns.at(-1).messages[1].sources, []);
  const bare = f.service.createCourse({ semesterId: f.oop.semesterId, name: 'No PDF' });
  assert.equal((await f.service.sendChat(question(bare.id, 'expanded'))).turns[0].status, 'completed');
  await assert.rejects(f.service.sendChat({ ...question(f.oop.id), webSearch: true }), /webNotConfigured/);
  assert.equal(f.service.aiSettings().webSearch.configured, false);
});

test('reindex retains old provider/model vectors and chunk IDs; a failed reindex preserves the usable old index', async (t) => {
  const f = fixture(t), doc = await add(f, f.oop, 'Aggregation and composition in OOP.');
  const first = f.service.db.prepare('SELECT * FROM chunk_embeddings').get();
  f.embedding.model = 'ollama/other-model';
  assert.equal(f.service.materials(f.oop.id)[0].indexReady, false);
  await assert.rejects(f.service.search(f.oop.id, 'aggregation'), /aiIndexMismatch/);
  await f.service.processDocument(doc.id);
  assert.equal(f.service.db.prepare('SELECT count(*) AS n FROM chunk_embeddings').get().n, 2);
  assert.deepEqual(f.service.db.prepare('SELECT embedding FROM chunk_embeddings WHERE model=?').get(first.model).embedding, first.embedding);
  assert.ok(f.service.db.prepare('SELECT chunkId FROM chunk_embeddings').all().every((row) => row.chunkId === first.chunkId));
  f.embedding.providerId = 'other-provider';
  await assert.rejects(f.service.search(f.oop.id, 'aggregation'), /aiIndexMismatch/);
  f.embedding.providerId = 'ollama';
  f.embedding.model = first.model;
  assert.ok((await f.service.search(f.oop.id, 'aggregation')).results.length);
  const embed = f.embedding.embed;
  f.embedding.embed = async () => { throw new Error('fail'); };
  await assert.rejects(f.service.processDocument(doc.id));
  assert.equal(f.service.materials(f.oop.id)[0].status, 'ready');
  f.embedding.embed = embed;
  assert.ok((await f.service.search(f.oop.id, 'aggregation')).results.length);
});

test('generated teaching PDFs wrap long text so the extraction includes the last example', async (t) => {
  const f = fixture(t);
  const text = 'Aggregation: a whole references independent parts. Parts may outlive the whole. Example: a Department references Teachers. Composition: the whole owns the lifetime of its parts. A part belongs to one whole. Example: a House owns its Rooms.';
  const doc = f.service.addMaterial(f.oop.id, demoPdf([text]), 'wrapped.pdf', 'application/pdf');
  await f.service.processDocument(doc.id);
  assert.equal(f.service.documentChunks(doc.id).map((c) => c.content).join(' ').replace(/\s+/g, ' ').trim(), text);
});

test('cancelling an active course turn stops inference, preserves user history and retries the original request', async (t) => {
  const f = fixture(t); await add(f, f.oop, 'Aggregation and composition in OOP.');
  let started;
  const reachedModel = new Promise((resolve) => { started = resolve; });
  f.chat.chat = async (_context, { signal }) => {
    started();
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
  };
  const input = question(f.oop.id), pending = f.service.sendChat(input);
  const checked = assert.rejects(pending, /chatCancelled/);
  await reachedModel;
  assert.equal(f.service.chatHistory(f.oop.id).turns[0].phase, 'ai.respond');
  assert.equal(f.service.cancelChat(f.database.id, input.requestId).cancelled, false);
  assert.equal(f.service.cancelChat(f.oop.id, input.requestId).cancelled, true);
  await checked;
  const turn = f.service.chatHistory(f.oop.id).turns[0];
  assert.equal(turn.errorCode, 'chatCancelled'); assert.equal(turn.messages.length, 1);
  f.chat.chat = async () => answer;
  const response = await f.service.sendChat(input);
  assert.equal(response.turns.length, 1); assert.equal(response.turns[0].status, 'completed');
});

test('local capability and cancellation routes require auth and same origin; local mode never inherits mock', async (t) => {
  const env = { OFFICE_STUDENT_LOCAL: '1', AI_OFFLINE_MODE: '1', AI_CHAT_PROVIDER: 'gemini', OPENAI_API_KEY: 'keep-private', OFFICE_DATA_DIR: 'keep-data' };
  assert.equal(configureStudentLocal(env), true);
  assert.equal(env.AI_OFFLINE_MODE, '0'); assert.equal(env.AI_CHAT_PROVIDER, 'ollama');
  assert.equal(env.OFFICE_DATA_DIR, 'keep-data'); assert.equal(env.OPENAI_API_KEY, 'keep-private');
  assert.equal(configureStudentLocal({ OFFICE_STUDENT_LOCAL: '1', OFFICE_STUDENT_DEMO: '1' }), false);
  const f = fixture(t);
  const route = createStudentRoutes({ service: f.service, authorized: (req) => req.headers.authorization === 'test', sameOrigin: (req) => req.headers.origin === 'http://localhost' });
  const server = http.createServer((req, res) => route(req, res, new URL(req.url, 'http://localhost')));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = 'http://127.0.0.1:' + server.address().port + '/api/student';
  assert.equal((await fetch(url + '/ai/local')).status, 401);
  const response = await fetch(url + '/ai/local', { headers: { authorization: 'test' } });
  assert.equal(response.status, 200); assert.equal((await response.json()).connected, false);
  const cancel = `/courses/${f.oop.id}/cancel`;
  assert.equal((await fetch(url + cancel, { method: 'POST', headers: { authorization: 'test' } })).status, 403);
  assert.equal((await fetch(url + cancel, { method: 'POST', headers: { authorization: 'test', origin: 'http://localhost', 'content-type': 'application/json' }, body: JSON.stringify({ requestId: randomUUID() }) })).status, 200);
});

test('migration 006 preserves existing vectors, provider history, foreign keys and messages', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'student-local-upgrade-'));
  const old = new Database(path.join(dir, 'student.sqlite'));
  old.exec('PRAGMA foreign_keys=ON; CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, appliedAt TEXT NOT NULL)');
  for (const [index, name] of ['001-academic.sql', '002-chunks.sql', '003-chat.sql', '004-memory.sql', '005-chat-provider.sql'].entries()) {
    old.exec(fs.readFileSync(new URL('../../server/student/migrations/' + name, import.meta.url), 'utf8'));
    old.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(index + 1, 'now');
  }
  const [semester, course, doc, chunk, conv, turn, message, requestId] = Array.from({ length: 8 }, () => randomUUID());
  old.prepare("INSERT INTO semesters VALUES (?, 'Semester', '2026', NULL, NULL, 'active', 1, 'now', 'now')").run(semester);
  old.prepare("INSERT INTO courses VALUES (?, ?, 'OOP', '', '', 'active', 'now', 'now')").run(course, semester);
  old.prepare("INSERT INTO documents (id, courseId, filename, originalFilename, mimeType, storagePath, sizeBytes, pageCount, status, uploadedAt) VALUES (?, ?, 'source.pdf', 'old.pdf', 'application/pdf', 'preserved-path', 100, 1, 'ready', 'now')").run(doc, course);
  old.prepare("INSERT INTO document_chunks VALUES (?, ?, ?, 1, 0, 'Preserved course text', 5, 'now')").run(chunk, doc, course);
  const vector = Buffer.from(new Float32Array([0.6, 0.8, 0]).buffer);
  old.prepare("INSERT INTO chunk_embeddings VALUES (?, ?, 'gemini/old-model', 3, 'v1', 'now')").run(chunk, vector);
  old.prepare("INSERT INTO chat_conversations VALUES (?, ?, 'now', 'now')").run(conv, course);
  old.prepare("INSERT INTO chat_turns (id, conversationId, requestId, userMessage, language, status, attemptId, leaseExpiresAt, createdAt, provider) VALUES (?, ?, ?, 'Old question', 'vi', 'completed', ?, 0, 'now', 'deepseek')").run(turn, conv, requestId, randomUUID());
  old.prepare("INSERT INTO chat_messages (id, conversationId, turnId, role, content, basis, sources, createdAt) VALUES (?, ?, ?, 'assistant', 'Old answer', 'general', '[]', 'now')").run(message, conv, turn);
  old.close();
  const service = createStudentService(dir, { aiProvider: createMockAIProvider() });
  t.after(() => { service.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const migrated = service.db.prepare('SELECT * FROM chunk_embeddings').get();
  assert.deepEqual(migrated.embedding, vector); assert.equal(migrated.provider, 'gemini');
  assert.equal(migrated.chunkId, chunk); assert.equal(migrated.modelVersion, 'v1');
  const history = service.chatHistory(course);
  assert.equal(history.turns[0].provider, 'deepseek'); assert.equal(history.turns[0].mode, 'expanded');
  assert.equal(history.turns[0].messages[0].content, 'Old answer');
  assert.deepEqual(service.db.pragma('foreign_key_check'), []);
});
