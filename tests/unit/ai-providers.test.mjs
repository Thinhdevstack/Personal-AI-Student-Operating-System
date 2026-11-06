import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { createCompatibleChatProvider } from '../../server/ai/compatible.mjs';
import { createGeminiEmbeddings } from '../../server/ai/gemini.mjs';
import { createAIProviders, createProviderRegistry } from '../../server/ai/providers.mjs';
import { createMockAIProvider } from '../../server/ai/openai.mjs';
import { createStudentService } from '../../server/student/service.mjs';
import { createStudentRoutes } from '../../server/student/routes.mjs';
import { studentPdf } from '../fixtures/student-pdf.mjs';

const result = { answer: 'Example explanation', basis: 'general', sourceIds: [] };
const completion = (content = JSON.stringify(result), finish = 'stop') => ({ choices: [{ finish_reason: finish, message: { content } }] });
const context = { instructions: 'Return JSON for the tutor.', input: [{ role: 'user', content: 'Explain composition' }] };

test('Gemini and DeepSeek use separate fixed upstreams, keys and supported JSON formats through the installed SDK', async () => {
  for (const id of ['gemini', 'deepseek']) {
    const calls = [];
    const provider = createCompatibleChatProvider({ id, apiKey: id + '-test-secret', model: id + '-model', fetch: async (url, init) => {
      calls.push({ url: String(url), key: new Headers(init.headers).get('authorization'), body: JSON.parse(init.body) });
      return Response.json(completion());
    } });
    assert.equal((await provider.chat(context)).answer, result.answer);
    assert.equal(calls[0].url, id === 'gemini' ? 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions' : 'https://api.deepseek.com/chat/completions');
    assert.equal(calls[0].key, 'Bearer ' + id + '-test-secret');
    assert.equal(calls[0].body.model, id + '-model');
    assert.equal(calls[0].body.messages[0].role, 'system');
    assert.equal(calls[0].body.max_tokens, 4096);
    assert.equal(calls[0].body.response_format.type, id === 'gemini' ? 'json_schema' : 'json_object');
    if (id === 'deepseek') assert.equal(calls[0].body.thinking.type, 'disabled');
    assert.equal(calls[0].body.tools, undefined);
  }
});

test('compatible providers reject incomplete, blank, invalid JSON and refusals, and sanitize errors without fallback', async () => {
  let data = completion(), calls = 0;
  const client = { chat: { completions: { create: async () => { calls++; return data; } } } };
  const provider = createCompatibleChatProvider({ id: 'deepseek', client, model: 'deepseek-flash' });
  for (const [value, error] of [[completion('', 'length'), 'aiIncomplete'], [completion('   '), 'aiInvalidResponse'], [completion('not json'), 'aiInvalidResponse'], [completion('', 'content_filter'), 'aiRefused']]) {
    data = value; await assert.rejects(provider.chat(context), new RegExp(error));
  }
  client.chat.completions.create = async () => { calls++; throw { status: 401, message: 'PRIVATE_KEY_OR_PROMPT' }; };
  await assert.rejects(provider.chat(context), (error) => error.code === 'aiKeyInvalid' && !error.message.includes('PRIVATE'));
  assert.equal(calls, 5);
  await assert.rejects(createCompatibleChatProvider({ id: 'gemini', apiKey: '', model: 'gemini-3.6-flash' }).chat(context), /aiKeyMissing/);
  assert.throws(() => createCompatibleChatProvider({ id: 'unknown' }), /aiProviderInvalid/);
});

test('Gemini embedding batches send explicit dimensions and authenticate without a key in the URL; vectors are validated and normalized', async () => {
  const calls = [];
  const provider = createGeminiEmbeddings({ apiKey: 'gemini-embedding-test-secret', model: 'gemini-embedding-2', dimensions: 3, fetch: async (url, init) => {
    const body = JSON.parse(init.body); calls.push({ url, init, body });
    return Response.json({ embeddings: body.requests.map(() => ({ values: [3, 4, 0] })) });
  } });
  const vectors = await provider.embed(Array.from({ length: 65 }, (_, i) => 'text ' + i));
  assert.equal(calls.length, 2); assert.equal(vectors.length, 65); assert.deepEqual(vectors[0], [0.6, 0.8, 0]);
  assert.equal(calls[0].url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:batchEmbedContents');
  assert.ok(!calls[0].url.includes('secret'));
  assert.equal(calls[0].init.headers['x-goog-api-key'], 'gemini-embedding-test-secret');
  assert.equal(calls[0].body.requests[0].outputDimensionality, 3);
  assert.equal(provider.model, 'gemini/gemini-embedding-2');
  const malformed = createGeminiEmbeddings({ apiKey: 'test', dimensions: 3, fetch: async () => Response.json({ embeddings: [{ values: [1, 0] }] }) });
  await assert.rejects(malformed.embed(['text']), /aiEmbeddingMismatch/);
});

test('Gemini embedding errors map auth/quota/timeout/network safely without returning upstream content', async () => {
  for (const [status, body, expected] of [[400, { error: { details: [{ reason: 'API_KEY_INVALID' }], message: 'SECRET' } }, 'aiKeyInvalid'], [429, { error: { message: 'SECRET' } }, 'aiRateLimit'], [404, {}, 'aiModelUnavailable']]) {
    const provider = createGeminiEmbeddings({ apiKey: 'test', dimensions: 3, fetch: async () => Response.json(body, { status }) });
    await assert.rejects(provider.embed(['text']), (error) => error.code === expected && !error.message.includes('SECRET'));
  }
  for (const [failure, expected] of [[new DOMException('SECRET', 'TimeoutError'), 'aiTimeout'], [new TypeError('SECRET'), 'aiNetwork']]) {
    await assert.rejects(createGeminiEmbeddings({ apiKey: 'test', fetch: async () => { throw failure; } }).embed(['text']), new RegExp(expected));
  }
  await assert.rejects(createGeminiEmbeddings({ apiKey: '' }).embed(['text']), /aiKeyMissing/);
});

test('Gemini-only indexing and retrieval work without an OpenAI key and reject another embedding namespace', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-only-'));
  let embeddingCalls = 0;
  const embedding = createGeminiEmbeddings({ apiKey: 'test', dimensions: 3, model: 'shared-model', fetch: async (url, init) => {
    embeddingCalls++;
    return Response.json({ embeddings: JSON.parse(init.body).requests.map(() => ({ values: [1, 0, 0] })) });
  } });
  const provider = createCompatibleChatProvider({ id: 'gemini', model: 'gemini-test', client: { chat: { completions: { create: async () => completion(JSON.stringify({ answer: 'Scoped answer', basis: 'materials', sourceIds: ['S1'] })) } } } });
  const registry = createProviderRegistry({ embedding, entries: [{ id: 'gemini', provider, configured: true }], defaultProvider: 'gemini' });
  const service = createStudentService(dir, { aiRegistry: registry });
  t.after(() => { service.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const semester = service.createSemester({ name: 'Semester', academicYear: '2026' });
  const course = service.createCourse({ semesterId: semester.id, name: 'OOP' });
  const doc = service.addMaterial(course.id, studentPdf(), 'Gemini.pdf', 'application/pdf');
  await service.processDocument(doc.id);
  const history = await service.sendChat({ courseId: course.id, provider: 'gemini', message: 'Explain aggregation' });
  assert.equal(history.turns[0].provider, 'gemini');
  assert.equal(history.turns[0].messages[1].sources[0].documentId, doc.id);
  assert.equal(history.turns[0].isMock, false);
  const before = embeddingCalls;
  service.db.prepare("UPDATE chunk_embeddings SET model='shared-model'").run();
  await assert.rejects(service.search(course.id, 'aggregation'), /aiIndexMismatch/);
  assert.equal(embeddingCalls, before);
});

function environment(t, values) {
  const names = ['AI_OFFLINE_MODE', 'AI_MOCK_CHAT', 'AI_MOCK_EMBEDDINGS', 'AI_CHAT_PROVIDER', 'AI_EMBEDDING_PROVIDER', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'DEEPSEEK_API_KEY'];
  const before = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  for (const name of names) { delete process.env[name]; if (values[name] !== undefined) process.env[name] = values[name]; }
  t.after(() => { for (const name of names) { if (before[name] === undefined) delete process.env[name]; else process.env[name] = before[name]; } });
}
test('registry separates chat and embedding configuration; capability metadata contains no secrets', (t) => {
  environment(t, { AI_CHAT_PROVIDER: 'deepseek', AI_EMBEDDING_PROVIDER: 'gemini', GEMINI_API_KEY: 'SECRET_GEMINI', DEEPSEEK_API_KEY: 'SECRET_DEEPSEEK' });
  const registry = createAIProviders(), config = registry.settings();
  assert.equal(config.defaultProvider, 'deepseek'); assert.equal(config.embedding.provider, 'gemini');
  assert.equal(config.embedding.configured, true); assert.equal(config.chatProviders.find((entry) => entry.id === 'openai').configured, false);
  assert.ok(!JSON.stringify(config).includes('SECRET_'));
  assert.equal(config.isMock, false); assert.equal(registry.embedding.isMock, false);
  process.env.AI_EMBEDDING_PROVIDER = 'deepseek'; assert.throws(() => createAIProviders(), /aiProviderInvalid/);
});

test('offline mode explicitly simulates all three selectable providers and never enables itself for a missing key', (t) => {
  environment(t, {});
  assert.equal(createAIProviders().settings().isMock, false);
  assert.ok(createAIProviders().settings().chatProviders.filter((entry) => entry.id !== 'ollama').every((entry) => !entry.configured && !entry.isMock));
  assert.equal(createAIProviders().settings().chatProviders.find((entry) => entry.id === 'ollama').isMock, false);
  process.env.AI_OFFLINE_MODE = '1';
  const registry = createAIProviders();
  assert.equal(registry.settings().chatProviders.length, 3);
  assert.ok(registry.settings().chatProviders.every((entry) => entry.configured && entry.isMock));
  assert.match(registry.get('gemini').provider.chatModel, /^mock-/);
});

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'providers-'));
  const embedding = createMockAIProvider(), calls = [];
  const entries = ['openai', 'gemini', 'deepseek'].map((id) => ({ id, configured: true, provider: { isMock: true, chatModel: 'mock-' + id, async chat(input) { calls.push({ id, context: input }); return { answer: 'Answer by ' + id, basis: 'materials', sourceIds: [input.sources[0].sourceId] }; } } }));
  let registry = createProviderRegistry({ embedding, entries });
  let service = createStudentService(dir, { aiRegistry: registry });
  const semester = service.createSemester({ name: 'Semester', academicYear: '2026' });
  const course = service.createCourse({ semesterId: semester.id, name: 'OOP' });
  t.after(() => { service.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { dir, embedding, entries, course, calls, get service() { return service; }, async ready() { const doc = service.addMaterial(course.id, studentPdf(), 'OOP.pdf', 'application/pdf'); await service.processDocument(doc.id); }, reopen(defaultProvider = 'deepseek') { service.close(); registry = createProviderRegistry({ embedding, entries, defaultProvider }); service = createStudentService(dir, { aiRegistry: registry }); } };
}
const ask = (f, provider) => ({ courseId: f.course.id, message: 'Explain aggregation', language: 'en', provider, requestId: randomUUID() });

test('chat routes each turn to the selected provider, keeps common scoped citations/history and persists provider after reopen', async (t) => {
  const f = fixture(t); await f.ready();
  for (const id of ['openai', 'gemini', 'deepseek']) await f.service.sendChat(ask(f, id));
  assert.deepEqual(f.calls.map((call) => call.id), ['openai', 'gemini', 'deepseek']);
  assert.ok(f.calls[1].context.input.some((message) => message.content.includes('Answer by openai')));
  assert.ok(f.calls.every((call) => call.context.instructions.includes('JSON')));
  f.reopen();
  const history = f.service.chatHistory(f.course.id);
  assert.deepEqual(history.turns.map((turn) => turn.provider), ['openai', 'gemini', 'deepseek']);
  assert.ok(history.turns.every((turn) => turn.messages[1].sources.length === 1));
});

test('request replay and retry retain the original provider even when the default changes; explicit provider changes conflict', async (t) => {
  const f = fixture(t); await f.ready();
  const entry = f.entries[1], chat = entry.provider.chat, input = ask(f, 'gemini');
  entry.provider.chat = async () => { throw { status: 429, message: 'SECRET' }; };
  await assert.rejects(f.service.sendChat(input), /aiRateLimit/);
  assert.equal(f.service.chatHistory(f.course.id).turns[0].provider, 'gemini');
  f.reopen('deepseek'); entry.provider.chat = chat;
  const { provider, ...implicitRetry } = input;
  await f.service.sendChat(implicitRetry);
  assert.equal(f.calls.at(-1).id, 'gemini');
  const count = f.calls.length;
  await f.service.sendChat(implicitRetry); assert.equal(f.calls.length, count);
  await assert.rejects(f.service.sendChat({ ...input, provider: 'deepseek' }), /chatRequestConflict/);
  assert.equal(f.service.chatHistory(f.course.id).turns.length, 1);
});

test('missing selected chat key fails before paid embedding work and never falls back to another configured provider', async (t) => {
  const f = fixture(t); await f.ready();
  let embeddingCalls = 0; f.embedding.embed = async () => { embeddingCalls++; return []; };
  f.entries[1].configured = false;
  await assert.rejects(f.service.sendChat(ask(f, 'gemini')), /aiKeyMissing/);
  assert.equal(f.calls.length, 0); assert.equal(embeddingCalls, 0);
  assert.equal(f.service.chatHistory(f.course.id).turns[0].status, 'failed');
  await assert.rejects(f.service.sendChat(ask(f, 'https://other.example')), /aiProviderInvalid/);
});

test('a historical completed mock turn can be replayed after leaving offline mode without calling any provider', async (t) => {
  const f = fixture(t); await f.ready();
  const input = ask(f, 'openai');
  await f.service.sendChat(input);
  f.service.db.prepare("UPDATE chat_turns SET provider='mock' WHERE requestId=?").run(input.requestId);
  f.reopen();
  const count = f.calls.length;
  const { provider, ...legacyRequest } = input;
  assert.equal((await f.service.sendChat(legacyRequest)).turns[0].provider, 'mock');
  assert.equal(f.calls.length, count);
});

test('AI capability endpoint requires auth and returns only supported server-side configuration', async (t) => {
  const f = fixture(t);
  const routes = createStudentRoutes({ service: f.service, authorized: (req) => req.headers['x-auth'] === 'yes', sameOrigin: () => true });
  const server = http.createServer((req, res) => void routes(req, res, new URL(req.url, 'http://localhost')));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = 'http://127.0.0.1:' + server.address().port + '/api/student/ai';
  assert.equal((await fetch(url)).status, 401);
  const response = await fetch(url, { headers: { 'x-auth': 'yes' } });
  assert.equal(response.status, 200); assert.equal((await response.json()).chatProviders.length, 3);
});
