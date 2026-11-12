import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createStudentService } from '../../server/student/service.mjs';
import { createMockAIProvider } from '../../server/ai/openai.mjs';
import { studentPdf } from '../fixtures/student-pdf.mjs';

test('assistant scopes, persistence, replay conflicts and notes remain separate from course chat', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'study-assistant-'));
  const calls = [];
  const provider = { ...createMockAIProvider(), chat: async (context) => { calls.push(context); return { answer: 'A suggested learning approach.', basis: 'general', sourceIds: [], model: 'fixture', isMock: true }; } };
  let service = createStudentService(dir, { aiProvider: provider });
  try {
    const semester = service.createSemester({ name: 'Semester', academicYear: '2026' });
    const first = service.createCourse({ semesterId: semester.id, name: 'First' });
    const second = service.createCourse({ semesterId: semester.id, name: 'Second' });
    service.createMemory({ scope: 'global', content: 'Explain slowly.', requestId: randomUUID() });
    service.createMemory({ scope: 'course', courseId: first.id, content: 'My goal is algorithms.', requestId: randomUUID() });
    service.createMemory({ scope: 'course', courseId: second.id, content: 'Secret from another course.', requestId: randomUUID() });
    const thread = service.assistant.create({ title: 'Goals' });
    const input = { message: 'Explain my algorithms goal', requestId: randomUUID(), courseIds: [first.id], mode: 'expanded', language: 'en' };
    const answer = await service.assistant.send(thread.id, input);
    assert.equal(answer.turns[0].status, 'completed');
    assert.deepEqual(answer.turns[0].scope, [first.id]);
    assert.ok(!JSON.stringify(calls[0]).includes('Secret from another course'));
    await service.assistant.send(thread.id, input);
    assert.equal(calls.length, 1, 'completed replay performs no inference');
    await assert.rejects(service.assistant.send(thread.id, { ...input, courseIds: [second.id] }), (error) => error.code === 'chatRequestConflict');
    await assert.rejects(service.assistant.send(thread.id, { ...input, requestId: randomUUID(), courseIds: [randomUUID()] }), (error) => error.code === 'notFound');
    await service.assistant.send(thread.id, { ...input, requestId: randomUUID(), courseIds: [], message: 'Another scope' });
    assert.equal(calls[1].input.length, 1, 'different source scope excludes previous conversation content');
    assert.ok(!JSON.stringify(calls[1]).includes('My goal is algorithms.'));
    assert.equal(service.chatHistory(first.id).turns.length, 0);
    service.assistant.rename(thread.id, { title: 'Renamed' });
    service.close(); service = createStudentService(dir, { aiProvider: provider });
    assert.equal(service.assistant.history(thread.id).title, 'Renamed');
    assert.equal(service.assistant.history(thread.id).turns.length, 2);
    service.assistant.remove(thread.id);
    assert.equal(service.assistant.list().length, 0);
    assert.equal(service.memories({ scope: 'global' }).length, 1);
    assert.equal(service.snapshot().courses.length, 2, 'no fake course was created');
  } finally {
    service.close();
    if (path.dirname(dir) === os.tmpdir() && path.basename(dir).startsWith('study-assistant-')) fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('assistant retrieves selected courses fairly and cancellation preserves a retryable turn', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'study-assistant-'));
  let captured, waiting = false;
  const provider = { ...createMockAIProvider(), chat: async (context, { signal }) => {
    captured = context;
    if (waiting) await new Promise((resolve, reject) => { if (signal.aborted) reject(new Error('cancel')); else signal.addEventListener('abort', () => reject(new Error('cancel')), { once: true }); });
    return { answer: 'Explanation', basis: context.sources.length ? 'materials' : 'general', sourceIds: context.sources.length ? ['S1'] : [] };
  } };
  const service = createStudentService(dir, { aiProvider: provider });
  try {
    const semester = service.createSemester({ name: 'Term', academicYear: '2026' });
    const courses = ['Alpha', 'Beta', 'Excluded'].map((name) => service.createCourse({ semesterId: semester.id, name }));
    for (const course of courses) {
      const document = service.addMaterial(course.id, studentPdf([course.name + ': algorithms and data structures.']), course.name + '.pdf', 'application/pdf');
      await service.processDocument(document.id);
    }
    const thread = service.assistant.create({ title: 'Compare' });
    const input = { message: 'Compare algorithms', requestId: randomUUID(), courseIds: courses.slice(0, 2).map((course) => course.id), language: 'en', mode: 'materials' };
    await service.assistant.send(thread.id, input);
    assert.deepEqual(new Set(captured.sources.map((source) => source.courseId)), new Set(input.courseIds));
    assert.ok(!JSON.stringify(captured).includes('Excluded'));
    waiting = true;
    const next = { ...input, requestId: randomUUID(), courseIds: [], mode: 'expanded' };
    const pending = service.assistant.send(thread.id, next);
    service.assistant.cancel(thread.id, next.requestId);
    await assert.rejects(pending, (error) => error.code === 'chatCancelled');
    assert.equal(service.assistant.history(thread.id).turns.at(-1).status, 'failed');
    waiting = false;
    await service.assistant.send(thread.id, next);
    assert.equal(service.assistant.history(thread.id).turns.length, 2);
    assert.equal(service.assistant.history(thread.id).turns.at(-1).status, 'completed');
  } finally {
    service.close();
    if (path.dirname(dir) === os.tmpdir() && path.basename(dir).startsWith('study-assistant-')) fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('migration from version 8 creates a consistent backup and preserves course notes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'study-assistant-'));
  let service = createStudentService(dir, { aiProvider: createMockAIProvider() });
  try {
    service.createMemory({ scope: 'global', content: 'Preserve this profile.', requestId: randomUUID() });
    service.db.exec('DROP TABLE assistant_turns; DROP TABLE assistant_conversations; DELETE FROM schema_migrations WHERE version=9;');
    service.close(); service = createStudentService(dir, { aiProvider: createMockAIProvider() });
    assert.equal(service.memories({ scope: 'global' })[0].content, 'Preserve this profile.');
    assert.equal(fs.readdirSync(path.join(dir, 'backups')).length, 1);
    assert.equal(service.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version, 9);
    assert.deepEqual(service.assistant.list(), []);
  } finally {
    service.close();
    if (path.dirname(dir) === os.tmpdir() && path.basename(dir).startsWith('study-assistant-')) fs.rmSync(dir, { recursive: true, force: true });
  }
});
