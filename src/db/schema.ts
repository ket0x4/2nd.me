export type MemoryModality = 'text' | 'voice' | 'image' | 'document';

export interface MemoryRecord {
  id: string;
  title: string;
  content: string;
  summary: string;
  tags: string[];
  modality: MemoryModality;
  filePath?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface MemoryRow {
  id: string;
  title: string;
  content: string;
  summary: string;
  tags: string;
  modality: string;
  file_path: string | null;
  embedding: Uint8Array | null;
  created_at: number;
  updated_at: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface ScoredMemory extends MemoryRecord {
  score: number;
  ftsRank?: number;
  vectorRank?: number;
}

export type ReminderStatus = 'pending' | 'completed' | 'cancelled';

export interface ReminderRecord {
  id: string;
  memoryId?: string | null;
  text: string;
  dueAt: number;
  status: ReminderStatus;
  isNotified: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ReminderRow {
  id: string;
  memory_id: string | null;
  text: string;
  due_at: number;
  status: string;
  is_notified: number;
  created_at: number;
  updated_at: number;
}

export const SCHEMA_SQL = `
-- Main memories table
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  summary TEXT NOT NULL,
  tags TEXT NOT NULL,
  modality TEXT NOT NULL,
  file_path TEXT,
  embedding BLOB,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Full-text search index (FTS5)
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  id UNINDEXED,
  title,
  content,
  summary,
  tags,
  tokenize='porter unicode61'
);

-- Automatic FTS5 sync triggers
CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(id, title, content, summary, tags)
  VALUES (new.id, new.title, new.content, new.summary, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  DELETE FROM memories_fts WHERE id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
  DELETE FROM memories_fts WHERE id = old.id;
  INSERT INTO memories_fts(id, title, content, summary, tags)
  VALUES (new.id, new.title, new.content, new.summary, new.tags);
END;

-- Conversational sliding window history
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_timestamp ON chat_messages(timestamp);
CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at DESC);

-- Reminders table
CREATE TABLE IF NOT EXISTS reminders (
  id TEXT PRIMARY KEY,
  memory_id TEXT,
  text TEXT NOT NULL,
  due_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  is_notified INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(memory_id) REFERENCES memories(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_reminders_due_at_status ON reminders(due_at, status, is_notified);
`;
