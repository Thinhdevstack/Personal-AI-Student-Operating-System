import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { containedPath, validateSuite, scheduleSuite, summarizeResults, runEvaluation } from '../../scripts/ai-evaluation.mjs';
import { createStudentService } from '../../server/student/service.mjs';
import { createMockAIProvider } from '../../server/ai/openai.mjs';
import { studentPdf } from '../fixtures/student-pdf.mjs';

const source = { courses: [{ id: 'course' }], documents: [{ sha256: 'abc', courseId: 'course', pageCount: 3 }] };
const sample = () => ({ schemaVersion: 1, repeatIds: ['E01'], cases: [{ id: 'E01', courseId: 'course', question: 'Explain an algorithm', group: 'expanded', modes: ['materials', 'expanded'], keyPoints: [], mustNotClaim: [], evidence: [{ documentSha256: 'abc', page: 2, anchors: [], kind: 'native' }] }] });

test('evaluation evidence must belong to the selected course/page and image gold requires visual verification', () => {
  const suite = sample(); validateSuite(suite, source);
  suite.cases[0].evidence[0].page = 4; assert.throws(() => validateSuite(suite, source), /Invalid evidence/);
  suite.cases[0].evidence[0].page = 2; suite.cases[0].evidence[0].kind = 'image';
  assert.throws(() => validateSuite(suite, source), /visual review/);
  suite.cases[0].evidence[0].visualVerified = true; validateSuite(suite, source);
  assert.throws(() => validateSuite(suite, { ...source, documents: [{ ...source.documents[0], courseId: 'other' }] }), /Invalid evidence/);
});

test('paired modes and repetitions have separate immutable run keys', () => {
  const suite = sample(), runs = scheduleSuite(suite);
  assert.deepEqual(runs.map((r) => r.key), ['E01:materials:0', 'E01:expanded:0', 'E01:expanded:1']);
  assert.equal(suite.cases.length, 1); assert.equal(suite.repeatIds.length, 1);
});

test('unreviewed answers are not counted as academically correct and repeats do not inflate primary metrics', () => {
  const result = { key: 'E01:materials:0', group: 'expanded', mode: 'materials', httpStatus: 200, answer: { basis: 'materials' }, repeat: 0, recallAt5: 1, timings: { totalMs: 100, retrievalMs: 10, modelMs: 80 }, apiMatchesPersistedHistory: true };
  const results = [result, { ...result, key: 'E01:expanded:1', repeat: 1 }];
  const summary = summarizeResults(results);
  assert.equal(summary.primary.n, 1); assert.equal(summary.repeated.n, 1);
  assert.equal(summary.primary.reviewed, 0); assert.equal(summary.primary.correctness, null);
  const reviewed = summarizeResults(results, [{ key: result.key, correctness: 0 }]);
  assert.equal(reviewed.primary.correctness.median, 0);
  assert.equal(summarizeResults([{ ...result, gradingEligible: false }], [{ key: result.key, correctness: 2 }]).primary.reviewed, 0);
  assert.equal(summarizeResults([{ ...result, httpStatus: 502, apiMatchesPersistedHistory: false }]).primary.apiHistoryMismatches, 0);
  assert.throws(() => summarizeResults(results, [{ key: result.key, correctness: 3 }]), /scores/);
});

test('evaluation storage rejects parent traversal and root aliases', () => {
  assert.equal(containedPath('data/evaluation-fixture', 'documents/a/source.pdf'), path.resolve('data/evaluation-fixture/documents/a/source.pdf'));
  assert.throws(() => containedPath('data/evaluation-fixture', '../outside.pdf'), /child/);
  assert.throws(() => containedPath('data/evaluation-fixture', '.'), /child/);
});

