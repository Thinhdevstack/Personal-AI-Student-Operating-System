// Read-only UI replay of measured real answers. Does not make a new inference or write learner data.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { chromium } from '@playwright/test';

const options = {};
for (let i = 2; i < process.argv.length; i += 2) options[process.argv[i].slice(2)] = process.argv[i + 1];
for (const field of ['run', 'runtime-url', 'out']) if (!options[field]) throw new Error('Missing --' + field);
const origin = new URL(options['runtime-url']);
if (origin.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname) || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') throw new Error('Expected loopback origin');
const output = path.resolve(options.out);
execFileSync('git', ['check-ignore', '--no-index', '--stdin'], { input: path.join(output, '.private-ui') + '\n', windowsHide: true });
fs.mkdirSync(output, { recursive: true });
const root = path.resolve(options.run), manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const results = fs.readFileSync(path.join(root, 'results.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const selected = [results.find((r) => !r.repeat && r.mode === 'materials' && r.answer?.basis === 'materials'), results.find((r) => !r.repeat && r.mode === 'materials' && r.answer?.basis === 'insufficient'), results.find((r) => !r.repeat && r.mode === 'expanded' && r.answer?.content.includes('Bổ sung từ kiến thức mô hình'))].filter(Boolean);
const db = new Database(path.join(root, 'workspace/student.sqlite'), { readonly: true, fileMustExist: true });
const snapshot = { semesters: db.prepare('SELECT * FROM semesters').all(), courses: db.prepare('SELECT *,1 AS hasData FROM courses').all(), recentMaterials: [] };
const materials = db.prepare('SELECT id,courseId,originalFilename,filename,status,pageCount,sizeBytes,uploadedAt FROM documents').all();
db.close();
const browser = await chromium.launch({ headless: true });
const checks = [];
try {
  for (const record of selected) {
    const course = snapshot.courses.find((c) => materials.some((d) => d.courseId === c.id && record.context?.sources.some((s) => s.documentId === d.id))) || snapshot.courses[0];
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(({ courseId, mode }) => localStorage.setItem('student-chat-mode:' + courseId, mode), { courseId: course.id, mode: record.mode });
    const page = await context.newPage(), errors = [], blockedWrites = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/api/student/**', async (route) => {
      const request = route.request(), url = new URL(request.url()), endpoint = url.pathname;
      let body;
      if (request.method() !== 'GET') { blockedWrites.push(endpoint); return route.fulfill({ status: 405, json: { error: 'evaluationReadOnly' } }); }
      if (endpoint === '/api/student/snapshot') body = snapshot;
      else if (endpoint === '/api/student/ai') body = manifest.config;
      else if (endpoint === '/api/student/ai/local') body = { connected: true, chatReady: true, embeddingReady: true, models: [], chatModel: manifest.config.chatProviders.find((p) => p.id === 'ollama').model, embeddingModel: manifest.config.embedding.model.replace(/^ollama\//, '') };
      else if (endpoint.endsWith('/materials')) body = materials.filter((d) => d.courseId === course.id).map((d) => ({ ...d, indexReady: true }));
      else if (endpoint.endsWith('/chat')) body = { conversationId: '00000000-0000-4000-8000-000000000001', isMock: false, turns: [{ id: record.key, sequence: 1, requestId: '00000000-0000-4000-8000-000000000002', provider: 'ollama', mode: record.mode, language: 'vi', model: manifest.config.chatProviders.find((p) => p.id === 'ollama').model, status: 'completed', isMock: false, messages: [{ id: 'evaluation-user', role: 'user', content: record.question, sources: [], memories: [] }, record.answer] }] };
      else body = { error: 'evaluationEndpointNotProvided' };
      await route.fulfill({ status: 200, json: body });
    });
    await page.goto(origin.origin + '/student?lang=vi&course=' + encodeURIComponent(course.id) + '&tab=chat');
    const text = page.locator('.student-chat-assistant .student-chat-text');
    await text.waitFor({ state: 'visible', timeout: 30000 });
    const rendered = (await text.textContent()) === record.answer.content;
    const sourceLinks = await page.locator('.student-chat-assistant .student-chat-sources li').count();
    const mode = await page.locator('select[id^="chat-mode-"]').inputValue();
    const expandedButton = await page.locator('.student-ask-expanded').count();
    const screenshot = record.key.replaceAll(':', '-') + '.png';
    await page.locator('.course-chat').screenshot({ path: path.join(output, screenshot) });
    checks.push({ key: record.key, type: 'recorded-real-answer-replay', renderedExactly: rendered, sourceLinks, expectedSourceLinks: record.answer.sources.length, mode, expectedMode: record.mode, expandedButton, errors, blockedWrites, screenshot });
    await context.close();
  }
} finally { await browser.close(); }
fs.writeFileSync(path.join(output, 'ui-replay.json'), JSON.stringify({ liveInference: false, learnerDataWrites: false, checks }, null, 2) + '\n');
if (!checks.length || checks.some((c) => !c.renderedExactly || c.mode !== c.expectedMode || c.sourceLinks !== c.expectedSourceLinks || c.errors.length || c.blockedWrites.length || c.expectedMode === 'materials' && results.find((r) => r.key === c.key)?.answer.basis === 'insufficient' && c.expandedButton !== 1)) throw new Error('Recorded-answer UI replay failed; inspect private report');
console.log(JSON.stringify({ checked: checks.length, passed: true, liveInference: false, learnerDataWrites: false }));
