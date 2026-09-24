import {
  type Content,
  type FunctionCall,
  type FunctionDeclaration,
  GoogleGenAI,
  type Part,
  Type,
} from '@google/genai';
import { env } from '../config/env';
import { memoryRepository } from '../db/repository';
import type { MemoryModality } from '../db/schema';
import { withRetry } from '../utils/retry';
import { geminiService } from './gemini';

function getSystemInstruction(): string {
  const now = new Date();
  const timeStr = now.toLocaleString('tr-TR', {
    timeZone: env.TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const isoStr = now.toISOString();

  return `You are 2nd.me, a modern, highly capable personal second brain assistant on Telegram.
Your purpose is to store, retrieve, connect, and synthesize the user's personal knowledge, thoughts, audio voice recordings, documents, images, and action reminders.

Current Reference Time: ${timeStr} (${env.TIMEZONE}) / ISO: ${isoStr}.
Always use this current reference time when interpreting relative time expressions (e.g. "yarın 15:00", "2 saat sonra", "pazartesi sabah 09:00", "tomorrow at 3pm").

Strict Operational Guidelines:
1. Tone and Style: Modern, helpful, concise, well-structured, and aesthetically pleasing. Always match the language of the user (e.g. Turkish if spoken to in Turkish, English if spoken to in English).
2. Telegram Visual Presentation:
   - Use clean, structured Markdown suitable for Telegram: bold titles, bullet points, and code styling for tags and commands (e.g. \`#tag\`, \`/search\`, \`/reminders\`).
   - Use appropriate emojis naturally as visual anchors (e.g. 🧠, 📌, 📝, 🎙️, 📸, 📄, 🏷️, 💡, ⚡, 🔍, ⏰) to make cards and messages readable, pleasant, and modern.
3. Saving Information:
   - When the user shares notes, ideas, facts, voice transcripts, photos, or documents, call the 'save_memory' tool.
   - Generate a concise, informative title, a 1-2 sentence summary, and 3-6 relevant lowercase tags.
   - When confirmed, present a sleek memory card:
     ✨ **Yeni Hafıza Kaydedildi** (or Memory Saved)
     📌 **Başlık:** <Title>
     📝 **Özet:** <Summary>
     > <Key highlights, transcript, or detailed insights>
     🏷️ \`#tag1\` \`#tag2\`
4. Proactive Action & Reminder Scheduling:
   - Whenever a user note, idea, voice recording, or explicit message mentions a future date, time, task, deadline, or actionable commitment (e.g. "yarın 14:00'te vergi öde", "cuma günü rapor teslim et", "beni 2 saat sonra uyar"):
     * Call the 'set_reminder' tool with the calculated ISO-8601 timestamp in user's timezone (${env.TIMEZONE}) and clear task description.
     * If saving a memory at the same time, link it by providing the memory ID from save_memory result.
     * In your response, clearly state that a reminder was scheduled:
       ⏰ **Hatırlatıcı Ayarlandı:** <Zaman> - <Görev>
5. Managing Reminders:
   - Use 'list_reminders' when the user asks what tasks or reminders are upcoming or pending.
   - Use 'complete_reminder' or 'cancel_reminder' when the user requests completing or deleting an existing reminder.
6. Retrieving Information:
   - When the user asks questions or searches for past notes, call the 'search_memories' tool.
   - Synthesize retrieved knowledge into a clear, direct answer with dates and bulleted insights.
   - If nothing is found, state that clearly and suggest refining the search.
7. Updating and Deletion:
   - Use 'update_memory' or 'delete_memory' when requested, and provide a clear confirmation.
8. Statistics and Overview:
   - Use 'get_brain_stats' or 'list_recent_memories' when asked for overviews or stats.`;
}

const saveMemoryDeclaration: FunctionDeclaration = {
  name: 'save_memory',
  description: 'Save a new memory, note, thought, event, fact, or document to the second brain.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      title: {
        type: Type.STRING,
        description: 'Concise, descriptive title for the memory',
      },
      content: {
        type: Type.STRING,
        description: 'Complete text and detailed content of the memory',
      },
      summary: {
        type: Type.STRING,
        description: '1-2 sentence executive summary of key takeaways',
      },
      tags: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: 'List of relevant lowercase topic tags (e.g. ["work", "meeting", "finance"])',
      },
      modality: {
        type: Type.STRING,
        description: 'Source modality: text, voice, image, or document',
      },
    },
    required: ['title', 'content', 'summary', 'tags', 'modality'],
  },
};

