// Read-only source snapshots, real Ollama inference, and explicit human grading.
// Raw artifacts must remain in a Git-ignored directory. Production modules are imported unchanged.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { extractPdf } from '../server/documents/pdf.mjs';
import { createOllama } from '../server/ai/ollama.mjs';
import { createProviderRegistry } from '../server/ai/providers.mjs';
import { searchCourseMaterials } from '../server/ai/retrieval.mjs';
import { CHAT_LIMITS } from '../server/ai/config.mjs';
import { createStudentService } from '../server/student/service.mjs';
import { createStudentRoutes } from '../server/student/routes.mjs';

const json = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const normalize = (value) => value.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').toLowerCase().replace(/\s+/g, ' ').trim();
const now = () => performance.now();
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', windowsHide: true }).trim();

export function containedPath(root, relative) {
  const base = path.resolve(root), target = path.resolve(base, relative);
  if (target === base || !target.startsWith(base + path.sep)) throw new Error('Path must be a child of its root');
  return target;
}

function privateOutput(directory) {
  const target = path.resolve(directory);
  const ignored = execFileSync('git', ['check-ignore', '--no-index', '--stdin'], { input: path.join(target, '.evaluation-private') + '\n', encoding: 'utf8', windowsHide: true });
  if (!ignored.trim()) throw new Error('Raw output must be Git-ignored');
  fs.mkdirSync(target, { recursive: true });
  return target;
}

function sourceInventory(database, documents) {
  const source = new Database(path.resolve(database), { readonly: true, fileMustExist: true });
  try {
    const docs = source.prepare('SELECT id,courseId,originalFilename,storagePath,status,pageCount,sizeBytes,processingError FROM documents ORDER BY id').all().map((doc) => {
      const file = containedPath(documents, doc.storagePath);
      return { ...doc, sha256: hash(fs.readFileSync(file)) };
    });
    return {
      courses: source.prepare('SELECT id,name,code,semesterId FROM courses ORDER BY id').all(), documents: docs,
      indexes: source.prepare('SELECT provider,model,dimensions,modelVersion,count(*) AS count FROM chunk_embeddings GROUP BY provider,model,dimensions,modelVersion').all(),
      memoryCount: source.prepare('SELECT count(*) AS n FROM memories').get().n,
    };
  } finally { source.close(); }
}

export async function inventory({ database, documents, out }) {
  const directory = privateOutput(out), result = sourceInventory(database, documents);
  const source = new Database(path.resolve(database), { readonly: true, fileMustExist: true });
  try {
    for (const doc of result.documents) {
      let extracted;
      try { extracted = await extractPdf(containedPath(documents, doc.storagePath)); }
      catch (error) { extracted = { error: error.code || 'extractionFailed', pages: [] }; }
      const chunks = source.prepare('SELECT id,pageNumber,chunkIndex,content FROM document_chunks WHERE documentId=? ORDER BY pageNumber,chunkIndex').all(doc.id);
      write(path.join(directory, doc.sha256 + '.json'), { document: doc, nativeExtraction: extracted, indexedChunks: chunks });
    }
    write(path.join(directory, 'inventory.json'), { ...result, createdAt: new Date().toISOString(), commit: git('rev-parse', 'HEAD'), branch: git('branch', '--show-current') });
  } finally { source.close(); }
  console.log(JSON.stringify({ documents: result.documents.length, pages: result.documents.reduce((n, d) => n + d.pageCount, 0), directory }));
}

export async function renderPages({ pdf, pages, out }) {
  const directory = privateOutput(out);
  const { createCanvas } = await import('@napi-rs/canvas');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(pdf)), useSystemFonts: true, isEvalSupported: false });
  const document = await task.promise;
  try {
    for (const n of pages) {
      if (!Number.isInteger(n) || n < 1 || n > document.numPages) throw new Error('Invalid PDF page');
      const page = await document.getPage(n), original = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(1.8, 1600 / Math.max(original.width, original.height)) });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      fs.writeFileSync(path.join(directory, 'page-' + n + '.png'), canvas.toBuffer('image/png'));
    }
  } finally { await task.destroy(); }
}

