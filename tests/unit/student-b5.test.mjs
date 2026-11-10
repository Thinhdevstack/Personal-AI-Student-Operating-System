import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createOllama } from '../../server/ai/ollama.mjs';
import { createAIProviders, createProviderRegistry } from '../../server/ai/providers.mjs';
import { resolveSourceTarget } from '../../server/ai/targeting.mjs';
import { createStudentService } from '../../server/student/service.mjs';
import { createMockAIProvider } from '../../server/ai/openai.mjs';

function createTestPdf(pages) {
  const pageList = pages.map((p) => (typeof p === 'string' ? { text: p, hasImage: false } : p));
  const pageCount = pageList.length;

  let out = '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
  const kids = Array.from({ length: pageCount }, (_, i) => (3 + i) + ' 0 R').join(' ');
  out += '2 0 obj\n<< /Type /Pages /Kids [' + kids + '] /Count ' + pageCount + ' >>\nendobj\n';

  const fontObjId = 3 + pageCount;
  const imageObjId = fontObjId + 1;
  const contentStartId = imageObjId + 1;

  for (let i = 0; i < pageCount; i++) {
    const pageId = 3 + i;
    const contentId = contentStartId + i;
    const res = pageList[i].hasImage
      ? `<< /Font << /F1 ${fontObjId} 0 R >> /XObject << /Im1 ${imageObjId} 0 R >> >>`
      : `<< /Font << /F1 ${fontObjId} 0 R >> >>`;
    out += `${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources ${res} /Contents ${contentId} 0 R >>\nendobj\n`;
  }

  out += `${fontObjId} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`;

  const rawPixel = Buffer.from([255, 0, 0]);
  out += `${imageObjId} 0 obj\n<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${rawPixel.length} >>\nstream\n`;
  out += rawPixel.toString('binary') + '\nendstream\nendobj\n';

  for (let i = 0; i < pageCount; i++) {
    const contentId = contentStartId + i;
    const cleanText = pageList[i].text.replace(/[()\\\\]/g, '');
    let stream = '';
    if (cleanText.trim()) {
      stream += `BT\n/F1 12 Tf\n100 700 Td\n(${cleanText}) Tj\nET\n`;
    }
    if (pageList[i].hasImage) {
      stream += 'q 100 0 0 100 50 500 cm /Im1 Do Q\n';
    }
    out += `${contentId} 0 obj\n<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream\nendobj\n`;
  }

  const totalObjs = contentStartId + pageCount;
  out += `xref\n0 ${totalObjs}\n0000000000 65535 f \n`;
  out += `trailer\n<< /Size ${totalObjs} /Root 1 0 R >>\nstartxref\n${Buffer.byteLength(out)}\n%%EOF\n`;
  return Buffer.from(out, 'binary');
}

test('B5: Ollama Cloud provider is registered separately from Ollama Local', () => {
  const registry = createAIProviders();
  const settings = registry.settings();

  const local = settings.chatProviders.find((p) => p.id === 'ollama');
  const cloud = settings.chatProviders.find((p) => p.id === 'ollama-cloud');

  assert.ok(local, 'ollama local provider should exist');
  assert.ok(cloud, 'ollama cloud provider should exist');
  assert.notEqual(local.id, cloud.id);
  assert.equal(local.label, 'Ollama · AI local');
  assert.equal(cloud.label, 'Ollama · AI Cloud');

  assert.ok(Array.isArray(settings.cloudModels));
  assert.ok(settings.cloudModels.includes('glm-5.3-flash:cloud'));
  assert.ok(settings.cloudModels.includes('qwen2.5:cloud'));
});

test('B5: Ollama Cloud chat passes dynamic model and parses responses', async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return Response.json({
      done: true,
      done_reason: 'stop',
      message: {
        role: 'assistant',
        content: JSON.stringify({
          answer: 'Cloud response from glm',
          basis: 'materials',
          sourceIds: ['S1'],
        }),
      },
    });
  };

  const providers = createOllama({
    baseURL: 'http://127.0.0.1:11434',
    chatModel: 'qwen3:4b',
    fetch: fakeFetch,
  });

  const res = await providers.cloudChat.chat({
    instructions: 'Instructions here',
    input: [{ role: 'user', content: 'Explain OOP' }],
    model: 'glm-5.3-flash:cloud',
    mode: 'materials',
  });

  assert.equal(res.answer, 'Cloud response from glm');
  assert.equal(res.basis, 'materials');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.model, 'glm-5.3-flash:cloud');
  assert.equal(calls[0].body.stream, false);
});

