// Real inference check in a disposable database. Does not seed or modify the user's academic data.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createOllama } from '../server/ai/ollama.mjs';
import { createProviderRegistry } from '../server/ai/providers.mjs';
import { createStudentService } from '../server/student/service.mjs';
import { demoPdf } from '../server/student/demo-pdf.mjs';

const client = createOllama();
const status = await client.status();
if (!status.connected || !status.chatReady || !status.embeddingReady) throw new Error('Ollama or required models unavailable: ' + JSON.stringify(status));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'student-real-ollama-'));
const registry = createProviderRegistry({ embedding: client.embedding, entries: [{ id: 'ollama', configured: true, provider: client.chat }], defaultProvider: 'ollama' });
const service = createStudentService(dir, { aiRegistry: registry });
const report = { realOllama: true, chatModel: status.chatModel, embeddingModel: status.embeddingModel, cases: [] };
try {
  const semester = service.createSemester({ name: 'Isolated real inference check', academicYear: '2026' });
  const oop = service.createCourse({ semesterId: semester.id, name: 'Lap trinh huong doi tuong', code: 'OOP' });
  const database = service.createCourse({ semesterId: semester.id, name: 'Co so du lieu', code: 'DB' });
  for (const [course, name, text] of [
    [oop, 'OOP.pdf', 'Aggregation: a whole references independent parts. Parts may outlive the whole. Example: a Department references Teachers. Composition: the whole owns the lifetime of its parts. A part belongs to one whole. Example: a House owns its Rooms.'],
    [database, 'Database.pdf', 'A primary key uniquely identifies a row and cannot be null. A foreign key references a key in another table and enforces referential integrity. Example: Students(id PRIMARY KEY); Enrollments(student_id REFERENCES Students(id)).'],
  ]) {
    const doc = service.addMaterial(course.id, demoPdf([text]), name, 'application/pdf');
    await service.processDocument(doc.id);
    const extracted = service.documentChunks(doc.id).map((chunk) => chunk.content).join(' ').replace(/\s+/g, ' ').trim();
    if (!extracted.includes(text)) throw new Error('Sample PDF text was clipped or changed: ' + name);
  }
  for (const [course, mode, message] of [
    [oop, 'materials', 'Giải thích aggregation và composition theo tài liệu, kèm ví dụ trong file.'],
    [database, 'expanded', 'Giải thích khóa chính và khóa ngoại theo tài liệu, bổ sung ví dụ SQL dễ hiểu.'],
    [oop, 'materials', 'Java record khác class thông thường như thế nào? Tài liệu có giải thích không?'],
    [oop, 'expanded', 'Java record khác class thông thường như thế nào? Phân biệt kiến thức bổ sung với tài liệu.'],
  ]) {
    const started = Date.now();
    const history = await service.sendChat({ courseId: course.id, mode, message, provider: 'ollama', language: 'vi', requestId: randomUUID() });
    const turn = history.turns.at(-1), answer = turn.messages.find((m) => m.role === 'assistant');
    if (turn.isMock || turn.provider !== 'ollama' || turn.status !== 'completed') throw new Error('Real inference check failed');
    if (answer.sources.some((source) => !service.materials(course.id).some((doc) => doc.id === source.documentId))) throw new Error('Cross-course citation');
    report.cases.push({ course: course.code, mode, message, durationMs: Date.now() - started, model: turn.model, basis: answer.basis, sources: answer.sources.map((s) => ({ name: s.documentName, page: s.pageNumber })), answer: answer.content });
    console.log(JSON.stringify(report.cases.at(-1)));
  }
  if (process.env.LOCAL_AI_REPORT) fs.writeFileSync(process.env.LOCAL_AI_REPORT, JSON.stringify(report, null, 2));
} finally {
  service.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
