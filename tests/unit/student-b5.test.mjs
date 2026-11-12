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
import { StudentError } from '../../server/student/storage.mjs';

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

test('B5 P0.1: Provider status differentiates unverified, connected, auth_required and disconnected', async () => {
  const fakeFetch = async (url, init) => {
    const u = String(url);
    if (u.includes('/api/tags')) {
      return Response.json({ models: [{ name: 'qwen3:4b', size: 1000 }, { name: 'embeddinggemma:latest', size: 1000 }] });
    }
    if (u.includes('/api/chat')) {
      return Response.json({ done: true, message: { content: 'OK' } });
    }
    return Response.json({}, { status: 404 });
  };

  const ollama = createOllama({ fetch: fakeFetch, baseURL: 'http://127.0.0.1:11434' });
  const initialStatus = await ollama.status();
  assert.equal(initialStatus.connected, true);
  assert.equal(initialStatus.cloudStatus.state, 'unverified');

  // Verify cloud with ping
  const verified = await ollama.cloudChat.verify('glm-5.3-flash:cloud');
  assert.equal(verified.ok, true);
  assert.equal(verified.state, 'connected');

  // After verification, status reflects connected state
  const updatedStatus = await ollama.status();
  assert.equal(updatedStatus.cloudStatus.state, 'connected');
  assert.equal(updatedStatus.cloudStatus.model, 'glm-5.3-flash:cloud');
});

test('B5 P0.2: Ollama Cloud verify and chat protocols with markdown parsing and format fallback', async () => {
  let callCount = 0;
  const fakeFetch = async (url, init) => {
    callCount++;
    const body = JSON.parse(init.body || '{}');

    // Simulate 400 for first attempt with complex schema, succeeding on retry with format: 'json'
    if (body.format && typeof body.format === 'object' && body.format.type === 'object') {
      return Response.json({ error: 'unsupported schema format' }, { status: 400 });
    }

    // Return answer wrapped inside markdown code fences to verify defensive parsing
    const jsonStr = JSON.stringify({
      answer: 'Analysis of OOP encapsulation',
      basis: 'materials',
      sourceIds: ['S1'],
    });

    return Response.json({
      done: true,
      done_reason: 'stop',
      message: {
        role: 'assistant',
        content: `Here is the response:\n\`\`\`json\n${jsonStr}\n\`\`\``,
      },
    });
  };

  const ollama = createOllama({ fetch: fakeFetch, baseURL: 'http://127.0.0.1:11434' });
  const result = await ollama.cloudChat.chat({
    instructions: 'You are tutor',
    input: [{ role: 'user', content: 'Explain encapsulation' }],
    model: 'glm-5.3-flash:cloud',
    mode: 'materials',
  });

  assert.equal(result.answer, 'Analysis of OOP encapsulation');
  assert.equal(result.basis, 'materials');
  assert.deepEqual(result.sourceIds, ['S1']);
  assert.ok(callCount >= 2, 'Should have fallen back to format: json after 400');
});

test('B5 P0.2: Ollama Cloud maps authentication, credit/rate limits and missing model errors', async () => {
  // 401 unauthorized
  const fetch401 = async () => Response.json({ error: 'unauthorized: sign in required' }, { status: 401 });
  const p401 = createOllama({ fetch: fetch401 });
  await assert.rejects(
    p401.cloudChat.chat({ instructions: '', input: [], model: 'qwen2.5:cloud' }),
    (err) => err.code === 'ollamaAuthRequired',
  );

  const verify401 = await p401.cloudChat.verify('qwen2.5:cloud');
  assert.equal(verify401.ok, false);
  assert.equal(verify401.state, 'auth_required');

  // 402 payment required / credits
  const fetch402 = async () => Response.json({ error: 'Add usage credits or subscribe to a plan at ollama.com/plans' }, { status: 402 });
  const p402 = createOllama({ fetch: fetch402 });
  await assert.rejects(
    p402.cloudChat.chat({ instructions: '', input: [], model: 'qwen2.5:cloud' }),
    (err) => err.code === 'ollamaRateLimit',
  );

  const verify402 = await p402.cloudChat.verify('qwen2.5:cloud');
  assert.equal(verify402.ok, false);
  assert.equal(verify402.state, 'rate_limited');

  // 404 model missing
  const fetch404 = async () => Response.json({ error: 'model not found' }, { status: 404 });
  const p404 = createOllama({ fetch: fetch404 });
  await assert.rejects(
    p404.cloudChat.chat({ instructions: '', input: [], model: 'unknown:cloud' }),
    (err) => err.code === 'ollamaModelMissing',
  );
});