test('B5: Ollama Cloud maps authentication, credit/rate limits and missing model errors', async () => {
  // 401 unauthorized
  const fetch401 = async () => Response.json({ error: 'unauthorized: sign in required' }, { status: 401 });
  const p401 = createOllama({ fetch: fetch401 });
  await assert.rejects(
    p401.cloudChat.chat({ instructions: '', input: [], model: 'qwen2.5:cloud' }),
    (err) => err.code === 'ollamaAuthRequired',
  );

  // 402 payment required / credits
  const fetch402 = async () => Response.json({ error: 'Add usage credits or subscribe to a plan at ollama.com/plans' }, { status: 402 });
  const p402 = createOllama({ fetch: fetch402 });
  await assert.rejects(
    p402.cloudChat.chat({ instructions: '', input: [], model: 'qwen2.5:cloud' }),
    (err) => err.code === 'ollamaRateLimit',
  );

  // 404 model missing
  const fetch404 = async () => Response.json({ error: 'model not found' }, { status: 404 });
  const p404 = createOllama({ fetch: fetch404 });
  await assert.rejects(
    p404.cloudChat.chat({ instructions: '', input: [], model: 'unknown:cloud' }),
    (err) => err.code === 'ollamaModelMissing',
  );
});

test('B5: resolveSourceTarget extracts page and chapter patterns and validates against documents', () => {
  const materials = [
    { id: 'doc-1', originalFilename: 'Chuong_1_OOP.pdf', status: 'ready', pageCount: 20 },
    { id: 'doc-2', originalFilename: 'Chuong_2_Database.pdf', status: 'ready', pageCount: 30 },
  ];

  const db = {
    prepare: (query) => {
      if (query.includes('FROM documents')) {
        return {
          all: () => materials,
        };
      }
      if (query.includes('FROM document_pages')) {
        return {
          get: (docId, pageNum) => {
            if (docId === 'doc-1') {
              if (pageNum === 5) return { pageNumber: 5, method: 'native', status: 'extracted', charCount: 200, warningCode: null };
              if (pageNum === 6) return { pageNumber: 6, method: 'ocr', status: 'ocr_applied', charCount: 150, warningCode: null };
              if (pageNum === 7) return { pageNumber: 7, method: 'native', status: 'empty', charCount: 0, warningCode: null };
              if (pageNum === 8) return { pageNumber: 8, method: 'ocr', status: 'ocr_failed', charCount: 0, warningCode: 'ocr_error' };
            }
            return null;
          },
        };
      }
      if (query.includes('FROM document_chunks')) {
        return {
          all: (docId, pageNum) => [{ chunkId: 'c1', documentId: docId, pageNumber: pageNum, chunkIndex: 0, content: 'Text of page', documentName: 'Chuong_1_OOP.pdf', score: 1.0 }],
        };
      }
      return { get: () => null, all: () => [] };
    },
  };

  // Case 1: Pattern "chương 1 trang 5"
  const t1 = resolveSourceTarget({
    db,
    courseId: 'c-1',
    message: 'Giải thích định nghĩa ở chương 1 trang 5',
  });
  assert.equal(t1.valid, true);
  assert.equal(t1.target.documentId, 'doc-1');
  assert.equal(t1.target.pageNumber, 5);
  assert.ok(t1.pageChunks.length > 0);

  // Case 2: Out of range page (e.g. trang 99 in 20-page doc)
  const t2 = resolveSourceTarget({
    db,
    courseId: 'c-1',
    message: 'chương 1 trang 99 nói gì?',
  });
  assert.equal(t2.valid, false);
  assert.equal(t2.reason, 'pageOutOfRange');

  // Case 3: Empty page (page 7 has 0 charCount)
  const t3 = resolveSourceTarget({
    db,
    courseId: 'c-1',
    message: 'hỏi trang 7',
    explicitTarget: { documentId: 'doc-1' },
  });
  assert.equal(t3.valid, false);
  assert.equal(t3.reason, 'emptyPage');

  // Case 4: Failed OCR page (page 8)
  const t4 = resolveSourceTarget({
    db,
    courseId: 'c-1',
    message: 'hỏi trang 8',
    explicitTarget: { documentId: 'doc-1' },
  });
  assert.equal(t4.valid, false);
  assert.equal(t4.reason, 'ocrFailed');

  // Case 5: Ambiguous document match
  const ambiguousMaterials = [
    { id: 'doc-a', originalFilename: 'Slide_OOP_Chuong_1_Part1.pdf', status: 'ready', pageCount: 10 },
    { id: 'doc-b', originalFilename: 'Slide_OOP_Chuong_1_Part2.pdf', status: 'ready', pageCount: 10 },
  ];
  const dbAmbiguous = {
    prepare: () => ({
      all: () => ambiguousMaterials,
      get: () => null,
    }),
  };
  const t5 = resolveSourceTarget({
    db: dbAmbiguous,
    courseId: 'c-1',
    message: 'xem chương 1 trang 2',
  });
  assert.equal(t5.ambiguous, true);
  assert.equal(t5.matchedDocs.length, 2);
});