export function validateSuite(suite, source) {
  if (suite.schemaVersion !== 1 || !Array.isArray(suite.cases) || !suite.cases.length) throw new Error('Invalid suite');
  const ids = new Set();
  for (const item of suite.cases) {
    if (!/^[A-Z][A-Z0-9_-]{1,39}$/.test(item.id) || ids.has(item.id)) throw new Error('Duplicate or invalid case ID');
    ids.add(item.id);
    if (!source.courses.some((c) => c.id === item.courseId)) throw new Error('Unknown course in suite');
    if (typeof item.question !== 'string' || !item.question.trim() || item.question.length > CHAT_LIMITS.messageChars || !['text', 'image', 'expanded', 'insufficient'].includes(item.group)) throw new Error('Invalid question');
    if (!Array.isArray(item.modes) || !item.modes.length || new Set(item.modes).size !== item.modes.length || item.modes.some((m) => !['materials', 'expanded'].includes(m))) throw new Error('Invalid modes');
    if (!Array.isArray(item.keyPoints) || !Array.isArray(item.mustNotClaim) || !Array.isArray(item.evidence)) throw new Error('Missing grading rubric');
    for (const evidence of item.evidence) {
      const doc = source.documents.find((d) => d.sha256 === evidence.documentSha256 && d.courseId === item.courseId);
      if (!doc || !Number.isInteger(evidence.page) || evidence.page < 1 || evidence.page > doc.pageCount || !Array.isArray(evidence.anchors)) throw new Error('Invalid evidence');
      if (evidence.kind === 'image' && evidence.visualVerified !== true) throw new Error('Image evidence requires visual review');
    }
  }
  if ((suite.repeatIds || []).some((id) => !ids.has(id))) throw new Error('Unknown repeated case');
}

export function scheduleSuite(suite) {
  const runs = suite.cases.flatMap((item) => item.modes.map((mode) => ({ case: item, mode, repeat: 0, key: item.id + ':' + mode + ':0' })));
  for (const id of suite.repeatIds || []) {
    const item = suite.cases.find((c) => c.id === id), mode = item.modes.at(-1);
    runs.push({ case: item, mode, repeat: 1, key: id + ':' + mode + ':1' });
  }
  return runs;
}

function loopback(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Only loopback HTTP origins are allowed');
  return url.origin;
}
async function get(base, endpoint) {
  const response = await fetch(base + endpoint, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('Local status HTTP ' + response.status);
  return response.json();
}
function productionDigest() {
  const files = [];
  const walk = (dir) => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const file = path.join(dir, entry.name); if (entry.isDirectory()) walk(file); else if (/\.(mjs|sql|ps1|tsx?|js)$/.test(file)) files.push(file); } };
  for (const root of ['server/ai', 'server/student', 'server/documents', 'src/features/ai', 'src/features/academic']) walk(root);
  return hash(files.sort().map((file) => file.replaceAll('\\', '/') + ':' + hash(fs.readFileSync(file))).join('\n'));
}

