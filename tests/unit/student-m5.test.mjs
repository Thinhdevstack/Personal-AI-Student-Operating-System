import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { createStudentActivity } from '../../server/student/activity.mjs';
import { createStudentService } from '../../server/student/service.mjs';
import { createStudentRoutes } from '../../server/student/routes.mjs';
import { createMockAIProvider } from '../../server/ai/openai.mjs';
import { createStudentOfficeAdapter } from '../../src/office/adapters/student-events.js';
import { validStudentEvent, validStudentSnapshot, STUDENT_ACTIVITY_LIMITS as L } from '../../src/shared/office-events.js';
import { studentPdf } from '../fixtures/student-pdf.mjs';

const meta = (courseId = randomUUID()) => ({ courseId, courseName: 'OOP', requestId: randomUUID(), turnId: randomUUID(), attemptId: randomUUID(), isMock: true });
function hubFixture(t) {
  let time = Date.now();
  const hub = createStudentActivity({ now: () => time });
  t.after(() => hub.close());
  return { hub, now: () => time, advance(ms) { time += ms; } };
}
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'student-m5-'));
  const provider = createMockAIProvider(), service = createStudentService(dir, { aiProvider: provider });
  const semester = service.createSemester({ name: 'Semester', academicYear: '2026' });
  const course = service.createCourse({ semesterId: semester.id, name: 'OOP' });
  const other = service.createCourse({ semesterId: semester.id, name: 'Database' });
  const events = []; service.activity.subscribe((e) => events.push(e));
  t.after(() => { service.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { service, provider, semester, course, other, events };
}
async function ready(f, course = f.course) {
  const doc = f.service.addMaterial(course.id, studentPdf(), 'Lecture.pdf', 'application/pdf');
  await f.service.processDocument(doc.id);
}
const question = (courseId) => ({ courseId, message: 'Explain aggregation PRIVATE_QUESTION', requestId: randomUUID(), language: 'en' });

test('activity contract strips private metadata, rejects unknown fields and malformed snapshots', (t) => {
  const { hub } = hubFixture(t), events = [];
  hub.subscribe((event) => events.push(event));
  const notify = hub.begin({ ...meta(), courseName: 'OOP\nName', prompt: 'SECRET', apiKey: 'SECRET', physicalPath: 'SECRET' });
  notify('library.search', 'started'); notify('library.search', 'completed', 2);
  assert.ok(events.every(validStudentEvent)); assert.ok(validStudentSnapshot(hub.snapshot()));
  assert.ok(!JSON.stringify(events).includes('SECRET'));
  assert.equal(events[0].courseName, 'OOPName');
  assert.equal(validStudentEvent({ ...events[0], prompt: 'bad' }), false);
  assert.equal(validStudentEvent({ ...events[0], count: -1 }), false);
  assert.equal(validStudentEvent({ ...events[0], attemptId: 'bad' }), false);
  assert.equal(validStudentSnapshot({ ...hub.snapshot(), courses: [{ event: events[0], steps: [{ operation: 'execute', status: 'started' }] }] }), false);
});

test('chat emits real scoped phases, counts selected memory, commits before completion, and replay emits nothing', async (t) => {
  const f = setup(t); await ready(f);
  f.service.createMemory({ scope: 'course', courseId: f.course.id, content: 'Aggregation is hard PRIVATE_MEMORY', requestId: randomUUID() });
  let committedWhenAnnounced = false;
  f.service.activity.subscribe((event) => {
    if (event.operation === 'turn' && event.status === 'completed') committedWhenAnnounced = f.service.chatHistory(event.courseId).turns.at(-1).status === 'completed';
  });
  const input = question(f.course.id);
  const result = await f.service.sendChat(input);
  assert.equal(committedWhenAnnounced, true);
  assert.deepEqual(f.events.map((event) => `${event.operation}:${event.status}`), ['turn:started', 'library.search:started', 'library.search:completed', 'memory.search:started', 'memory.search:completed', 'ai.respond:started', 'ai.respond:completed', 'turn:completed']);
  assert.equal(f.events.find((event) => event.operation === 'memory.search' && event.status === 'completed').count, 1);
  assert.ok(f.events.every((event) => event.courseId === f.course.id && event.requestId === input.requestId && event.turnId === result.turns[0].id && event.isMock));
  assert.ok(!JSON.stringify(f.events).includes('PRIVATE_'));
  const count = f.events.length;
  await f.service.sendChat(input); assert.equal(f.events.length, count);
});

test('failed work and retry use distinct attempts; subscriber failure never fails a valid answer', async (t) => {
  const f = setup(t), input = question(f.course.id);
  await assert.rejects(f.service.sendChat(input), /chatNoMaterials/);
  assert.deepEqual(f.events.map((event) => `${event.operation}:${event.status}`), ['turn:started', 'library.search:started', 'library.search:failed', 'turn:failed']);
  const failedAttempt = f.events[0].attemptId;
  await ready(f);
  f.service.activity.subscribe(() => { throw new Error('subscriber failed'); });
  f.service.activity.subscribe(async () => { throw new Error('async subscriber failed'); });
  const result = await f.service.sendChat(input);
  assert.equal(result.turns[0].status, 'completed');
  assert.notEqual(f.events.at(-1).attemptId, failedAttempt);
  assert.equal(result.turns.length, 1);
  f.provider.chat = async () => { throw { status: 429, message: 'RAW_PROVIDER_SECRET' }; };
  await assert.rejects(f.service.sendChat(question(f.course.id)), /aiRateLimit/);
  assert.equal(f.events.at(-2).operation, 'ai.respond'); assert.equal(f.events.at(-2).status, 'failed');
  assert.equal(f.events.at(-1).status, 'failed');
  assert.ok(!JSON.stringify(f.events).includes('RAW_PROVIDER_SECRET'));
});

test('activity observer itself may throw without changing chat success or persistence', async (t) => {
  const f = setup(t); await ready(f);
  const original = f.service.activity.begin;
  f.service.activity.begin = () => { throw new Error('broken event hub'); };
  assert.equal((await f.service.sendChat(question(f.course.id))).turns.at(-1).status, 'completed');
  f.service.activity.begin = (...args) => { original(...args); return () => { throw new Error('broken emitter'); }; };
  assert.equal((await f.service.sendChat(question(f.course.id))).turns.at(-1).status, 'completed');
});

test('hub isolates simultaneous courses, rejects old attempts, expires missing terminals and bounds retained state', (t) => {
  const f = hubFixture(t), a = meta(), b = meta(), first = f.hub.begin(a), second = f.hub.begin(b);
  first('library.search', 'started'); second('memory.search', 'started');
  assert.equal(f.hub.snapshot().courses.length, 2);
  const newer = f.hub.begin({ ...a, attemptId: randomUUID() }); newer('ai.respond', 'started');
  const before = f.hub.snapshot().seq;
  first('turn', 'completed'); assert.equal(f.hub.snapshot().seq, before);
  f.advance(L.activeMs + 1);
  assert.ok(f.hub.snapshot().courses.every((row) => row.event.status === 'interrupted'));
  f.advance(L.keepMs + 1); assert.equal(f.hub.snapshot().courses.length, 0);
  for (let i = 0; i < L.courses + 5; i++) { const emit = f.hub.begin(meta()); emit('turn', 'completed'); }
  assert.equal(f.hub.snapshot().courses.length, L.courses);
});

function visualFixture(t) {
  const f = hubFixture(t), rendered = new Map();
  const adapter = createStudentOfficeAdapter({ now: f.now, createActor(event) {
    const item = { played: [], resting: true, disposed: false, statusValue: '', status(row, status) { this.statusValue = status; }, play(op) { this.played.push(op); this.resting = false; }, arrived() { return true; }, rest() { this.resting = true; }, dispose() { this.disposed = true; }, inspect() { return { played: [...this.played] }; } };
    rendered.set(event.courseId, item); return item;
  } });
  t.after(() => adapter.dispose());
  adapter.snapshot(f.hub.snapshot());
  const events = []; f.hub.subscribe((event) => { events.push(event); adapter.event(event); });
  return { ...f, adapter, rendered, events };
}

test('adapter applies real phases, deduplicates, preserves per-course ordering and never replays completed snapshot work', (t) => {
  const f = visualFixture(t), a = meta(), notify = f.hub.begin(a);
  notify('library.search', 'started'); notify('library.search', 'completed', 1);
  notify('memory.search', 'started'); notify('memory.search', 'completed', 1);
  notify('ai.respond', 'started'); notify('ai.respond', 'completed'); notify('turn', 'completed');
  const actor = f.rendered.get(a.courseId);
  for (let i = 0; i < 6; i++) { f.adapter.tick(); f.advance(700); }
  assert.deepEqual(actor.played, ['library.search', 'memory.search', 'ai.respond']);
  assert.equal(actor.resting, true); assert.equal(actor.statusValue, 'completed');
  assert.equal(f.adapter.event(f.events[1]), false);
  f.adapter.snapshot(f.hub.snapshot()); assert.equal(actor.played.length, 3); assert.equal(actor.resting, true);
  const b = meta(); f.hub.begin(b)('ai.respond', 'started');
  const other = f.rendered.get(b.courseId);
  assert.notEqual(actor, other);
  assert.equal(f.adapter.event({ ...f.events[1], seq: 1 }), false);
  assert.equal(actor.statusValue, 'completed');
});

test('adapter clears interrupted visuals, resyncs ongoing work, removes actors after restart, and caps actors', (t) => {
  const f = visualFixture(t), a = meta(), emit = f.hub.begin(a);
  emit('library.search', 'started');
  const actor = f.rendered.get(a.courseId);
  f.adapter.connection(false); assert.equal(actor.resting, true); assert.equal(actor.statusValue, 'unknown');
  f.adapter.connection(true); assert.equal(actor.statusValue, 'unknown');
  f.adapter.snapshot(f.hub.snapshot()); assert.equal(actor.statusValue, 'busy');
  emit('library.search', 'completed'); emit('turn', 'failed');
  assert.equal(actor.resting, true); assert.equal(actor.statusValue, 'failed');
  const old = f.events.at(-1);
  f.adapter.snapshot({ version: 1, epoch: randomUUID(), seq: 0, generatedAt: f.now(), courses: [] });
  assert.equal(actor.disposed, true); assert.equal(f.adapter.event(old), false);
  f.adapter.snapshot(f.hub.snapshot());
  for (let i = 0; i < 8; i++) f.hub.begin(meta())('ai.respond', 'started');
  assert.equal(f.adapter.inspect().length, L.actors);
  f.advance(L.clientMs + 1); f.adapter.tick();
  assert.ok(f.adapter.inspect().every((item) => item.status === 'unknown' && item.current === null));
  f.advance(L.keepMs + 1); f.adapter.tick(); assert.equal(f.adapter.inspect().length, 0);
});

test('adapter times out unfinished animation and an old attempt cannot override a retry', (t) => {
  const f = visualFixture(t), a = meta(), old = f.hub.begin(a);
  old('library.search', 'started');
  const actor = f.rendered.get(a.courseId); actor.arrived = () => false;
  f.advance(L.animationMs + 1); f.adapter.tick(); assert.equal(actor.resting, true);
  const newer = f.hub.begin({ ...a, attemptId: randomUUID() }); newer('ai.respond', 'started');
  const before = f.adapter.inspect()[0];
  assert.equal(f.adapter.event({ ...f.events[1], seq: f.events.at(-1).seq + 1 }), false);
  assert.equal(f.adapter.inspect()[0].attemptId, before.attemptId);
});

test('slow rendering bounds travel but still renders each phase before returning to rest', (t) => {
  const f = visualFixture(t), emit = f.hub.begin(meta());
  emit('library.search', 'started');
  const actor = [...f.rendered.values()][0];
  let arrived = false, snaps = 0;
  actor.arrived = () => arrived;
  actor.settle = () => { snaps++; arrived = true; };
  emit('memory.search', 'started'); emit('ai.respond', 'started'); emit('turn', 'completed');
  f.advance(L.travelMs + 1); f.adapter.tick();
  assert.equal(snaps, 1);
  for (let i = 0; i < 6; i++) { f.advance(700); f.adapter.tick(); }
  assert.deepEqual(actor.played, ['library.search', 'memory.search', 'ai.respond']);
  assert.equal(actor.resting, true); assert.equal(actor.statusValue, 'completed');
});

test('student mutation remains protected by HTTP auth/origin while producing activity only for accepted work', async (t) => {
  const f = setup(t); await ready(f);
  const routes = createStudentRoutes({ service: f.service, authorized: (req) => req.headers['x-auth'] === 'yes', sameOrigin: (req) => req.headers.origin === 'http://' + req.headers.host });
  const server = http.createServer((req, res) => void routes(req, res, new URL(req.url, 'http://localhost')));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const send = (extra = {}) => fetch(base + '/api/student/chat', { method: 'POST', headers: { 'x-auth': 'yes', Origin: base, 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(question(f.course.id)) });
  assert.equal((await send({ 'x-auth': 'no' })).status, 401);
  assert.equal((await send({ Origin: 'https://foreign.test' })).status, 403);
  assert.equal(f.events.length, 0); assert.equal((await send()).status, 200); assert.equal(f.events.at(-1).status, 'completed');
});