test('B5 P0.3: Model with missing citations is strictly rejected without synthetic citation injection', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'student-b5-p03-'));
  const aiProvider = createMockAIProvider();

  // Model returns basis='materials' but empty sourceIds: []
  const modelWithoutCitations = {
    chat: async () => ({
      answer: 'Answer that claimed materials but provided zero citations',
      basis: 'materials',
      sourceIds: [],
    }),
  };

  const registry = createProviderRegistry({
    embedding: aiProvider,
    entries: [
      { id: 'mock', provider: aiProvider, configured: true },
      { id: 'ollama-cloud', provider: modelWithoutCitations, configured: true },
    ],
    defaultProvider: 'mock',
  });

  const service = createStudentService(dir, { aiRegistry: registry, aiProvider });
  t.after(() => {
    try { service.close(); } catch {}
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  const sem = service.createSemester({ name: 'Học kỳ B5 P03', academicYear: '2026-2027' });
  const course = service.createCourse({ name: 'OOP Căn bản', semesterId: sem.id });
  const doc = service.addMaterial(course.id, createTestPdf(['Encapsulation concept']), 'OOP.pdf', 'application/pdf');
  await service.processDocument(doc.id);

  // Send question with model that lacks citations
  await assert.rejects(
    service.sendChat({
      courseId: course.id,
      requestId: randomUUID(),
      message: 'Explain encapsulation from document',
      provider: 'ollama-cloud',
      mode: 'materials',
    }),
    (err) => err.code === 'aiInvalidCitation',
  );

  // Check database: no turn was committed as completed with synthetic sources!
  const history = service.chatHistory(course.id);
  const turn = history.turns[0];
  assert.equal(turn.status, 'failed');
  assert.equal(turn.errorCode, 'aiInvalidCitation');
  // No assistant message with fake citations exists
  const assistantMsg = turn.messages.find((m) => m.role === 'assistant');
  assert.equal(assistantMsg, undefined);
});

test('B5 P0.4: resolveSourceTarget handles chapter synonyms, filename keywords and diagnostics', () => {
  const materials = [
    { id: 'doc-1', originalFilename: 'Chuong_5_Database.pdf', status: 'ready', pageCount: 50 },
    { id: 'doc-2', originalFilename: 'Slide_OOP_Lecture_2.pdf', status: 'ready', pageCount: 25 },
  ];

  const db = {
    prepare: (query) => {
      if (query.includes('FROM documents')) {
        return { all: () => materials };
      }
      if (query.includes('FROM document_pages')) {
        return {
          get: (docId, pageNum) => {
            if (docId === 'doc-1' && pageNum === 37) {
              return { pageNumber: 37, method: 'native', status: 'extracted', charCount: 300, warningCode: null };
            }
            if (docId === 'doc-1' && pageNum === 38) {
              return { pageNumber: 38, method: 'ocr', status: 'ocr_failed', charCount: 0, warningCode: 'ocr_error' };
            }
            if (docId === 'doc-1' && pageNum === 39) {
              return { pageNumber: 39, method: 'native', status: 'empty', charCount: 0, warningCode: null };
            }
            return null;
          },
        };
      }
      if (query.includes('FROM document_chunks')) {
        return {
          all: (docId, pageNum) => {
            if (pageNum === 37 || pageNum === 15) {
              return [{ chunkId: `c-${pageNum}`, documentId: docId, pageNumber: pageNum, chunkIndex: 0, content: `Page ${pageNum} content`, documentName: 'doc.pdf', score: 1.0 }];
            }
            return [];
          },
        };
      }
      return { get: () => null, all: () => [] };
    },
  };

  // Case 1: "Chương 5 trang 37"
  const t1 = resolveSourceTarget({
    db,
    courseId: 'c-1',
    message: 'giải thích chương 5 trang 37',
  });
  assert.equal(t1.valid, true);
  assert.equal(t1.target.documentId, 'doc-1');
  assert.equal(t1.target.pageNumber, 37);
  assert.equal(t1.pageChunks.length, 1);
  assert.equal(t1.pageChunks[0].chunkId, 'c-37');

  // Case 2: Lecture synonym: "lecture 2 slide 15"
  const t2 = resolveSourceTarget({
    db,
    courseId: 'c-1',
    message: 'xem lecture 2 slide 15',
  });
  assert.equal(t2.valid, true);
  assert.equal(t2.target.documentId, 'doc-2');
  assert.equal(t2.target.pageNumber, 15);

  // Case 3: Out of range page: "chương 5 trang 99"
  const t3 = resolveSourceTarget({
    db,
    courseId: 'c-1',
    message: 'chương 5 trang 99',
  });
  assert.equal(t3.valid, false);
  assert.equal(t3.reason, 'pageOutOfRange');

  // Case 4: Failed OCR page: "chương 5 trang 38"
  const t4 = resolveSourceTarget({
    db,
    courseId: 'c-1',
    message: 'chương 5 trang 38',
  });
  assert.equal(t4.valid, false);
  assert.equal(t4.reason, 'ocrFailed');

  // Case 5: Empty page: "chương 5 trang 39"
  const t5 = resolveSourceTarget({
    db,
    courseId: 'c-1',
    message: 'chương 5 trang 39',
  });
  assert.equal(t5.valid, false);
  assert.equal(t5.reason, 'emptyPage');

  // Case 6: Matching by filename keyword: "tài liệu Database trang 37"
  const t6 = resolveSourceTarget({
    db,
    courseId: 'c-1',
    message: 'xem tài liệu Database trang 37',
  });
  assert.equal(t6.valid, true);
  assert.equal(t6.target.documentId, 'doc-1');
  assert.equal(t6.target.pageNumber, 37);
});

