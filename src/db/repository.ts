import type { Database } from 'bun:sqlite';
import { getDatabase } from './client';
import type {
  ChatMessage,
  MemoryModality,
  MemoryRecord,
  MemoryRow,
  ReminderRecord,
  ReminderRow,
  ReminderStatus,
  ScoredMemory,
} from './schema';
import { blobToVector, cosineSimilarity, vectorToBlob } from './vector';

function rowToRecord(row: MemoryRow): MemoryRecord {
  let tags: string[] = [];
  try {
    tags = JSON.parse(row.tags);
  } catch {
    tags = [];
  }

  return {
    id: row.id,
    title: row.title,
    content: row.content,
    summary: row.summary,
    tags,
    modality: row.modality as MemoryModality,
    filePath: row.file_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToReminder(row: ReminderRow): ReminderRecord {
  return {
    id: row.id,
    memoryId: row.memory_id,
    text: row.text,
    dueAt: row.due_at,
    status: row.status as ReminderStatus,
    isNotified: Boolean(row.is_notified),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function sanitizeFtsQuery(query: string): string {
  const cleaned = query.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim();
  const terms = cleaned.split(/\s+/).filter((t) => t.length > 0);
  if (terms.length === 0) {
    return '';
  }
  return terms.map((term) => `"${term}"*`).join(' OR ');
}

class MemoryRepository {
  private db: Database;

  constructor(db?: Database) {
    this.db = db ?? getDatabase();
  }

  public createMemory(data: {
    id?: string;
    title: string;
    content: string;
    summary: string;
    tags: string[];
    modality: MemoryModality;
    filePath?: string | null;
    embedding?: number[] | Float32Array | null;
  }): MemoryRecord {
    const id = data.id || crypto.randomUUID();
    const now = Date.now();
    const tagsJson = JSON.stringify(data.tags);
    const embeddingBlob = data.embedding ? vectorToBlob(data.embedding) : null;

    const stmt = this.db.prepare(`
      INSERT INTO memories (id, title, content, summary, tags, modality, file_path, embedding, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      data.title,
      data.content,
      data.summary,
      tagsJson,
      data.modality,
      data.filePath ?? null,
      embeddingBlob,
      now,
      now,
    );

    return {
      id,
      title: data.title,
      content: data.content,
      summary: data.summary,
      tags: data.tags,
      modality: data.modality,
      filePath: data.filePath ?? null,
      createdAt: now,
      updatedAt: now,
    };
  }

  public getMemoryById(id: string): MemoryRecord | null {
    const stmt = this.db.prepare('SELECT * FROM memories WHERE id = ?');
    const row = stmt.get(id) as MemoryRow | null;
    return row ? rowToRecord(row) : null;
  }

  public updateMemory(
    id: string,
    updates: Partial<{
      title: string;
      content: string;
      summary: string;
      tags: string[];
      embedding: number[] | Float32Array | null;
    }>,
  ): MemoryRecord | null {
    const existing = this.getMemoryById(id);
    if (!existing) {
      return null;
    }

    const title = updates.title ?? existing.title;
    const content = updates.content ?? existing.content;
    const summary = updates.summary ?? existing.summary;
    const tags = updates.tags ?? existing.tags;
    const tagsJson = JSON.stringify(tags);
    const now = Date.now();

    if (updates.embedding !== undefined) {
      const embeddingBlob = updates.embedding ? vectorToBlob(updates.embedding) : null;
      const stmt = this.db.prepare(`
        UPDATE memories
        SET title = ?, content = ?, summary = ?, tags = ?, embedding = ?, updated_at = ?
        WHERE id = ?
      `);
      stmt.run(title, content, summary, tagsJson, embeddingBlob, now, id);
    } else {
      const stmt = this.db.prepare(`
        UPDATE memories
        SET title = ?, content = ?, summary = ?, tags = ?, updated_at = ?
        WHERE id = ?
      `);
      stmt.run(title, content, summary, tagsJson, now, id);
    }

    return this.getMemoryById(id);
  }

  public deleteMemory(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM memories WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  public listRecentMemories(limit = 10): MemoryRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM memories
      ORDER BY created_at DESC
      LIMIT ?
    `);
    const rows = stmt.all(limit) as MemoryRow[];
    return rows.map(rowToRecord);
  }

  public searchFTS(query: string, limit = 20): Array<{ id: string; rank: number }> {
    const sanitized = sanitizeFtsQuery(query);
    if (!sanitized) {
      return [];
    }

    try {
      const stmt = this.db.prepare(`
        SELECT id, bm25(memories_fts) as rank
        FROM memories_fts
        WHERE memories_fts MATCH ?
        ORDER BY rank ASC
        LIMIT ?
      `);
      const rows = stmt.all(sanitized, limit) as Array<{ id: string; rank: number }>;
      return rows;
    } catch {
      return [];
    }
  }

  public searchVector(
    queryEmbedding: Float32Array,
    limit = 20,
    minSimilarity = 0.3,
  ): Array<{ id: string; score: number }> {
    const stmt = this.db.prepare('SELECT id, embedding FROM memories WHERE embedding IS NOT NULL');
    const rows = stmt.all() as Array<{ id: string; embedding: Uint8Array }>;

    const scored: Array<{ id: string; score: number }> = [];

    for (const row of rows) {
      const vec = blobToVector(row.embedding);
      const similarity = cosineSimilarity(queryEmbedding, vec);
      if (similarity >= minSimilarity) {
        scored.push({ id: row.id, score: similarity });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  public searchHybrid(
    query: string,
    queryEmbedding?: Float32Array | null,
    limit = 5,
  ): ScoredMemory[] {
    const ftsResults = this.searchFTS(query, 30);
    const vectorResults = queryEmbedding ? this.searchVector(queryEmbedding, 30) : [];

    const k = 60; // Standard RRF smoothing factor
    const rrfScores = new Map<string, { score: number; ftsRank?: number; vectorRank?: number }>();

    ftsResults.forEach((res, index) => {
      const rank = index + 1;
      const current = rrfScores.get(res.id) || { score: 0 };
      current.score += 1 / (k + rank);
      current.ftsRank = rank;
      rrfScores.set(res.id, current);
    });

    vectorResults.forEach((res, index) => {
      const rank = index + 1;
      const current = rrfScores.get(res.id) || { score: 0 };
      current.score += 1 / (k + rank);
      current.vectorRank = rank;
      rrfScores.set(res.id, current);
    });

    const sortedIds = Array.from(rrfScores.entries())
      .sort((a, b) => b[1].score - a[1].score)
      .slice(0, limit);

    const memories: ScoredMemory[] = [];
    for (const [id, meta] of sortedIds) {
      const memory = this.getMemoryById(id);
      if (memory) {
        memories.push({
          ...memory,
          score: meta.score,
          ftsRank: meta.ftsRank,
          vectorRank: meta.vectorRank,
        });
      }
    }

    return memories;
  }

  public getStats(): {
    totalCount: number;
    modalityCounts: Record<MemoryModality, number>;
    topTags: Array<{ tag: string; count: number }>;
  } {
    const totalRow = this.db.prepare('SELECT COUNT(*) as count FROM memories').get() as {
      count: number;
    };
    const totalCount = totalRow?.count ?? 0;

    const modalityCounts: Record<MemoryModality, number> = {
      text: 0,
      voice: 0,
      image: 0,
      document: 0,
    };

    const modRows = this.db
      .prepare('SELECT modality, COUNT(*) as count FROM memories GROUP BY modality')
      .all() as Array<{ modality: string; count: number }>;

    for (const row of modRows) {
      if (row.modality in modalityCounts) {
        modalityCounts[row.modality as MemoryModality] = row.count;
      }
    }

    const tagCounts = new Map<string, number>();
    const tagRows = this.db.prepare('SELECT tags FROM memories').all() as Array<{ tags: string }>;
    for (const row of tagRows) {
      try {
        const parsed = JSON.parse(row.tags) as string[];
        for (const t of parsed) {
          const normalized = t.toLowerCase().trim();
          if (normalized) {
            tagCounts.set(normalized, (tagCounts.get(normalized) || 0) + 1);
          }
        }
      } catch {
        // ignore malformed tags
      }
    }

    const topTags = Array.from(tagCounts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totalCount,
      modalityCounts,
      topTags,
    };
  }

  public saveChatMessage(role: 'user' | 'assistant', content: string): void {
    const id = crypto.randomUUID();
    const timestamp = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO chat_messages (id, role, content, timestamp)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(id, role, content, timestamp);

    // Prune messages older than the last 50 to maintain performance
    this.db.run(`
      DELETE FROM chat_messages
      WHERE id NOT IN (
        SELECT id FROM chat_messages
        ORDER BY timestamp DESC
        LIMIT 50
      )
    `);
  }

  public getRecentChatMessages(limit = 15): ChatMessage[] {
    const stmt = this.db.prepare(`
      SELECT id, role, content, timestamp
      FROM chat_messages
      ORDER BY timestamp DESC
      LIMIT ?
    `);
    const rows = stmt.all(limit) as Array<{
      id: string;
      role: string;
      content: string;
      timestamp: number;
    }>;

    return rows.reverse().map((r) => ({
      id: r.id,
      role: r.role as 'user' | 'assistant',
      content: r.content,
      timestamp: r.timestamp,
    }));
  }

  public clearChatMessages(): void {
    this.db.run('DELETE FROM chat_messages');
  }

  public createReminder(data: {
    id?: string;
    memoryId?: string | null;
    text: string;
    dueAt: number;
  }): ReminderRecord {
    const id = data.id || crypto.randomUUID();
    const now = Date.now();
    const status: ReminderStatus = 'pending';

    const stmt = this.db.prepare(`
      INSERT INTO reminders (id, memory_id, text, due_at, status, is_notified, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?)
    `);

    stmt.run(id, data.memoryId ?? null, data.text, data.dueAt, status, now, now);

    return {
      id,
      memoryId: data.memoryId ?? null,
      text: data.text,
      dueAt: data.dueAt,
      status,
      isNotified: false,
      createdAt: now,
      updatedAt: now,
    };
  }

  public getReminderById(id: string): ReminderRecord | null {
    const stmt = this.db.prepare('SELECT * FROM reminders WHERE id = ?');
    const row = stmt.get(id) as ReminderRow | null;
    return row ? rowToReminder(row) : null;
  }

  public listPendingReminders(limit = 20): ReminderRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM reminders
      WHERE status = 'pending'
      ORDER BY due_at ASC
      LIMIT ?
    `);
    const rows = stmt.all(limit) as ReminderRow[];
    return rows.map(rowToReminder);
  }

  public listDueReminders(now: number, limit = 20): ReminderRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM reminders
      WHERE status = 'pending' AND due_at <= ? AND is_notified = 0
      ORDER BY due_at ASC
      LIMIT ?
    `);
    const rows = stmt.all(now, limit) as ReminderRow[];
    return rows.map(rowToReminder);
  }

  public markReminderNotified(id: string): boolean {
    const now = Date.now();
    const stmt = this.db.prepare(`
      UPDATE reminders
      SET is_notified = 1, updated_at = ?
      WHERE id = ?
    `);
    const result = stmt.run(now, id);
    return result.changes > 0;
  }

  public updateReminderStatus(id: string, status: ReminderStatus): ReminderRecord | null {
    const now = Date.now();
    const stmt = this.db.prepare(`
      UPDATE reminders
      SET status = ?, updated_at = ?
      WHERE id = ?
    `);
    stmt.run(status, now, id);
    return this.getReminderById(id);
  }

  public snoozeReminder(id: string, additionalMs: number): ReminderRecord | null {
    const existing = this.getReminderById(id);
    if (!existing) return null;

    const newDueAt = Math.max(existing.dueAt, Date.now()) + additionalMs;
    const now = Date.now();

    const stmt = this.db.prepare(`
      UPDATE reminders
      SET due_at = ?, status = 'pending', is_notified = 0, updated_at = ?
      WHERE id = ?
    `);
    stmt.run(newDueAt, now, id);
    return this.getReminderById(id);
  }

  public deleteReminder(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM reminders WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }
}

export const memoryRepository = new MemoryRepository();
