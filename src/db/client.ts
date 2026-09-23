import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { env } from '../config/env';
import { SCHEMA_SQL } from './schema';

let dbInstance: Database | null = null;

function applyMigrations(db: Database): void {
  const tableCheck = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='reminders'")
    .get();

  if (tableCheck) {
    const columns = db.prepare('PRAGMA table_info(reminders)').all() as Array<{ name: string }>;
    const columnNames = new Set(columns.map((c) => c.name));

    if (!columnNames.has('is_notified')) {
      db.run('ALTER TABLE reminders ADD COLUMN is_notified INTEGER NOT NULL DEFAULT 0;');
      db.run('DROP INDEX IF EXISTS idx_reminders_due_at_status;');
      db.run(
        'CREATE INDEX IF NOT EXISTS idx_reminders_due_at_status ON reminders(due_at, status, is_notified);',
      );
    }
  }
}

export function getDatabase(): Database {
  if (dbInstance) {
    return dbInstance;
  }

  const dbDir = dirname(env.DB_PATH);
  mkdirSync(dbDir, { recursive: true });

  const db = new Database(env.DB_PATH, { create: true });

  db.run('PRAGMA journal_mode = WAL;');
  db.run('PRAGMA synchronous = NORMAL;');
  db.run('PRAGMA foreign_keys = ON;');

  db.run(SCHEMA_SQL);
  applyMigrations(db);

  dbInstance = db;
  return dbInstance;
}
