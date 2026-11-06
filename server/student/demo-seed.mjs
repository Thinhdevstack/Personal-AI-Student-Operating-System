import { randomUUID } from 'node:crypto';
import { demoPdf } from './demo-pdf.mjs';
import { StudentError } from './storage.mjs';

export function createStudentDemoSeed(service) {
  if (!service.aiSettings().studentDemo || !service.aiSettings().isMock) throw new StudentError('forbidden', 403);
  const db = service.db;
  db.exec('CREATE TABLE IF NOT EXISTS student_demo_seed (key TEXT PRIMARY KEY, entityId TEXT NOT NULL)');
  const get = db.prepare('SELECT entityId FROM student_demo_seed WHERE key=?');
  const save = db.prepare('INSERT OR REPLACE INTO student_demo_seed VALUES (?, ?)');
  function ensure(key, table, create) {
    const id = get.get(key)?.entityId;
    if (id && db.prepare(`SELECT id FROM ${table} WHERE id=?`).get(id)) return id;
    const row = create(); save.run(key, row.id); return row.id;
  }
  let pending = null;
  async function seed() {
    const documents = db.transaction(() => {
      const semesterId = ensure('semester', 'semesters', () => service.createSemester({ name: 'Học kỳ mô phỏng', academicYear: '2026–2027' }));
      const examples = [
        { key: 'oop', name: 'Lập trình hướng đối tượng', code: 'DEMO-OOP', lines: ['OOP: aggregation and composition', 'Aggregation: an object can exist without its container.', 'Example: a student can exist independently of a study group.', 'Composition: a part belongs to the lifetime of the whole.', 'Example: an order line belongs to its order.'], memory: 'Tôi đang ôn aggregation và composition; hãy dùng ví dụ dễ hiểu.' },
        { key: 'db', name: 'Cơ sở dữ liệu', code: 'DEMO-DB', lines: ['Database basics: primary keys and foreign keys', 'A primary key uniquely identifies a row in a table.', 'A foreign key references a key in another table.', 'Example: enrollments.course_id references courses.id.', 'A transaction groups changes that succeed or fail together.'], memory: 'Tôi muốn ôn primary key và foreign key với ví dụ đăng ký môn học.' },
      ];
      ensure('global-memory', 'memories', () => service.createMemory({ scope: 'global', content: 'Giải thích bằng tiếng Việt, từng bước và kèm ví dụ đơn giản.', requestId: randomUUID() }));
      return examples.map((example) => {
        const courseId = ensure(example.key, 'courses', () => service.createCourse({ semesterId, name: example.name, code: example.code, description: 'Môn mẫu để thử Tutor. Câu trả lời được mô phỏng, không dùng AI thật.' }));
        ensure(example.key + '-memory', 'memories', () => service.createMemory({ scope: 'course', courseId, content: example.memory, requestId: randomUUID() }));
        return ensure(example.key + '-pdf', 'documents', () => service.addMaterial(courseId, demoPdf(example.lines), example.code + '.pdf', 'application/pdf'));
      });
    }).immediate();
    for (const id of documents) {
      const row = db.prepare('SELECT status, courseId FROM documents WHERE id=?').get(id);
      const course = db.prepare('SELECT c.status, s.status AS semesterStatus FROM courses c JOIN semesters s ON c.semesterId=s.id WHERE c.id=?').get(row.courseId);
      if (row.status !== 'ready' && course.status === 'active' && course.semesterStatus === 'active') await service.processDocument(id);
    }
    return service.snapshot();
  }
  return () => (pending ??= seed().finally(() => { pending = null; }));
}