export async function runEvaluation(options) {
  const directory = privateOutput(options.out), source = sourceInventory(options.database, options.documents), suite = json(options.suite);
  validateSuite(suite, source);
  const runtime = loopback(options.runtimeUrl), ollamaURL = loopback(options.ollamaUrl);
  const config = await get(runtime, '/api/student/ai');
  if (config.defaultProvider !== 'ollama' || config.isMock || config.embedding.provider !== 'ollama') throw new Error('This evaluator requires real local Ollama configuration');
  const chatModel = config.chatProviders.find((p) => p.id === 'ollama')?.model;
  const embeddingModel = config.embedding.model.replace(/^ollama\//, '');
  const versions = [...new Set(source.indexes.filter((i) => i.provider === 'ollama' && i.model === config.embedding.model && i.dimensions === config.embedding.dimensions).map((i) => i.modelVersion))];
  if (versions.length !== 1) throw new Error('Select an unambiguous compatible embedding index');
  const manifest = {
    schemaVersion: 1, commit: git('rev-parse', 'HEAD'), branch: git('branch', '--show-current'), productionDigest: productionDigest(), suiteHash: hash(fs.readFileSync(options.suite)),
    sourceDocuments: source.documents.map(({ id, sha256, status }) => ({ id, sha256, status })), config,
    runner: { contextSize: Number(options.contextSize), timeoutMs: Number(options.timeoutMs), embeddingVersion: versions[0] },
    ollamaVersion: await get(ollamaURL, '/api/version'), modelTags: await get(ollamaURL, '/api/tags'), initialLoadedModels: await get(ollamaURL, '/api/ps'),
    hardware: { platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model, ramBytes: os.totalmem(), logicalCPUs: os.cpus().length },
    notes: ['Source DB opened read-only; inference uses a separate backup.', 'Independent cases start with empty conversations and memories in the evaluation copy.', 'No model unloading or configuration changes; residency is sampled before each actual call.', 'Retrieval diagnostics replay the captured query vector without an extra embedding call.', 'UI rendering is not covered by this HTTP measurement.'],
  };
  process.env.OLLAMA_CONTEXT_SIZE = String(manifest.runner.contextSize);
  process.env.OLLAMA_EMBEDDING_VERSION = versions[0];
  const resultFile = path.join(directory, 'results.jsonl'), manifestFile = path.join(directory, 'manifest.json');
  let completed = [];
  if (options.resume) {
    const previous = json(manifestFile);
    for (const field of ['commit', 'productionDigest', 'suiteHash']) if (previous[field] !== manifest[field]) throw new Error('Resume mismatch: ' + field);
    if (JSON.stringify(previous.config) !== JSON.stringify(config) || JSON.stringify(previous.runner) !== JSON.stringify(manifest.runner) || JSON.stringify(previous.sourceDocuments) !== JSON.stringify(manifest.sourceDocuments)) throw new Error('Resume configuration/source mismatch');
    completed = fs.existsSync(resultFile) ? fs.readFileSync(resultFile, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  } else {
    if (fs.existsSync(manifestFile) || fs.existsSync(resultFile)) throw new Error('Output already contains a run; use a new directory or --resume');
    write(manifestFile, { ...manifest, createdAt: new Date().toISOString() });
  }
  const workspace = path.join(directory, 'workspace');
  if (path.resolve(options.database).startsWith(workspace + path.sep) || path.resolve(options.documents) === workspace) throw new Error('Evaluation workspace must be separate from source inputs');
  fs.mkdirSync(workspace, { recursive: true });
  const database = path.join(workspace, 'student.sqlite');
  if (!fs.existsSync(database)) {
    const input = new Database(path.resolve(options.database), { readonly: true, fileMustExist: true });
    try { await input.backup(database); } finally { input.close(); }
    for (const doc of source.documents) {
      const target = containedPath(workspace, doc.storagePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(containedPath(options.documents, doc.storagePath), target);
    }
  }
  let trace;
  const client = createOllama({ baseURL: ollamaURL, chatModel, embeddingModel, dimensions: config.embedding.dimensions, timeoutMs: Number(options.timeoutMs), fetch: async (url, init) => {
    const started = now(), response = await fetch(url, init);
    if (trace && ['/api/embed', '/api/chat'].includes(url.pathname)) {
      try {
        const data = await response.clone().json();
        trace.nativeCalls.push({ endpoint: url.pathname, httpStatus: response.status, wallMs: now() - started, model: data.model, totalDurationNs: data.total_duration, loadDurationNs: data.load_duration, promptTokens: data.prompt_eval_count, outputTokens: data.eval_count, doneReason: data.done_reason, thinkingChars: data.message?.thinking?.length || 0 });
      } catch { trace.nativeCalls.push({ endpoint: url.pathname, httpStatus: response.status, invalidJSON: true }); }
    }
    return response;
  } });
  const status = await client.status();
  if (!status.connected || !status.chatReady || !status.embeddingReady) { write(path.join(directory, 'blocked.json'), status); throw new Error('Local model unavailable; inventory and suite remain usable'); }
  const embedding = { ...client.embedding, async embed(texts, settings) {
    const residency = await get(ollamaURL, '/api/ps'), started = now();
    const vectors = await client.embedding.embed(texts, settings);
    if (trace) trace.embeddingCalls.push({ texts, vectors, durationMs: now() - started, residency });
    return vectors;
  } };
  const chat = { ...client.chat, async chat(context, settings) {
    if (trace) { trace.context = context; trace.chatResidency = await get(ollamaURL, '/api/ps'); }
    const started = now();
    try { const result = await client.chat.chat(context, settings); if (trace) trace.providerResponse = result; return result; }
    finally { if (trace) trace.modelMs = now() - started; }
  } };
  const activity = { begin() { return (operation, status, count) => trace?.events.push({ operation, status, count, atMs: now() }); } };
  const registry = createProviderRegistry({ embedding, entries: [{ id: 'ollama', provider: chat, configured: true }], defaultProvider: 'ollama', localStatus: client.status });
  const service = createStudentService(workspace, { aiRegistry: registry, activity });
  const auth = randomBytes(24).toString('hex'); let origin;
  const handler = createStudentRoutes({ service, authorized: (req) => req.headers['x-evaluation-key'] === auth, sameOrigin: (req) => req.headers.origin === origin });
  const server = http.createServer((req, res) => { void handler(req, res, new URL(req.url, origin)); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); origin = 'http://127.0.0.1:' + server.address().port;
  const headers = { 'Content-Type': 'application/json', Origin: origin, 'X-Evaluation-Key': auth };
  const schedule = scheduleSuite(suite), keys = new Set(completed.map((r) => r.key));
  try {
    for (const run of schedule) {
      if (keys.has(run.key)) continue;
      service.db.transaction(() => { service.db.exec('DELETE FROM memory_create_requests; DELETE FROM memories; DELETE FROM chat_messages; DELETE FROM chat_turns; DELETE FROM chat_conversations;'); })();
      trace = { events: [], embeddingCalls: [], nativeCalls: [] };
      const started = now(), requestId = randomUUID();
      const response = await fetch(origin + '/api/student/chat', { method: 'POST', headers, body: JSON.stringify({ courseId: run.case.courseId, requestId, message: run.case.question, language: run.case.language || 'vi', provider: 'ollama', mode: run.mode }), signal: AbortSignal.timeout(Number(options.timeoutMs) * 2 + 30000) });
      const body = await response.json(), totalMs = now() - started;
      const history = service.chatHistory(run.case.courseId), answer = history.turns.at(-1)?.messages.find((m) => m.role === 'assistant');
      let retrieval = [];
      if (trace.embeddingCalls[0]) {
        const captured = trace.embeddingCalls[0];
        retrieval = (await searchCourseMaterials({ db: service.db, courseId: run.case.courseId, query: captured.texts[0], aiProvider: { ...embedding, embed: async () => captured.vectors }, limit: CHAT_LIMITS.chunks, minScore: CHAT_LIMITS.retrievalMinScore, includeArchived: true })).results;
      }
      const expected = run.case.evidence.map((e) => ({ ...e, documentId: source.documents.find((d) => d.sha256 === e.documentSha256 && d.courseId === run.case.courseId).id }));
      const extraction = expected.map((e) => {
        const content = service.db.prepare('SELECT content FROM document_chunks WHERE documentId=? AND pageNumber=? ORDER BY chunkIndex').all(e.documentId, e.page).map((r) => r.content).join('\n');
        return { ...e, indexedText: content, anchorsPresent: e.anchors.map((anchor) => normalize(content).includes(normalize(anchor))) };
      });
      const phaseDuration = (operation) => { const start = trace.events.find((e) => e.operation === operation && e.status === 'started'), end = trace.events.find((e) => e.operation === operation && ['completed', 'failed'].includes(e.status)); return start && end ? end.atMs - start.atMs : null; };
      const recall = expected.length ? expected.filter((e) => retrieval.some((r) => r.documentId === e.documentId && r.pageNumber === e.page)).length / expected.length : null;
      const contextRecall = expected.length ? expected.filter((e) => trace.context?.sources.some((r) => r.documentId === e.documentId && r.pageNumber === e.page)).length / expected.length : null;
      const persisted = response.ok && JSON.stringify(body) === JSON.stringify(history);
      const record = { key: run.key, caseId: run.case.id, group: run.case.group, mode: run.mode, repeat: run.repeat, question: run.case.question, at: new Date().toISOString(), httpStatus: response.status, error: body.error || null, answer: answer || null, apiMatchesPersistedHistory: persisted, timings: { totalMs, retrievalMs: phaseDuration('library.search'), memoryContextMs: phaseDuration('memory.search'), modelMs: trace.modelMs ?? null }, recallAt5: recall, contextRecall, crossCourseRetrieval: retrieval.some((r) => !source.documents.some((d) => d.id === r.documentId && d.courseId === run.case.courseId)), extraction, retrieval, ...trace };
      record.gradingEligible = run.case.gradingEligible !== false;
      fs.appendFileSync(resultFile, JSON.stringify(record) + '\n');
      write(path.join(directory, 'progress.json'), { done: completed.length + 1, scheduled: schedule.length, lastKey: run.key }); completed.push(record);
      console.log(JSON.stringify({ progress: completed.length + '/' + schedule.length, key: run.key, status: response.status, basis: answer?.basis, retrievalMs: record.timings.retrievalMs, modelMs: record.timings.modelMs, totalMs, recallAt5: recall }));
      trace = null;
    }
    const after = sourceInventory(options.database, options.documents);
    write(path.join(directory, 'source-integrity.json'), { documentsUnchanged: JSON.stringify(after.documents) === JSON.stringify(source.documents), indexesUnchanged: JSON.stringify(after.indexes) === JSON.stringify(source.indexes), connectionWasReadOnly: true });
    const reviewFile = path.join(directory, 'reviews.json');
    if (!fs.existsSync(reviewFile)) write(reviewFile, { rubric: 'correctness, completeness and sourceSupport: 0=wrong/unsupported, 1=partial, 2=meets case rubric; modeCompliance: boolean; failures need evidence; null=not reviewed', reviews: completed.map((r) => ({ key: r.key, correctness: null, completeness: null, sourceSupport: null, modeCompliance: null, appropriateRefusal: null, categories: [], rationale: '', reviewer: null })) });
    return completed;
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); service.close(); }
}

export function summarizeResults(results, reviews = []) {
  for (const review of reviews) for (const field of ['correctness', 'completeness', 'sourceSupport']) if (review[field] != null && ![0, 1, 2].includes(review[field])) throw new Error('Review scores must be 0, 1, 2 or null');
  const grades = new Map(reviews.map((r) => [r.key, r]));
  const primary = results.filter((r) => !r.repeat);
  const statistics = (values) => { const sorted = values.filter(Number.isFinite).sort((a, b) => a - b); if (!sorted.length) return null; const mid = Math.floor(sorted.length / 2); return { n: sorted.length, median: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2, min: sorted[0], max: sorted.at(-1), mean: sorted.reduce((sum, n) => sum + n, 0) / sorted.length }; };
  const base = (rows) => {
    const eligible = rows.filter((r) => r.gradingEligible !== false);
    return {
      n: rows.length, httpOK: rows.filter((r) => r.httpStatus === 200).length,
      basis: Object.fromEntries(['materials', 'general', 'insufficient'].map((basis) => [basis, rows.filter((r) => r.answer?.basis === basis).length])),
      retrieval: statistics(rows.map((r) => r.recallAt5)),
      timingMs: { total: statistics(rows.map((r) => r.timings.totalMs)), retrieval: statistics(rows.map((r) => r.timings.retrievalMs)), model: statistics(rows.map((r) => r.timings.modelMs)) },
      reviewed: eligible.filter((r) => Number.isInteger(grades.get(r.key)?.correctness)).length,
      scoreCounts: Object.fromEntries([0, 1, 2].map((score) => [score, eligible.filter((r) => grades.get(r.key)?.correctness === score).length])),
      correctness: statistics(eligible.map((r) => grades.get(r.key)?.correctness)),
      crossCourse: rows.filter((r) => r.crossCourseRetrieval).length,
      apiHistoryMismatches: rows.filter((r) => r.httpStatus === 200 && !r.apiMatchesPersistedHistory).length,
    };
  };
  return { totalRuns: results.length, primary: base(primary), repeated: base(results.filter((r) => r.repeat)), groups: Object.fromEntries(['text', 'image', 'expanded', 'insufficient'].map((g) => [g, base(primary.filter((r) => r.group === g))])), modes: Object.fromEntries(['materials', 'expanded'].map((m) => [m, base(primary.filter((r) => r.mode === m))])) };
}

async function cli() {
  const [command, ...args] = process.argv.slice(2), options = {};
  for (let i = 0; i < args.length; i++) { if (!args[i].startsWith('--')) throw new Error('Expected named argument'); const name = args[i].slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()); options[name] = name === 'resume' ? true : args[++i]; }
  const need = (...names) => { for (const name of names) if (!options[name]) throw new Error('Missing --' + name.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())); };
  if (command === 'inventory') { need('database', 'documents', 'out'); return inventory(options); }
  if (command === 'render') { need('pdf', 'pages', 'out'); return renderPages({ ...options, pages: options.pages.split(',').map(Number) }); }
  if (command === 'run') { need('database', 'documents', 'suite', 'out', 'runtimeUrl', 'ollamaUrl', 'contextSize', 'timeoutMs'); return runEvaluation(options); }
  if (command === 'summarize') { need('run'); const directory = privateOutput(options.run); const results = fs.readFileSync(path.join(directory, 'results.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); const reviews = fs.existsSync(path.join(directory, 'reviews.json')) ? json(path.join(directory, 'reviews.json')).reviews : []; const summary = summarizeResults(results, reviews); write(path.join(directory, 'summary.json'), summary); console.log(JSON.stringify(summary, null, 2)); return; }
  throw new Error('Commands: inventory, render, run, summarize. See docs/AI-QUALITY-BASELINE.md for explicit input arguments.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) cli().catch((error) => { console.error(error.message); process.exitCode = 1; });
