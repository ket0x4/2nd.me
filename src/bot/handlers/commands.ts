import type { Context } from 'grammy';
import { memoryRepository } from '../../db/repository';
import { geminiService } from '../../services/gemini';
import { sendModernMessage } from '../utils/format';
import {
  buildClearContextView,
  buildRecentView,
  buildRemindersListView,
  buildSearchPromptView,
  buildSearchResultsView,
  buildStartView,
  buildStatsView,
} from '../views';

export async function handleStartCommand(ctx: Context): Promise<void> {
  const view = buildStartView();
  await sendModernMessage(ctx, view.text, { replyMarkup: view.replyMarkup });
}

export async function handleStatsCommand(ctx: Context): Promise<void> {
  const view = buildStatsView();
  await sendModernMessage(ctx, view.text, { replyMarkup: view.replyMarkup });
}

export async function handleSearchCommand(ctx: Context): Promise<void> {
  const query = ctx.match?.toString().trim();

  if (!query) {
    const view = buildSearchPromptView();
    await sendModernMessage(ctx, view.text, { replyMarkup: view.replyMarkup });
    return;
  }

  await ctx.replyWithChatAction('typing');

  try {
    const queryEmbedding = await geminiService.createEmbedding(query);
    const results = memoryRepository.searchHybrid(query, queryEmbedding, 5);
    const view = buildSearchResultsView(query, results);
    await sendModernMessage(ctx, view.text, { replyMarkup: view.replyMarkup });
  } catch (error) {
    console.error('Error executing /search command:', error);
    await sendModernMessage(
      ctx,
      '⚠️ Arama yürütülürken beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.',
    );
  }
}

export async function handleRecentCommand(ctx: Context): Promise<void> {
  const arg = ctx.match?.toString().trim();
  const limit = arg ? Math.min(Math.max(Number.parseInt(arg, 10) || 5, 1), 20) : 5;

  const memories = memoryRepository.listRecentMemories(limit);
  const view = buildRecentView(memories);
  await sendModernMessage(ctx, view.text, { replyMarkup: view.replyMarkup });
}

export async function handleClearContextCommand(ctx: Context): Promise<void> {
  memoryRepository.clearChatMessages();
  const view = buildClearContextView();
  await sendModernMessage(ctx, view.text, { replyMarkup: view.replyMarkup });
}

export async function handleRemindersCommand(ctx: Context): Promise<void> {
  const reminders = memoryRepository.listPendingReminders(10);
  const view = buildRemindersListView(reminders);
  await sendModernMessage(ctx, view.text, { replyMarkup: view.replyMarkup });
}
