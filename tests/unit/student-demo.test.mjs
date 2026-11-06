import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { configureStudentDemo } from '../../server/student/demo-config.mjs';
import { createStudentService } from '../../server/student/service.mjs';
import { createStudentDemoSeed } from '../../server/student/demo-seed.mjs';
import { createStudentRoutes } from '../../server/student/routes.mjs';
import { createMockAIProvider } from '../../server/ai/openai.mjs';
import { createAIProviders } from '../../server/ai/providers.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'student-demo-'));
  const original = { ...process.env };
  let service;
  t.after(() => { service?.close(); for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key]; Object.assign(process.env, original); fs.rmSync(root, { recursive: true, force: true }); });
  process.env.OFFICE_STUDENT_DEMO = '1'; delete process.env.OFFICE_STUDENT_DEMO_SUBDIR;
  configureStudentDemo(process.env, root);
  service = createStudentService(path.join(process.env.OFFICE_DATA_DIR, 'student'), { studentDemo: true });
  return { root, service, seed: createStudentDemoSeed(service) };
}

test('demo overrides inherited keys, offline=0, Claude folder and real storage; normal mode keeps its settings', () => {
  const root = path.resolve(os.tmpdir(), 'demo-settings');
  const normal = { AI_OFFLINE_MODE: '0', OPENAI_API_KEY: 'private', OFFICE_DATA_DIR: 'real' };
  assert.equal(configureStudentDemo(normal, root), false); assert.equal(normal.OPENAI_API_KEY, 'private');
  const demo = { ...normal, OFFICE_STUDENT_DEMO: '1', GEMINI_API_KEY: 'private', DEEPSEEK_API_KEY: 'private', CLAUDE_CONFIG_DIR: 'real-claude' };
  assert.equal(configureStudentDemo(demo, root), true);
  assert.equal(demo.AI_OFFLINE_MODE, '1');
  for (const key of ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'DEEPSEEK_API_KEY']) assert.equal(demo[key], '');
  assert.equal(demo.OFFICE_DATA_DIR, path.join(root, 'data', 'student-demo'));
  assert.equal(demo.CLAUDE_CONFIG_DIR, path.join(demo.OFFICE_DATA_DIR, 'claude'));
  assert.throws(() => configureStudentDemo({ OFFICE_STUDENT_DEMO: '1', OFFICE_STUDENT_DEMO_SUBDIR: '../real' }, root));
});

test('sample data seeds concurrently and after reopening without duplicates or outbound calls; PDFs and memories feed mock chat', async (t) => {
  const f = fixture(t);
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected outbound request'); });
  const events = []; f.service.activity.subscribe((event) => events.push(event));
  await Promise.all([f.seed(), f.seed()]); await f.seed();
  const before = f.service.snapshot();
  assert.equal(before.semesters.length, 1); assert.equal(before.courses.length, 2);
  assert.equal(f.service.db.prepare('SELECT count(*) AS n FROM documents').get().n, 2);
  assert.equal(f.service.db.prepare('SELECT count(*) AS n FROM memories').get().n, 3);
  assert.ok(before.recentMaterials.every((doc) => doc.status === 'ready' && doc.chunkCount > 0));
  assert.ok(f.service.db.prepare('SELECT model FROM chunk_embeddings').all().every((row) => row.model === 'mock-embedding-v1'));
  const oop = before.courses.find((course) => course.code === 'DEMO-OOP');
  for (const provider of ['gemini', 'openai', 'deepseek']) {
    const request = { courseId: oop.id, message: 'Giải thích aggregation và composition', language: 'vi', provider, requestId: randomUUID() };
    const history = await f.service.sendChat(request);
    const last = history.turns.at(-1);
    assert.equal(last.provider, provider); assert.equal(last.isMock, true); assert.equal(last.status, 'completed');
    assert.match(last.messages[1].content, /Phản hồi thử nghiệm/);
    assert.ok(last.messages[1].sources.length); assert.equal(last.messages[1].memories.length, 2);
    assert.deepEqual(await f.service.sendChat(request), history);
  }
  assert.ok(events.some((event) => event.operation === 'ai.respond' && event.isMock));
  const reopened = createStudentService(path.join(process.env.OFFICE_DATA_DIR, 'student'), { studentDemo: true });
  try { await createStudentDemoSeed(reopened)(); assert.equal(reopened.snapshot().courses.length, 2); assert.equal(reopened.chatHistory(oop.id).turns.length, 3); }
  finally { reopened.close(); }
});

test('demo seeding preserves a separate real database and remains unavailable in real mode', async (t) => {
  const f = fixture(t), realDir = path.join(f.root, 'data', 'student');
  const real = createStudentService(realDir, { aiProvider: createMockAIProvider() });
  const semester = real.createSemester({ name: 'Real semester', academicYear: '2026' });
  real.createCourse({ semesterId: semester.id, name: 'Keep this course' });
  assert.equal(real.aiSettings().studentDemo, false);
  assert.throws(() => createStudentDemoSeed(real), /forbidden/);
  real.close();
  const bytes = fs.readFileSync(path.join(realDir, 'student.sqlite'));
  await f.seed();
  assert.deepEqual(fs.readFileSync(path.join(realDir, 'student.sqlite')), bytes);
});

test('demo seed route enforces auth, origin and server mode', async (t) => {
  const f = fixture(t);
  const routes = createStudentRoutes({ service: f.service, demoSeed: f.seed, authorized: (req) => req.headers['x-auth'] === 'yes', sameOrigin: (req) => req.headers['x-origin'] === 'yes' });
  const server = http.createServer((req, res) => void routes(req, res, new URL(req.url, 'http://localhost')));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}/api/student/demo/seed`;
  assert.equal((await fetch(url, { method: 'POST' })).status, 401);
  assert.equal((await fetch(url, { method: 'POST', headers: { 'x-auth': 'yes' } })).status, 403);
  const response = await fetch(url, { method: 'POST', headers: { 'x-auth': 'yes', 'x-origin': 'yes' } });
  assert.equal(response.status, 200); assert.equal((await response.json()).courses.length, 2);
  const closed = createStudentRoutes({ service: f.service, authorized: () => true, sameOrigin: () => true });
  const server2 = http.createServer((req, res) => void closed(req, res, new URL(req.url, 'http://localhost')));
  await new Promise((resolve) => server2.listen(0, '127.0.0.1', resolve));
  t.after(() => { server2.closeAllConnections(); server2.close(); });
  assert.equal((await fetch(`http://127.0.0.1:${server2.address().port}/api/student/demo/seed`, { method: 'POST' })).status, 404);
});

test('normal mode with empty keys never silently enables simulation', (t) => {
  const f = fixture(t);
  process.env.AI_OFFLINE_MODE = '0';
  const registry = createAIProviders();
  assert.equal(registry.isMock, false);
  assert.ok(registry.settings().chatProviders.filter((provider) => provider.id !== 'ollama').every((provider) => !provider.configured && !provider.isMock));
  assert.equal(registry.settings().chatProviders.find((provider) => provider.id === 'ollama').isMock, false);
  assert.throws(() => createStudentService(path.join(f.root, 'bad'), { aiRegistry: registry, studentDemo: true }), /aiMockDisabled/);
});