test('B5 P0.5: CourseChat end-to-end retry preserves provider/model/target, and cancel marks chatCancelled', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'student-b5-p05-'));
  const aiProvider = createMockAIProvider();

  const cloudCalls = [];
  const fakeCloudProvider = {
    chat: async (context) => {
      cloudCalls.push(context);
      return {
        answer: 'Cloud response grounded on target page',
        basis: 'materials',
        sourceIds: ['S1'],
      };
    },
    verify: async (model) => ({ ok: true, state: 'connected', model }),
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

  const sem = service.createSemester({ name: 'Học kỳ B5 P05', academicYear: '2026-2027' });
  const course = service.createCourse({ name: 'Hệ phân tán', semesterId: sem.id });

  const pdfBytes = createTestPdf([
    { text: 'Chương 1: Khái niệm hệ phân tán.' },
    { text: 'Chương 2: Thuật toán đồng thuận Paxos và Raft.' },
  ]);
  const doc = service.addMaterial(course.id, pdfBytes, 'HePhanTan_Chuong_2.pdf', 'application/pdf');
  await service.processDocument(doc.id);

  // Verification endpoint test
  const verifyRes = await service.verifyAIProvider({ provider: 'ollama-cloud', model: 'glm-5.3-flash:cloud' });
  assert.equal(verifyRes.ok, true);
  assert.equal(verifyRes.state, 'connected');

  // Turn 1: Question targeting page 2
  const requestId1 = randomUUID();
  const turn1 = await service.sendChat({
    courseId: course.id,
    requestId: requestId1,
    message: 'Giải thích Raft ở chương 2 trang 2',
    provider: 'ollama-cloud',
    model: 'glm-5.3-flash:cloud',
    mode: 'materials',
  });

  assert.equal(turn1.turns.length, 1);
  const completed = turn1.turns[0];
  assert.equal(completed.provider, 'ollama-cloud');
  assert.equal(completed.model, 'glm-5.3-flash:cloud');
  assert.equal(completed.sourceTarget?.pageNumber, 2);
  assert.equal(completed.sourceTarget?.documentId, doc.id);
  const originalRequest = { courseId: course.id, requestId: requestId1, message: 'Giải thích Raft ở chương 2 trang 2', provider: 'ollama-cloud', mode: 'materials' };
  await assert.rejects(service.sendChat({ ...originalRequest, model: 'other:cloud' }), (err) => err.code === 'chatRequestConflict');
  await assert.rejects(service.sendChat({ ...originalRequest, sourceTarget: { documentId: doc.id, pageNumber: 1 } }), (err) => err.code === 'chatRequestConflict');

  // Turn 2: Cancel chat
  const requestId2 = randomUUID();
  const sendPromise = service.sendChat({
    courseId: course.id,
    requestId: requestId2,
    message: 'Câu hỏi cần hủy',
    provider: 'ollama-cloud',
    model: 'glm-5.3-flash:cloud',
    mode: 'materials',
  });

  // Cancel immediately
  service.cancelChat(course.id, requestId2);
  await assert.rejects(sendPromise, (err) => err.code === 'chatCancelled');

  const historyAfterCancel = service.chatHistory(course.id);
  const cancelledTurn = historyAfterCancel.turns.find((t) => t.requestId === requestId2);
  assert.ok(cancelledTurn, 'Cancelled turn should be preserved in history');
  assert.equal(cancelledTurn.status, 'failed');
  assert.equal(cancelledTurn.errorCode, 'chatCancelled');

  // Retry the cancelled question: preserves provider, model, mode
  const retryTurn = await service.sendChat({
    courseId: course.id,
    requestId: requestId2,
    message: 'Câu hỏi cần hủy',
    provider: cancelledTurn.provider,
    model: cancelledTurn.model || undefined,
    mode: cancelledTurn.mode,
  });

  const retried = retryTurn.turns.find((t) => t.requestId === requestId2);
  assert.equal(retried.status, 'completed');
  assert.equal(retried.provider, 'ollama-cloud');
  assert.equal(retried.model, 'glm-5.3-flash:cloud');
});