const searchMemoriesDeclaration: FunctionDeclaration = {
  name: 'search_memories',
  description:
    'Hybrid search across all past memories, voice notes, documents, and visual records.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: {
        type: Type.STRING,
        description: 'The search query or concept to search for',
      },
      limit: {
        type: Type.INTEGER,
        description: 'Maximum number of memories to return (default 5)',
      },
    },
    required: ['query'],
  },
};

const updateMemoryDeclaration: FunctionDeclaration = {
  name: 'update_memory',
  description: 'Update an existing memory by ID with new title, content, summary, or tags.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      id: {
        type: Type.STRING,
        description: 'The unique ID of the memory to update',
      },
      title: {
        type: Type.STRING,
        description: 'Updated title',
      },
      content: {
        type: Type.STRING,
        description: 'Updated content',
      },
      summary: {
        type: Type.STRING,
        description: 'Updated summary',
      },
      tags: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: 'Updated tags',
      },
    },
    required: ['id'],
  },
};

const deleteMemoryDeclaration: FunctionDeclaration = {
  name: 'delete_memory',
  description: 'Permanently delete a memory from the second brain by ID.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      id: {
        type: Type.STRING,
        description: 'The unique ID of the memory to delete',
      },
    },
    required: ['id'],
  },
};

const listRecentMemoriesDeclaration: FunctionDeclaration = {
  name: 'list_recent_memories',
  description: 'Retrieve the most recently added memories in reverse chronological order.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      limit: {
        type: Type.INTEGER,
        description: 'Number of recent memories to return (default 5)',
      },
    },
  },
};

const getBrainStatsDeclaration: FunctionDeclaration = {
  name: 'get_brain_stats',
  description:
    'Retrieve overall statistics of the second brain, including count by modality and top tags.',
  parameters: {
    type: Type.OBJECT,
    properties: {},
  },
};

const setReminderDeclaration: FunctionDeclaration = {
  name: 'set_reminder',
  description:
    'Schedule an automated reminder or action notification for a specific future date and time.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      text: {
        type: Type.STRING,
        description: 'Clear description of the reminder or task to perform',
      },
      due_at_iso: {
        type: Type.STRING,
        description: 'Target date and time in ISO 8601 format (e.g. "2026-09-24T14:00:00+03:00")',
      },
      memory_id: {
        type: Type.STRING,
        description: 'Optional ID of an associated memory record if applicable',
      },
    },
    required: ['text', 'due_at_iso'],
  },
};

const listRemindersDeclaration: FunctionDeclaration = {
  name: 'list_reminders',
  description: 'Retrieve pending scheduled reminders and actionable tasks.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      limit: {
        type: Type.INTEGER,
        description: 'Maximum number of pending reminders to return (default 10)',
      },
    },
  },
};

const completeReminderDeclaration: FunctionDeclaration = {
  name: 'complete_reminder',
  description: 'Mark a scheduled reminder or task as completed by ID.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      id: {
        type: Type.STRING,
        description: 'The unique ID of the reminder to mark as completed',
      },
    },
    required: ['id'],
  },
};

const cancelReminderDeclaration: FunctionDeclaration = {
  name: 'cancel_reminder',
  description: 'Cancel or delete a scheduled reminder by ID.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      id: {
        type: Type.STRING,
        description: 'The unique ID of the reminder to cancel/delete',
      },
    },
    required: ['id'],
  },
};

const AGENT_TOOLS = [
  {
    functionDeclarations: [
      saveMemoryDeclaration,
      searchMemoriesDeclaration,
      updateMemoryDeclaration,
      deleteMemoryDeclaration,
      listRecentMemoriesDeclaration,
      getBrainStatsDeclaration,
      setReminderDeclaration,
      listRemindersDeclaration,
      completeReminderDeclaration,
      cancelReminderDeclaration,
    ],
  },
];

