import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createStudentService } from '../../server/student/service.mjs';
import { createStudentRoutes } from '../../server/student/routes.mjs';
import { MAX_PDF_BYTES } from '../../server/student/storage.mjs';

const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n');
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'student-test-'));
  let service = createStudentService(dir);
  t.after(() => { service.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { dir, get service() { return service; }, restart() { service.close(); service = createStudentService(dir); return service; } };
}
function seed(service) {
  const semester = service.createSemester({ name: 'Semester 1', academicYear: '2026–2027' });
  const course = service.createCourse({ name: 'OOP', semesterId: semester.id });
  return { semester, course };
}

test('semester → course → PDF survives database reopen and migrations are idempotent', (t) => {
  const fixture = setup(t), { semester, course } = seed(fixture.service);
  const material = fixture.service.addMaterial(course.id, pdf, 'Bài giảng.pdf', 'application/pdf');
  assert.equal(material.status, 'uploaded');
  assert.equal(material.pageCount, null);
  assert.equal(material.storagePath, undefined);
  const service = fixture.restart();
  assert.equal(service.snapshot().semesters[0].id, semester.id);
  assert.equal(service.snapshot().courses[0].name, 'OOP');
  assert.equal(service.materials(course.id)[0].originalFilename, 'Bài giảng.pdf');
  assert.deepEqual(fs.readFileSync(service.file(material.id).path), pdf);
  assert.equal(service.snapshot().recentMaterials[0].id, material.id);
});

test('one selected semester, archive cascades without deleting documents, Today excludes archived data', (t) => {
  const { service } = setup(t), { semester, course } = seed(service);
  const material = service.addMaterial(course.id, pdf, 'Lecture.pdf', 'application/pdf');
  const second = service.createSemester({ name: 'Semester 2', academicYear: '2026–2027' });
  service.updateSemester(second.id, { action: 'activate' });
  assert.deepEqual(service.snapshot().semesters.filter((s) => s.isActive).map((s) => s.id), [second.id]);
  assert.equal(service.snapshot().recentMaterials.length, 0);
  service.updateSemester(semester.id, { action: 'archive' });
  assert.equal(service.snapshot().courses[0].status, 'archived');
  assert.equal(service.materials(course.id).length, 1);
  assert.ok(fs.existsSync(service.file(material.id).path));
  assert.throws(() => service.updateSemester(semester.id, { action: 'activate' }), /archived/);
  assert.throws(() => service.addMaterial(course.id, pdf, 'More.pdf', 'application/pdf'), /archived/);
  assert.throws(() => service.createCourse({ name: 'Math', semesterId: semester.id }), /archived/);
});

test('course deletion is restricted to empty courses; renames preserve relationships', (t) => {
  const { service } = setup(t), { semester, course } = seed(service);
  service.updateSemester(semester.id, { action: 'rename', name: 'HK1' });
  service.updateCourse(course.id, { action: 'rename', name: 'Lập trình OOP' });
  service.addMaterial(course.id, pdf, 'Lesson.pdf', 'application/pdf');
  assert.throws(() => service.deleteCourse(course.id), /courseNotEmpty/);
  assert.equal(service.snapshot().courses[0].semesterId, semester.id);
  assert.equal(service.snapshot().courses[0].name, 'Lập trình OOP');
  const empty = service.createCourse({ name: 'Empty', semesterId: semester.id });
  service.deleteCourse(empty.id);
  assert.throws(() => service.materials(empty.id), /notFound/);
});

test('rejects invalid domain values, missing parents, bad PDF content and oversize uploads', (t) => {
  const { service } = setup(t), { course } = seed(service);
  for (const input of [{ name: '', academicYear: '2026' }, { name: 'A', academicYear: '2026', startDate: '2026-02-30' }, { name: 'A', academicYear: '2026', startDate: '2026-11-02', endDate: '2026-01-01' }]) assert.throws(() => service.createSemester(input));
  assert.throws(() => service.createCourse({ name: 'X', semesterId: 'missing' }), /notFound/);
  assert.throws(() => service.addMaterial(course.id, Buffer.from('<script>bad</script>'), 'bad.pdf', 'application/pdf'), /invalidFile/);
  assert.throws(() => service.addMaterial(course.id, pdf, 'bad.html', 'application/pdf'), /invalidFile/);
  assert.throws(() => service.addMaterial(course.id, pdf, 'bad.pdf', 'text/html'), /invalidFile/);
  assert.throws(() => service.addMaterial(course.id, Buffer.alloc(MAX_PDF_BYTES + 1), 'large.pdf', 'application/pdf'), /fileTooLarge/);
  assert.equal(service.materials(course.id).length, 0);
});

test('untrusted names are display metadata, never file paths', (t) => {
  const { service, dir } = setup(t), { course } = seed(service);
  const file = service.addMaterial(course.id, pdf, '..\\..\\secret.pdf', 'application/pdf');
  assert.equal(file.originalFilename, 'secret.pdf');
  const relative = path.relative(dir, service.file(file.id).path);
  assert.equal(relative, path.join('documents', file.id, 'source.pdf'));
  assert.throws(() => service.file('../../outside'), /notFound/);
});

test('HTTP API validates auth, origin, body, upload limits, scoped metadata and download', async (t) => {
  const { service } = setup(t), { course } = seed(service);
  const handler = createStudentRoutes({ service, authorized: (req) => req.headers['x-test-auth'] === 'yes', sameOrigin: (req) => req.headers.origin === `http://${req.headers.host}` });
  const server = http.createServer((req, res) => void handler(req, res, new URL(req.url, 'http://localhost')));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { 'x-test-auth': 'yes', Origin: base, 'Content-Type': 'application/json' };
  assert.equal((await fetch(`${base}/api/student/snapshot`)).status, 401);
  assert.equal((await fetch(`${base}/api/student/semesters`, { method: 'POST', headers: { ...headers, Origin: 'https://foreign.example' }, body: '{}' })).status, 403);
  for (const body of ['null', '[]', '{']) assert.equal((await fetch(`${base}/api/student/semesters`, { method: 'POST', headers, body })).status, 400);
  const uploadUrl = `${base}/api/student/courses/${course.id}/materials?filename=Example.pdf`;
  assert.equal((await fetch(uploadUrl, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/pdf' }, body: Buffer.alloc(MAX_PDF_BYTES + 1) })).status, 413);
  const uploaded = await fetch(uploadUrl, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/pdf' }, body: pdf });
  assert.equal(uploaded.status, 201);
  const material = await uploaded.json();
  const download = await fetch(`${base}/api/student/documents/${material.id}/file`, { headers });
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('x-content-type-options'), 'nosniff');
  assert.match(download.headers.get('content-disposition'), /^attachment/);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), pdf);
  const other = service.createCourse({ name: 'Database', semesterId: service.snapshot().semesters[0].id });
  const otherMaterials = await fetch(`${base}/api/student/courses/${other.id}/materials`, { headers });
  assert.deepEqual(await otherMaterials.json(), []);
});
