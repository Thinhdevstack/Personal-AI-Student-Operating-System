import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export function openStudentDatabase(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const db = new Database(path.join(dir, 'student.sqlite'));
  try {
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');
    db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, appliedAt TEXT NOT NULL)');
    const migrations = [new URL('./migrations/001-academic.sql', import.meta.url)];
    db.transaction(() => {
      for (const [index, file] of migrations.entries()) {
        const version = index + 1;
        if (db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(version)) continue;
        db.exec(fs.readFileSync(file, 'utf8'));
        db.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(version, new Date().toISOString());
      }
    })();
    return db;
  } catch (error) { db.close(); throw error; }
}