test('evaluation HTTP harness preserves source history, memory and PDFs; resume does not repeat inference', async () => {
  // Protocol/isolation fixture only; this does not measure model quality.
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'student-eval-source-'));
  const output = path.resolve('data/evaluations/tool-isolation-' + randomUUID());
  const mock = createMockAIProvider();
  const provider = { ...mock, providerId: 'ollama', model: 'ollama/eval-embed', isMock: false };
  const original = createStudentService(sourceDir, { aiProvider: provider });
  let server;
  const savedEnv = { context: process.env.OLLAMA_CONTEXT_SIZE, version: process.env.OLLAMA_EMBEDDING_VERSION };
  try {
    const semester = original.createSemester({ name: 'Fixture', academicYear: '2026' });
    const course = original.createCourse({ semesterId: semester.id, name: 'Fixture' });
    const bytes = studentPdf(['Fixture topic']);
    const document = original.addMaterial(course.id, bytes, 'fixture.pdf', 'application/pdf');
    await original.processDocument(document.id);
    await original.sendChat({ courseId: course.id, message: 'Fixture topic', language: 'en', requestId: randomUUID() });
    original.createMemory({ scope: 'global', content: 'Keep original note.', requestId: randomUUID() });
    const history = original.chatHistory(course.id);
    let modelCalls = 0;
    const config = { defaultProvider: 'ollama', isMock: false, chatProviders: [{ id: 'ollama', model: 'eval-chat', configured: true }], embedding: { provider: 'ollama', model: provider.model, dimensions: mock.dimensions, configured: true }, webSearch: { configured: false } };
    server = http.createServer(async (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/student/ai') return res.end(JSON.stringify(config));
      if (req.url === '/api/version') return res.end(JSON.stringify({ version: 'fixture' }));
      if (req.url === '/api/ps') return res.end(JSON.stringify({ models: [] }));
      if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'eval-chat' }, { name: 'eval-embed' }] }));
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      if (req.url === '/api/embed') return res.end(JSON.stringify({ embeddings: await mock.embed(body.input) }));
      modelCalls++;
      res.end(JSON.stringify({ done: true, message: { content: JSON.stringify({ answer: 'Fixture topic', basis: 'materials', sourceIds: ['S1'] }) } }));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = 'http://127.0.0.1:' + server.address().port;
    const suiteFile = path.join(sourceDir, 'suite.json');
    const suite = { schemaVersion: 1, cases: [{ id: 'T01', courseId: course.id, question: 'Fixture topic', group: 'text', modes: ['materials'], keyPoints: [], mustNotClaim: [], evidence: [{ documentSha256: createHash('sha256').update(bytes).digest('hex'), page: 1, anchors: ['Fixture topic'], kind: 'native' }] }] };
    fs.writeFileSync(suiteFile, JSON.stringify(suite));
    const options = { database: path.join(sourceDir, 'student.sqlite'), documents: sourceDir, suite: suiteFile, out: output, runtimeUrl: url, ollamaUrl: url, contextSize: 8192, timeoutMs: 1000 };
    const result = await runEvaluation(options);
    assert.equal(result.length, 1); assert.equal(result[0].httpStatus, 200);
    assert.equal(result[0].apiMatchesPersistedHistory, true); assert.equal(result[0].recallAt5, 1);
    await runEvaluation({ ...options, resume: true }); assert.equal(modelCalls, 1);
    assert.deepEqual(original.chatHistory(course.id), history);
    assert.equal(original.db.prepare('SELECT count(*) AS n FROM memories').get().n, 1);
    assert.deepEqual(fs.readFileSync(original.file(document.id).path), bytes);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(output, 'source-integrity.json'), 'utf8')), { documentsUnchanged: true, indexesUnchanged: true, connectionWasReadOnly: true });
  } finally {
    original.close();
    if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
    for (const [key, value] of [['OLLAMA_CONTEXT_SIZE', savedEnv.context], ['OLLAMA_EMBEDDING_VERSION', savedEnv.version]]) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    assert.equal(path.dirname(sourceDir), path.resolve(os.tmpdir())); assert.ok(path.basename(sourceDir).startsWith('student-eval-source-'));
    fs.rmSync(sourceDir, { recursive: true, force: true });
    assert.equal(path.dirname(output), path.resolve('data/evaluations')); assert.ok(path.basename(output).startsWith('tool-isolation-'));
    fs.rmSync(output, { recursive: true, force: true });
  }
});