test('B5: CourseChat end-to-end persists sourceTarget and model, and handles targeted questions', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'student-b5-e2e-'));
  const aiProvider = createMockAIProvider();

  // Create cloud provider entry
  const cloudCalls = [];
  const fakeCloudProvider = {
    chat: async (context) => {
      cloudCalls.push(context);
      return {
        answer: 'Cloud model answered using targeted page chunks',
        basis: 'materials',
        sourceIds: ['S1'],
      };
    },
  };

  const registry = createProviderRegistry({
    embedding: aiProvider,
    entries: [
      { id: 'mock', provider: aiProvider, configured: true },
      { id: 'ollama-cloud', provider: fakeCloudProvider, configured: true },
    ],
    defaultProvider: 'mock',
    cloudModels: ['glm-5.3-flash:cloud'],
  });

  const service = createStudentService(dir, { aiRegistry: registry, aiProvider });
  t.after(() => {
    try { service.close(); } catch {}
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  const sem = service.createSemester({ name: 'Học kỳ B5', academicYear: '2026-2027' });
  const course = service.createCourse({ name: 'Kiến trúc phần mềm', semesterId: sem.id });

  // Add 2-page PDF
  const pdfBytes = createTestPdf([
    { text: 'Chương 1 giới thiệu Microservices và Monolith.' },
    { text: 'Chương 2 phân tích REST API và Event Driven.' },
  ]);
  const doc = service.addMaterial(course.id, pdfBytes, 'KienTrucPhanMem.pdf', 'application/pdf');
  await service.processDocument(doc.id);

  // Case 1: Send chat targeted at page 2
  const turn1 = await service.sendChat({
    courseId: course.id,
    requestId: randomUUID(),
    message: 'Giải thích Event Driven ở trang 2',
    provider: 'ollama-cloud',
    model: 'glm-5.3-flash:cloud',
    mode: 'materials',
  });

  assert.equal(turn1.turns.length, 1);
  const completedTurn = turn1.turns[0];
  assert.equal(completedTurn.provider, 'ollama-cloud');
  assert.equal(completedTurn.model, 'glm-5.3-flash:cloud');
  assert.ok(completedTurn.sourceTarget);
  assert.equal(completedTurn.sourceTarget.documentId, doc.id);
  assert.equal(completedTurn.sourceTarget.pageNumber, 2);

  // Check cloud call received context with page 2 chunks
  assert.equal(cloudCalls.length, 1);
  const promptText = cloudCalls[0].input.map((m) => m.content).join('\n');
  assert.ok(promptText.includes('Event Driven') || promptText.includes('trang 2'));

  // Case 2: Out of range page query returns immediate diagnostic explanation without calling cloud model
  const beforeCount = cloudCalls.length;
  const turn2 = await service.sendChat({
    courseId: course.id,
    requestId: randomUUID(),
    message: 'Tài liệu KienTrucPhanMem trang 99 nói gì?',
    provider: 'ollama-cloud',
    model: 'glm-5.3-flash:cloud',
    mode: 'materials',
  });

  assert.equal(turn2.turns.length, 2);
  const diagnosticTurn = turn2.turns[1];
  assert.equal(cloudCalls.length, beforeCount, 'Cloud model should NOT be called for out of range page');
  const assistantMsg = diagnosticTurn.messages.find((m) => m.role === 'assistant');
  assert.equal(assistantMsg.basis, 'insufficient');
  assert.ok(assistantMsg.content.includes('không có trang 99') || assistantMsg.content.includes('vượt quá'));

  // Verify history preserves sourceTarget
  const retrievedHistory = service.chatHistory(course.id);
  assert.equal(retrievedHistory.turns.length, 2);
  assert.equal(retrievedHistory.turns[0].sourceTarget?.pageNumber, 2);
  assert.equal(retrievedHistory.turns[0].model, 'glm-5.3-flash:cloud');
});
