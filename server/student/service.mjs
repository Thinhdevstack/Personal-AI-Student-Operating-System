import { randomUUID } from 'node:crypto';
import { openStudentDatabase } from './database.mjs';
import { documentStorage, StudentError, validatePdf } from './storage.mjs';

function text(value, max, required = false) {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) throw new StudentError('invalidInput');
  return value.trim();
}
function date(value) {
  if (value === undefined || value === '' || value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new StudentError('invalidDate');
  return value;
}
const now = () => new Date().toISOString();
const publicDocument = ({ storagePath, ...document }) => document;

export function createStudentService(dir) {
  const db = openStudentDatabase(dir), storage = documentStorage(dir);
  function semester(id) {
    const row = db.prepare('SELECT * FROM semesters WHERE id = ?').get(id);
    if (!row) throw new StudentError('notFound', 404);
    return row;
  }
  function course(id) {
    const row = db.prepare('SELECT * FROM courses WHERE id = ?').get(id);
    if (!row) throw new StudentError('notFound', 404);
    return row;
  }
  function writableCourse(id) {
    const row = course(id);
    if (row.status === 'archived' || semester(row.semesterId).status === 'archived') throw new StudentError('archived', 409);
    return row;
  }
  function document(id) {
    const row = db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
    if (!row) throw new StudentError('notFound', 404);
    return row;
  }
  return {
    close: () => db.close(),
    snapshot() {
      return {
        semesters: db.prepare('SELECT * FROM semesters ORDER BY createdAt DESC, id').all(),
        courses: db.prepare('SELECT * FROM courses ORDER BY name, id').all(),
        recentMaterials: db.prepare("SELECT d.* FROM documents d JOIN courses c ON c.id=d.courseId JOIN semesters s ON s.id=c.semesterId WHERE c.status='active' AND s.isActive=1 ORDER BY uploadedAt DESC LIMIT 8").all().map(publicDocument),
      };
    },
    createSemester(input) {
      const name = text(input.name, 120, true), academicYear = text(input.academicYear, 60, true);
      const start = date(input.startDate), end = date(input.endDate);
      if (start && end && end < start) throw new StudentError('invalidDate');
      const id = randomUUID(), time = now();
      db.transaction(() => {
        const active = db.prepare('SELECT id FROM semesters WHERE isActive=1').get() ? 0 : 1;
        db.prepare('INSERT INTO semesters VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, name, academicYear, start, end, 'active', active, time, time);
      })();
      return semester(id);
    },
    updateSemester(id, input) {
      semester(id);
      if (!['rename', 'activate', 'archive'].includes(input.action)) throw new StudentError('invalidInput');
      db.transaction(() => {
        const time = now();
        if (input.action === 'rename') db.prepare('UPDATE semesters SET name=?, updatedAt=? WHERE id=?').run(text(input.name, 120, true), time, id);
        if (input.action === 'activate') {
          if (semester(id).status === 'archived') throw new StudentError('archived', 409);
          db.prepare('UPDATE semesters SET isActive=0, updatedAt=? WHERE isActive=1').run(time);
          db.prepare('UPDATE semesters SET isActive=1, updatedAt=? WHERE id=?').run(time, id);
        }
        if (input.action === 'archive') {
          db.prepare("UPDATE semesters SET status='archived', isActive=0, updatedAt=? WHERE id=?").run(time, id);
          db.prepare("UPDATE courses SET status='archived', updatedAt=? WHERE semesterId=?").run(time, id);
        }
      })();
      return semester(id);
    },
    createCourse(input) {
      const semesterId = text(input.semesterId, 36, true);
      if (semester(semesterId).status === 'archived') throw new StudentError('archived', 409);
      const id = randomUUID(), time = now();
      db.prepare('INSERT INTO courses VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, semesterId, text(input.name, 120, true), text(input.code, 40), text(input.description, 2000), 'active', time, time);
      return course(id);
    },
    updateCourse(id, input) {
      course(id);
      if (input.action === 'rename') db.prepare('UPDATE courses SET name=?, updatedAt=? WHERE id=?').run(text(input.name, 120, true), now(), id);
      else if (input.action === 'archive') db.prepare("UPDATE courses SET status='archived', updatedAt=? WHERE id=?").run(now(), id);
      else throw new StudentError('invalidInput');
      return course(id);
    },
    deleteCourse(id) {
      db.transaction(() => {
        course(id);
        if (db.prepare('SELECT id FROM documents WHERE courseId=? LIMIT 1').get(id)) throw new StudentError('courseNotEmpty', 409);
        db.prepare('DELETE FROM courses WHERE id=?').run(id);
      })();
    },
    materials(id) { course(id); return db.prepare('SELECT * FROM documents WHERE courseId=? ORDER BY uploadedAt DESC, id').all(id).map(publicDocument); },
    addMaterial(courseId, bytes, filename, mimeType) {
      // Recheck after the upload completes: the semester may have been archived while bytes were arriving.
      writableCourse(courseId);
      const name = validatePdf(bytes, filename, mimeType), id = randomUUID();
      const storagePath = storage.write(id, bytes);
      try {
        db.prepare('INSERT INTO documents VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, courseId, 'source.pdf', name, 'application/pdf', storagePath, bytes.length, null, 'uploaded', now());
      } catch (error) { storage.remove(id); throw error; }
      return publicDocument(document(id));
    },
    file(id) { return { document: publicDocument(document(id)), path: storage.location(id) }; },
    writableCourse,
  };
}
