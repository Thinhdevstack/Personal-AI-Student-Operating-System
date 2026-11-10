import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createStudentService } from '../../server/student/service.mjs';
import { createStudentRoutes } from '../../server/student/routes.mjs';
import { createMockAIProvider } from '../../server/ai/openai.mjs';

function createTestPdf(pages) {
  // pages is array of { text: string, hasImage?: boolean } or string
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

  // Helvetica font
  out += `${fontObjId} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`;

  // Dummy 1x1 image XObject
  const rawPixel = Buffer.from([255, 0, 0]); // 1 RGB pixel
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

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'student-b4-test-'));
  const aiProvider = createMockAIProvider();
  let service = createStudentService(dir, { aiProvider });
  t.after(() => {
    try { service?.close(); } catch {}
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  const sem = service.createSemester({ name: 'Học kỳ B4', academicYear: '2026-2027' });
  const course1 = service.createCourse({ name: 'Lập trình OOP', semesterId: sem.id });
  const course2 = service.createCourse({ name: 'Cơ sở dữ liệu', semesterId: sem.id });

  return { dir, service, aiProvider, sem, course1, course2 };
}

test('B4: Per-page coverage and diagnostics are recorded accurately', async (t) => {
  const { service, course1 } = setup(t);

  // 3-page PDF:
  // Page 1: Native text
  // Page 2: Has image and < 250 chars -> triggers automatic OCR
  // Page 3: Empty native text, no image -> marked empty
  const pdfBytes = createTestPdf([
    { text: 'First page has native text about OOP concepts.' },
    { text: ' ', hasImage: true },
    { text: '   ', hasImage: false }
  ]);

  const doc = service.addMaterial(course1.id, pdfBytes, 'coverage-doc.pdf', 'application/pdf');

  const mockOcr = async () => {
    return { text: 'OCR extracted text from diagram on page two', language: 'vi', engine: 'mock-ocr' };
  };

  const processed = await service.processDocument(doc.id, { ocr: mockOcr });
  assert.equal(processed.status, 'ready');
  assert.equal(processed.pageCount, 3);
  assert.equal(processed.pagesWithText, 2);
  assert.equal(processed.pagesOcr, 1);
  assert.equal(processed.pagesWarning, 1);
  assert.equal(processed.coverageStatus, 'partial');
  assert.equal(processed.indexReady, true);

  const pages = service.documentPages(doc.id);
  assert.equal(pages.length, 3);

  // Page 1: native
  assert.equal(pages[0].pageNumber, 1);
  assert.equal(pages[0].method, 'native');
  assert.equal(pages[0].status, 'extracted');
  assert.ok(pages[0].charCount > 10);
  assert.equal(pages[0].warningCode, null);

  // Page 2: ocr
  assert.equal(pages[1].pageNumber, 2);
  assert.equal(pages[1].method, 'ocr');
  assert.equal(pages[1].status, 'ocr_applied');
  assert.equal(pages[1].ocrEngine, 'mock-ocr');
  assert.equal(pages[1].ocrLanguage, 'vi');
  assert.ok(pages[1].charCount > 10);

  // Page 3: none / empty
  assert.equal(pages[2].pageNumber, 3);
  assert.equal(pages[2].method, 'none');
  assert.equal(pages[2].status, 'empty');
  assert.equal(pages[2].warningCode, 'emptyPage');
});

test('B4: Single-page OCR failure does not crash whole document extraction', async (t) => {
  const { service, course1 } = setup(t);

  const pdfBytes = createTestPdf([
    { text: 'Page 1: Valid lecture text content.' },
    { text: ' ', hasImage: true }, // Page 2: triggers OCR which will throw
    { text: 'Page 3: Another valid lecture page text.' }
  ]);

  const doc = service.addMaterial(course1.id, pdfBytes, 'partial-fail.pdf', 'application/pdf');

  const failingOcr = async () => {
    throw new Error('Simulated Windows OCR timeout on page 2');
  };

  const processed = await service.processDocument(doc.id, { ocr: failingOcr });
  assert.equal(processed.status, 'ready');
  assert.equal(processed.pageCount, 3);
  assert.equal(processed.pagesWithText, 2); // Pages 1 and 3
  assert.equal(processed.pagesWarning, 1); // Page 2 warned
  assert.equal(processed.coverageStatus, 'partial');

  const pages = service.documentPages(doc.id);
  assert.equal(pages.length, 3);
  assert.equal(pages[1].pageNumber, 2);
  assert.equal(pages[1].status, 'ocr_failed');
  assert.equal(pages[1].warningCode, 'ocrPageFailed');
});

test('B4: Selective OCR reprocessing on chosen pages', async (t) => {
  const { service, course1 } = setup(t);

  const pdfBytes = createTestPdf([
    { text: 'Page 1 text.' },
    { text: 'Page 2 with rich text and complex diagram.' },
    { text: 'Page 3 text.' }
  ]);

  const doc = service.addMaterial(course1.id, pdfBytes, 'selective.pdf', 'application/pdf');

  // Initial process without forcing page 2
  await service.processDocument(doc.id, {
    ocr: async () => ({ text: '', language: 'vi', engine: 'mock-ocr' })
  });

  const initialPages = service.documentPages(doc.id);
  assert.equal(initialPages[1].method, 'native');

  // Reprocess forcing page 2
  const reprocessed = await service.processDocument(doc.id, {
    pages: [2],
    forceOcr: true,
    ocr: async () => ({ text: 'Extracted Diagram: Class Student -> Class Course', language: 'vi', engine: 'mock-ocr' })
  });

  assert.equal(reprocessed.status, 'ready');
  assert.equal(reprocessed.pagesOcr, 1);

  const updatedPages = service.documentPages(doc.id);
  assert.equal(updatedPages[1].pageNumber, 2);
  assert.equal(updatedPages[1].method, 'combined');
  assert.equal(updatedPages[1].status, 'ocr_applied');
  assert.equal(updatedPages[1].ocrEngine, 'mock-ocr');
});

test('B4: Strict indexReady checks complete chunk embedding count', async (t) => {
  const { dir, service, course1 } = setup(t);

  const pdfBytes = createTestPdf(['Chapter 1 content for chunk index verification.']);
  const doc = service.addMaterial(course1.id, pdfBytes, 'index-test.pdf', 'application/pdf');

  const readyDoc = await service.processDocument(doc.id);
  assert.equal(readyDoc.indexReady, true);
  assert.ok(readyDoc.chunkCount > 0);
  assert.equal(readyDoc.embeddedChunks, readyDoc.chunkCount);

  // Switch to another provider with different dimensions/model
  const otherProvider = {
    providerId: 'other-provider',
    model: 'other-model',
    dimensions: 128,
    version: 'v2',
    embed: async (texts) => texts.map(() => new Array(128).fill(0.1)),
  };

  const newService = createStudentService(dir, { aiProvider: otherProvider });
  try {
    const checkedDoc = newService.snapshot().recentMaterials.find((m) => m.id === doc.id);
    assert.equal(checkedDoc.indexReady, false);
    assert.equal(checkedDoc.embeddedChunks, 0);
  } finally {
    newService.close();
  }
});

test('B4: Interrupted processing recovery on service restart', async (t) => {
  const { dir, service, course1 } = setup(t);

  const pdfBytes = createTestPdf(['Crash recovery test content.']);
  const doc = service.addMaterial(course1.id, pdfBytes, 'crash.pdf', 'application/pdf');

  // Simulate an interrupted task by setting status = 'processing'
  service.db.prepare("UPDATE documents SET status = 'processing' WHERE id = ?").run(doc.id);
  service.close();

  // Reopen service
  const restarted = createStudentService(dir, { aiProvider: createMockAIProvider() });
  try {
    const restoredDoc = restarted.snapshot().recentMaterials.find((m) => m.id === doc.id);
    assert.equal(restoredDoc.status, 'failed');
    assert.equal(restoredDoc.processingError, 'processingInterrupted');

    // Retry succeeds
    const retried = await restarted.processDocument(doc.id);
    assert.equal(retried.status, 'ready');
    assert.equal(retried.indexReady, true);
  } finally {
    restarted.close();
  }
});

test('B4: Reprocess failure preserves previous index and chunks', async (t) => {
  const { service, course1 } = setup(t);

  const pdfBytes = createTestPdf(['Initial valid lecture text that will be preserved.']);
  const doc = service.addMaterial(course1.id, pdfBytes, 'preserve.pdf', 'application/pdf');
  await service.processDocument(doc.id);

  const chunksBefore = service.documentChunks(doc.id);
  assert.ok(chunksBefore.length > 0);

  // Force reprocess failure by throwing in OCR when all text is empty
  const emptyPdf = createTestPdf([{ text: '   ', hasImage: true }]);
  const emptyDoc = service.addMaterial(course1.id, emptyPdf, 'empty.pdf', 'application/pdf');

  await assert.rejects(
    () => service.processDocument(emptyDoc.id, {
      ocr: async () => { throw new Error('OCR completely broken'); }
    }),
    /OCR completely broken/
  );

  // Original document chunks are intact
  const chunksAfter = service.documentChunks(doc.id);
  assert.deepEqual(chunksAfter, chunksBefore);
});

test('B4: Course isolation in retrieval and document management', async (t) => {
  const { service, course1, course2 } = setup(t);

  const doc1 = service.addMaterial(course1.id, createTestPdf(['Polymorphism in OOP class hierarchy']), 'oop.pdf', 'application/pdf');
  const doc2 = service.addMaterial(course2.id, createTestPdf(['Relational Algebra and SQL queries']), 'db.pdf', 'application/pdf');

  await service.processDocument(doc1.id);
  await service.processDocument(doc2.id);

  const resultsOop = await service.search(course1.id, 'Polymorphism', 5);
  assert.ok(resultsOop.results.length > 0);
  assert.ok(resultsOop.results.every((r) => r.documentId === doc1.id));

  const resultsDb = await service.search(course2.id, 'Algebra', 5);
  assert.ok(resultsDb.results.length > 0);
  assert.ok(resultsDb.results.every((r) => r.documentId === doc2.id));
  assert.ok(resultsDb.results.every((r) => r.documentId !== doc1.id));
});

test('B4: HTTP API GET pages and POST process with selective pages', async (t) => {
  const { service, course1 } = setup(t);

  const pdfBytes = createTestPdf(['HTTP API Page 1 test', 'HTTP API Page 2 test']);
  const doc = service.addMaterial(course1.id, pdfBytes, 'http-test.pdf', 'application/pdf');
  await service.processDocument(doc.id);

  const handler = createStudentRoutes({
    service,
    authorized: () => true,
    sameOrigin: () => true,
  });

  const server = http.createServer((req, res) => void handler(req, res, new URL(req.url, 'http://localhost')));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    try { server.closeAllConnections(); } catch {}
    server.close();
  });

  const base = `http://127.0.0.1:${server.address().port}`;

  // Test GET /api/student/documents/:id/pages
  let getRes;
  try {
    getRes = await fetch(`${base}/api/student/documents/${doc.id}/pages`);
  } catch (err) {
    console.error('Fetch error:', err, 'cause:', err.cause);
    throw err;
  }
  assert.equal(getRes.status, 200);
  const getJson = await getRes.json();
  assert.ok(Array.isArray(getJson.pages));
  assert.equal(getJson.pages.length, 2);

  // Test POST /api/student/documents/:id/process with body options
  const postRes = await fetch(`${base}/api/student/documents/${doc.id}/process?sync=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pages: [2], forceOcr: true }),
  });
  assert.equal(postRes.status, 200);
  const postJson = await postRes.json();
  assert.equal(postJson.ok, true);
  assert.equal(postJson.document.status, 'ready');
});
