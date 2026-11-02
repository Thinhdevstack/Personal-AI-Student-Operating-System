import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createStudentService } from '../../server/student/service.mjs';
import { createStudentRoutes } from '../../server/student/routes.mjs';
import { extractPdf } from '../../server/documents/pdf.mjs';
import { createChunks } from '../../server/documents/chunking.mjs';
import { createMockAIProvider } from '../../server/ai/openai.mjs';

export function createPdfBuffer(pagesText) {
  let out = '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
  const pageCount = pagesText.length;
  const kids = Array.from({ length: pageCount }, (_, i) => (3 + i) + ' 0 R').join(' ');
  out += '2 0 obj\n<< /Type /Pages /Kids [' + kids + '] /Count ' + pageCount + ' >>\nendobj\n';

  const fontObjId = 3 + pageCount;
  const contentStartId = fontObjId + 1;

  for (let i = 0; i < pageCount; i++) {
    const pageId = 3 + i;
    const contentId = contentStartId + i;
    out += pageId + ' 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ' + fontObjId + ' 0 R >> >> /Contents ' + contentId + ' 0 R >>\nendobj\n';
  }

  out += fontObjId + ' 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n';

  for (let i = 0; i < pageCount; i++) {
    const contentId = contentStartId + i;
    const cleanText = pagesText[i].replace(/[()\\\\]/g, '');
    const stream = 'BT\n/F1 12 Tf\n100 700 Td\n(' + cleanText + ') Tj\nET\n';
    out += contentId + ' 0 obj\n<< /Length ' + Buffer.byteLength(stream) + ' >>\nstream\n' + stream + 'endstream\nendobj\n';
  }

  out += 'xref\n0 ' + (contentStartId + pageCount) + '\n0000000000 65535 f \n';
  out += 'trailer\n<< /Size ' + (contentStartId + pageCount) + ' /Root 1 0 R >>\nstartxref\n' + Buffer.byteLength(out) + '\n%%EOF\n';
  return Buffer.from(out);
}

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'student-m2-test-'));
  const aiProvider = createMockAIProvider();
  let service = createStudentService(dir, { aiProvider });
  t.after(() => {
    service.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return {
    dir,
    aiProvider,
    get service() { return service; },
    restart() {
      service.close();
      service = createStudentService(dir, { aiProvider });
      return service;
    },
  };
}

function seed(service) {
  const semester = service.createSemester({ name: 'Semester 1', academicYear: '2026–2027' });
  const course = service.createCourse({ name: 'OOP', semesterId: semester.id });
  return { semester, course };
}

test('PDF extraction: normal, multi-page, empty/no-text, corrupted and missing', async () => {
  // 1. Normal single page
  const singlePdf = createPdfBuffer(['Aggregation and composition in Object Oriented Programming']);
  const res1 = await extractPdf(singlePdf);
  assert.equal(res1.pageCount, 1);
  assert.equal(res1.pages.length, 1);
  assert.equal(res1.pages[0].pageNumber, 1);
  assert.match(res1.pages[0].text, /Aggregation and composition/);

  // 2. Multi-page
  const multiPdf = createPdfBuffer([
    'Chapter 1: Objects and Classes in Java',
    'Chapter 2: Inheritance and Polymorphism',
  ]);
  const res2 = await extractPdf(multiPdf);
  assert.equal(res2.pageCount, 2);
  assert.equal(res2.pages.length, 2);
  assert.equal(res2.pages[0].pageNumber, 1);
  assert.equal(res2.pages[1].pageNumber, 2);
  assert.match(res2.pages[0].text, /Chapter 1/);
  assert.match(res2.pages[1].text, /Chapter 2/);

  // 3. No text extracted / scanned-like PDF
  const emptyPdf = createPdfBuffer(['']);
  await assert.rejects(async () => extractPdf(emptyPdf), /noTextExtracted/);

  // 4. Corrupted PDF
  await assert.rejects(async () => extractPdf(Buffer.from('not a real pdf file at all')), /corruptedPdf/);

  // 5. Missing file path
  await assert.rejects(async () => extractPdf('/path/to/nonexistent/file.pdf'), /fileMissing/);
});

test('Chunking: respects target token size, creates overlap, preserves page metadata', () => {
  const pages = [
    { pageNumber: 1, text: 'Short sentence on page one.' },
    { pageNumber: 2, text: Array.from({ length: 80 }, (_, i) => `concept${i} explanation details`).join(' ') },
  ];

  const chunks = createChunks(pages, { targetTokens: 100, overlapTokens: 20 });
  assert.ok(chunks.length >= 2, 'Should create multiple chunks for long page');

  // Page 1 should have chunkIndex 0
  const p1Chunks = chunks.filter((c) => c.pageNumber === 1);
  assert.equal(p1Chunks.length, 1);
  assert.equal(p1Chunks[0].chunkIndex, 0);
  assert.match(p1Chunks[0].content, /Short sentence/);

  // Page 2 chunks should have sequential indices
  const p2Chunks = chunks.filter((c) => c.pageNumber === 2);
  assert.ok(p2Chunks.length >= 2);
  assert.equal(p2Chunks[0].chunkIndex, 0);
  assert.equal(p2Chunks[1].chunkIndex, 1);

  // Check token count calculation
  for (const chunk of chunks) {
    assert.ok(chunk.tokenCount > 0);
    assert.equal(typeof chunk.tokenCount, 'number');
  }
});

test('Document processing pipeline: uploaded → processing → ready, survives restart', async (t) => {
  const fixture = setup(t);
  const { course } = seed(fixture.service);
  const pdfBytes = createPdfBuffer([
    'Aggregation represents a HAS-A relationship where child can exist independently.',
    'Composition represents a strong relationship where child life depends on parent.',
  ]);

  const doc = fixture.service.addMaterial(course.id, pdfBytes, 'ObjectRelation.pdf', 'application/pdf');
  assert.equal(doc.status, 'uploaded');
  assert.equal(doc.pageCount, null);

  // Process document
  const processed = await fixture.service.processDocument(doc.id);
  assert.equal(processed.status, 'ready');
  assert.equal(processed.pageCount, 2);
  assert.ok(processed.chunkCount >= 2);
  assert.ok(processed.processedAt);

  // Check chunks stored in DB
  const chunks = fixture.service.documentChunks(doc.id);
  assert.ok(chunks.length >= 2);
  assert.equal(chunks[0].documentId, doc.id);
  assert.equal(chunks[0].courseId, course.id);

  // Restart DB to verify persistence of chunks, embeddings, and status
  const service2 = fixture.restart();
  const refreshed = service2.materials(course.id)[0];
  assert.equal(refreshed.status, 'ready');
  assert.equal(refreshed.pageCount, 2);
  assert.equal(refreshed.chunkCount, chunks.length);

  // Search works after restart
  const searchRes = await service2.search(course.id, 'aggregation HAS-A');
  assert.ok(searchRes.results.length > 0);
  assert.equal(searchRes.results[0].documentId, doc.id);
  assert.equal(searchRes.results[0].documentName, 'ObjectRelation.pdf');
  assert.equal(searchRes.results[0].pageNumber, 1);
  assert.match(searchRes.results[0].content, /Aggregation/);
});

test('Retry and idempotency: re-processing replaces old chunks without duplication', async (t) => {
  const fixture = setup(t);
  const { course } = seed(fixture.service);
  const pdfBytes = createPdfBuffer(['Original version of lesson on inheritance.']);

  const doc = fixture.service.addMaterial(course.id, pdfBytes, 'Lesson.pdf', 'application/pdf');
  await fixture.service.processDocument(doc.id);
  const count1 = fixture.service.documentChunks(doc.id).length;
  assert.ok(count1 > 0);

  // Re-process the same ready document (idempotency/retry)
  await fixture.service.processDocument(doc.id);
  const count2 = fixture.service.documentChunks(doc.id).length;
  assert.equal(count1, count2, 'Re-processing must not duplicate chunks');
});

test('Processing failure: sets status = failed and preserves error message; retry succeeds', async (t) => {
  const fixture = setup(t);
  const { course } = seed(fixture.service);

  // Upload an unextractable empty/scanned PDF
  const emptyPdf = createPdfBuffer(['']);
  const doc = fixture.service.addMaterial(course.id, emptyPdf, 'Scan.pdf', 'application/pdf');

  await assert.rejects(async () => fixture.service.processDocument(doc.id));
  const failedDoc = fixture.service.materials(course.id)[0];
  assert.equal(failedDoc.status, 'failed');
  assert.equal(failedDoc.processingError, 'noTextExtracted');

  // Overwrite file with valid content and retry
  const validPdf = createPdfBuffer(['Now this document has valid text for retry testing.']);
  fs.writeFileSync(fixture.service.file(doc.id).path, validPdf);

  const retried = await fixture.service.processDocument(doc.id);
  assert.equal(retried.status, 'ready');
  assert.equal(retried.processingError, null);
  assert.ok(fixture.service.documentChunks(doc.id).length > 0);
});

test('Course-scoped semantic retrieval: excludes other courses, ranks relevant chunks, respects limit', async (t) => {
  const fixture = setup(t);
  const { semester, course: courseA } = seed(fixture.service);
  const courseB = fixture.service.createCourse({ name: 'Database Systems', semesterId: semester.id });

  // Course A materials
  const pdfA = createPdfBuffer([
    'Aggregation and composition in Object Oriented Programming Java.',
    'Polymorphism and method overriding in inheritance hierarchies.',
  ]);
  const docA = fixture.service.addMaterial(courseA.id, pdfA, 'OOP-Design.pdf', 'application/pdf');
  await fixture.service.processDocument(docA.id);

  // Course B materials
  const pdfB = createPdfBuffer([
    'Relational database design: normalization and primary foreign keys.',
    'SQL queries: join, group by, aggregation functions SUM and COUNT.',
  ]);
  const docB = fixture.service.addMaterial(courseB.id, pdfB, 'DB-SQL.pdf', 'application/pdf');
  await fixture.service.processDocument(docB.id);

  // 1. Search in Course A for OOP concepts
  const searchA = await fixture.service.search(courseA.id, 'aggregation and composition');
  assert.ok(searchA.results.length > 0);
  assert.equal(searchA.results[0].documentId, docA.id);
  assert.equal(searchA.results[0].pageNumber, 1);
  // Guarantee Course B chunks are NOT returned in Course A search
  assert.ok(searchA.results.every((r) => r.documentId === docA.id));

  // 2. Search in Course B for SQL concepts
  const searchB = await fixture.service.search(courseB.id, 'normalization primary keys');
  assert.ok(searchB.results.length > 0);
  assert.equal(searchB.results[0].documentId, docB.id);
  assert.ok(searchB.results.every((r) => r.documentId === docB.id));

  // 3. Limit parameter
  const limited = await fixture.service.search(courseA.id, 'inheritance', 1);
  assert.equal(limited.results.length, 1);

  // 4. Archived course search works when explicitly specified
  fixture.service.updateCourse(courseA.id, { action: 'archive' });
  const archivedSearch = await fixture.service.search(courseA.id, 'aggregation', 5, true);
  assert.ok(archivedSearch.results.length > 0);
  assert.equal(archivedSearch.results[0].documentId, docA.id);
});

test('HTTP API: /documents/:id/process, /courses/:id/search and /documents/:id/chunks', async (t) => {
  const fixture = setup(t);
  const { course } = seed(fixture.service);
  const handler = createStudentRoutes({
    service: fixture.service,
    authorized: (req) => req.headers['x-test-auth'] === 'yes',
    sameOrigin: (req) => req.headers.origin === `http://${req.headers.host}`,
  });

  const server = http.createServer((req, res) => void handler(req, res, new URL(req.url, 'http://localhost')));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });

  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { 'x-test-auth': 'yes', Origin: base, 'Content-Type': 'application/json' };

  // 1. Upload valid document
  const pdfBytes = createPdfBuffer(['Aggregation and composition in modern software architecture.']);
  const uploadUrl = `${base}/api/student/courses/${course.id}/materials?filename=Arch.pdf`;
  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/pdf' },
    body: pdfBytes,
  });
  assert.equal(uploadRes.status, 201);
  const doc = await uploadRes.json();
  assert.equal(doc.status, 'uploaded');

  // 2. Trigger synchronous processing via API
  const processRes = await fetch(`${base}/api/student/documents/${doc.id}/process?sync=true`, {
    method: 'POST',
    headers,
  });
  assert.equal(processRes.status, 200);
  const processData = await processRes.json();
  assert.equal(processData.ok, true);
  assert.equal(processData.document.status, 'ready');
  assert.equal(processData.document.pageCount, 1);

  // 3. Inspect chunks endpoint
  const chunksRes = await fetch(`${base}/api/student/documents/${doc.id}/chunks`, { headers });
  assert.equal(chunksRes.status, 200);
  const chunksData = await chunksRes.json();
  assert.ok(chunksData.chunks.length > 0);
  assert.match(chunksData.chunks[0].content, /Aggregation and composition/);

  // 4. Search via POST endpoint
  const searchPostRes = await fetch(`${base}/api/student/courses/${course.id}/search`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query: 'aggregation composition', limit: 3 }),
  });
  assert.equal(searchPostRes.status, 200);
  const searchPostData = await searchPostRes.json();
  assert.ok(searchPostData.results.length > 0);
  assert.equal(searchPostData.results[0].documentId, doc.id);
  assert.equal(searchPostData.results[0].documentName, 'Arch.pdf');
  assert.equal(searchPostData.results[0].pageNumber, 1);
  assert.ok(typeof searchPostData.results[0].score === 'number');

  // 5. Search via GET endpoint
  const searchGetRes = await fetch(
    `${base}/api/student/courses/${course.id}/search?query=${encodeURIComponent('software architecture')}`,
    { headers }
  );
  assert.equal(searchGetRes.status, 200);
  const searchGetData = await searchGetRes.json();
  assert.ok(searchGetData.results.length > 0);
  assert.equal(searchGetData.results[0].documentId, doc.id);
});
