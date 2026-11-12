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
    const migrations = [
      new URL('./migrations/001-academic.sql', import.meta.url),
      new URL('./migrations/002-chunks.sql', import.meta.url),
      new URL('./migrations/003-chat.sql', import.meta.url),
      new URL('./migrations/004-memory.sql', import.meta.url),
      new URL('./migrations/005-chat-provider.sql', import.meta.url),
      new URL('./migrations/006-local-tutor.sql', import.meta.url),
      new URL('./migrations/007-document-coverage.sql', import.meta.url),
      new URL('./migrations/008-ollama-cloud.sql', import.meta.url),
      new URL('./migrations/009-study-assistant.sql', import.meta.url),
    ];
    // A migration on an existing database is preceded by a consistent SQLite snapshot.
    const applied = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version || 0;
    if (applied > 0 && applied < migrations.length) {
      const backupDir = path.join(dir, 'backups');
      fs.mkdirSync(backupDir, { recursive: true });
      const backup = path.join(backupDir, `before-migration-${applied + 1}-${Date.now()}-${process.pid}.sqlite`);
      db.exec("VACUUM INTO '" + backup.replaceAll("'", "''") + "'");
    }
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