class AgentService {
  private ai: GoogleGenAI;

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  }

  private buildInitialContents(userMessage: string): Content[] {
    const recentMessages = memoryRepository.getRecentChatMessages(12);

    const contents: Content[] = recentMessages.map((msg) => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }],
    }));

    contents.push({
      role: 'user',
      parts: [{ text: userMessage }],
    });

    return contents;
  }

  private async callAgentModel(contents: Content[]) {
    return await withRetry(async () => {
      try {
        return await this.ai.models.generateContent({
          model: env.DEFAULT_MODEL,
          contents,
          config: {
            systemInstruction: getSystemInstruction(),
            tools: AGENT_TOOLS,
          },
        });
      } catch (err: unknown) {
        const error = err as { status?: number; message?: string };
        if (error?.status === 503 || /high demand|unavailable/i.test(error?.message ?? '')) {
          console.warn(`${env.DEFAULT_MODEL} busy, falling back to ${env.FALLBACK_MODEL}`);
          return await this.ai.models.generateContent({
            model: env.FALLBACK_MODEL,
            contents,
            config: {
              systemInstruction: getSystemInstruction(),
              tools: AGENT_TOOLS,
            },
          });
        }
        throw err;
      }
    });
  }

  private async executeFunctionCalls(
    functionCalls: FunctionCall[],
    options?: { modality?: MemoryModality; filePath?: string },
  ): Promise<Part[]> {
    const parts: Part[] = [];

    for (const call of functionCalls) {
      if (!call.name) continue;
      const result = await this.executeTool(
        call.name,
        (call.args || {}) as Record<string, unknown>,
        options,
      );
      parts.push({
        functionResponse: {
          name: call.name,
          response: result,
        },
      });
    }

    return parts;
  }

  public async handleUserMessage(
    userMessage: string,
    options?: {
      modality?: MemoryModality;
      filePath?: string;
    },
  ): Promise<string> {
    const contents = this.buildInitialContents(userMessage);

    let turns = 0;
    const maxTurns = 6;
    let finalResponseText = '';

    while (turns < maxTurns) {
      turns++;

      const response = await this.callAgentModel(contents);
      const candidate = response.candidates?.[0];
      if (!candidate?.content) {
        break;
      }

      contents.push(candidate.content);

      const functionCalls = response.functionCalls;
      if (!functionCalls || functionCalls.length === 0) {
        finalResponseText = response.text?.trim() ?? '';
        break;
      }

      const functionResponseParts = await this.executeFunctionCalls(functionCalls, options);
      contents.push({
        role: 'user',
        parts: functionResponseParts,
      });
    }

    if (!finalResponseText) {
      finalResponseText = 'Processed your request.';
    }

    memoryRepository.saveChatMessage('user', userMessage);
    memoryRepository.saveChatMessage('assistant', finalResponseText);

    return finalResponseText;
  }

  private async toolSaveMemory(
    args: Record<string, unknown>,
    options?: { modality?: MemoryModality; filePath?: string },
  ): Promise<Record<string, unknown>> {
    const title = String(args.title ?? 'Untitled Memory');
    const content = String(args.content ?? '');
    const summary = String(args.summary ?? '');
    const tags = Array.isArray(args.tags) ? args.tags.map(String) : [];
    const modality = (options?.modality ?? args.modality ?? 'text') as MemoryModality;
    const filePath = options?.filePath ?? null;

    const embedText = `${title}\n${summary}\n${tags.join(' ')}\n${content}`;
    const embedding = await geminiService.createEmbedding(embedText);

    const memory = memoryRepository.createMemory({
      title,
      content,
      summary,
      tags,
      modality,
      filePath,
      embedding,
    });

    return {
      success: true,
      memoryId: memory.id,
      title: memory.title,
      summary: memory.summary,
      tags: memory.tags,
      modality: memory.modality,
    };
  }

  private async toolSearchMemories(
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const query = String(args.query ?? '');
    const limit = typeof args.limit === 'number' ? args.limit : 5;
    const queryEmbedding = await geminiService.createEmbedding(query);
    const results = memoryRepository.searchHybrid(query, queryEmbedding, limit);

    return {
      resultsCount: results.length,
      memories: results.map((m) => ({
        id: m.id,
        title: m.title,
        summary: m.summary,
        content: m.content,
        tags: m.tags,
        modality: m.modality,
        score: Number(m.score.toFixed(4)),
        createdAt: new Date(m.createdAt).toISOString(),
      })),
    };
  }

  private async toolUpdateMemory(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const id = String(args.id);
    const updates: {
      title?: string;
      content?: string;
      summary?: string;
      tags?: string[];
      embedding?: Float32Array;
    } = {};

    if (args.title) updates.title = String(args.title);
    if (args.content) updates.content = String(args.content);
    if (args.summary) updates.summary = String(args.summary);
    if (Array.isArray(args.tags)) updates.tags = args.tags.map(String);

    if (updates.title || updates.content || updates.summary || updates.tags) {
      const existing = memoryRepository.getMemoryById(id);
      if (existing) {
        const newTitle = updates.title ?? existing.title;
        const newContent = updates.content ?? existing.content;
        const newSummary = updates.summary ?? existing.summary;
        const newTags = updates.tags ?? existing.tags;
        const embedText = `${newTitle}\n${newSummary}\n${newTags.join(' ')}\n${newContent}`;
        updates.embedding = await geminiService.createEmbedding(embedText);
      }
    }

    const updated = memoryRepository.updateMemory(id, updates);
    return {
      success: Boolean(updated),
      memory: updated,
    };
  }

  private toolDeleteMemory(args: Record<string, unknown>): Record<string, unknown> {
    const id = String(args.id);
    const success = memoryRepository.deleteMemory(id);
    return { success, deletedId: id };
  }

  private toolListRecentMemories(args: Record<string, unknown>): Record<string, unknown> {
    const limit = typeof args.limit === 'number' ? args.limit : 5;
    const memories = memoryRepository.listRecentMemories(limit);
    return {
      count: memories.length,
      memories: memories.map((m) => ({
        id: m.id,
        title: m.title,
        summary: m.summary,
        tags: m.tags,
        modality: m.modality,
        createdAt: new Date(m.createdAt).toISOString(),
      })),
    };
  }

  private toolGetBrainStats(): Record<string, unknown> {
    return memoryRepository.getStats();
  }

  private toolSetReminder(args: Record<string, unknown>): Record<string, unknown> {
    const text = String(args.text ?? '').trim();
    const dueAtIso = String(args.due_at_iso ?? '').trim();
    const memoryId = args.memory_id ? String(args.memory_id) : null;

    if (!text || !dueAtIso) {
      return { success: false, error: 'text and due_at_iso are required' };
    }

    const timestamp = new Date(dueAtIso).getTime();
    if (Number.isNaN(timestamp)) {
      return { success: false, error: `Invalid date format: ${dueAtIso}` };
    }

    const reminder = memoryRepository.createReminder({
      text,
      dueAt: timestamp,
      memoryId,
    });

    return {
      success: true,
      reminderId: reminder.id,
      text: reminder.text,
      dueAt: new Date(reminder.dueAt).toISOString(),
    };
  }

  private toolListReminders(args: Record<string, unknown>): Record<string, unknown> {
    const limit = typeof args.limit === 'number' ? args.limit : 10;
    const reminders = memoryRepository.listPendingReminders(limit);
    return {
      count: reminders.length,
      reminders: reminders.map((r) => ({
        id: r.id,
        text: r.text,
        dueAt: new Date(r.dueAt).toISOString(),
        memoryId: r.memoryId,
      })),
    };
  }

  private toolCompleteReminder(args: Record<string, unknown>): Record<string, unknown> {
    const id = String(args.id);
    const updated = memoryRepository.updateReminderStatus(id, 'completed');
    return {
      success: Boolean(updated),
      id,
    };
  }

  private toolCancelReminder(args: Record<string, unknown>): Record<string, unknown> {
    const id = String(args.id);
    const deleted = memoryRepository.deleteReminder(id);
    return {
      success: deleted,
      id,
    };
  }

  private async executeTool(
    name: string,
    args: Record<string, unknown>,
    options?: {
      modality?: MemoryModality;
      filePath?: string;
    },
  ): Promise<Record<string, unknown>> {
    switch (name) {
      case 'save_memory':
        return this.toolSaveMemory(args, options);
      case 'search_memories':
        return this.toolSearchMemories(args);
      case 'update_memory':
        return this.toolUpdateMemory(args);
      case 'delete_memory':
        return this.toolDeleteMemory(args);
      case 'list_recent_memories':
        return this.toolListRecentMemories(args);
      case 'get_brain_stats':
        return this.toolGetBrainStats();
      case 'set_reminder':
        return this.toolSetReminder(args);
      case 'list_reminders':
        return this.toolListReminders(args);
      case 'complete_reminder':
        return this.toolCompleteReminder(args);
      case 'cancel_reminder':
        return this.toolCancelReminder(args);
      default:
        return { error: `Unknown tool: ${name}` };
    }
  }
}

export const agentService = new AgentService();
