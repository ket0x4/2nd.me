import type { Context } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { memoryRepository } from '../../db/repository';
import { geminiService } from '../../services/gemini';
import { escapeHtml } from '../utils/format';
import {
  buildClearContextView,
  buildRecentView,
  buildRemindersListView,
  buildStartView,
  buildStatsView,
  formatMemoryCard,
} from '../views';

async function handleNavStart(ctx: Context): Promise<void> {
  await ctx.answerCallbackQuery();
  const view = buildStartView();
  await ctx.editMessageText(view.text, {
    parse_mode: 'HTML',
    reply_markup: view.replyMarkup,
  });
}

async function handleNavStats(ctx: Context): Promise<void> {
  await ctx.answerCallbackQuery();
  const view = buildStatsView();
  await ctx.editMessageText(view.text, {
    parse_mode: 'HTML',
    reply_markup: view.replyMarkup,
  });
}

async function handleNavRecent(ctx: Context): Promise<void> {
  await ctx.answerCallbackQuery();
  const memories = memoryRepository.listRecentMemories(5);
  const view = buildRecentView(memories);
  await ctx.editMessageText(view.text, {
    parse_mode: 'HTML',
    reply_markup: view.replyMarkup,
  });
}

async function handleNavClearContext(ctx: Context): Promise<void> {
  await ctx.answerCallbackQuery();
  memoryRepository.clearChatMessages();
  const view = buildClearContextView();
  await ctx.editMessageText(view.text, {
    parse_mode: 'HTML',
    reply_markup: view.replyMarkup,
  });
}

async function handleNavSearchTip(ctx: Context): Promise<void> {
  await ctx.answerCallbackQuery({
    text: 'Arama yapmak için sohbete /search <kelime> yazabilirsiniz.',
    show_alert: true,
  });
}

async function handleNavReminders(ctx: Context): Promise<void> {
  await ctx.answerCallbackQuery();
  const reminders = memoryRepository.listPendingReminders(10);
  const view = buildRemindersListView(reminders);
  await ctx.editMessageText(view.text, {
    parse_mode: 'HTML',
    reply_markup: view.replyMarkup,
  });
}

async function handleMemDelPrompt(ctx: Context, memoryId: string): Promise<void> {
  await ctx.answerCallbackQuery();
  const memory = memoryRepository.getMemoryById(memoryId);

  const confirmKeyboard = new InlineKeyboard()
    .text('⚠️ Evet, Kesinlikle Sil', `mem:del_confirm:${memoryId}`)
    .text('❌ İptal', `mem:del_cancel:${memoryId}`);

  const title = memory?.title ? escapeHtml(memory.title) : 'Bu hafızayı';
  await ctx.editMessageText(
    `⚠️ <b>"${title}"</b> başlıklı hafızayı kalıcı olarak silmek istediğinizden emin misiniz?`,
    {
      parse_mode: 'HTML',
      reply_markup: confirmKeyboard,
    },
  );
}

async function handleMemDelConfirm(ctx: Context, memoryId: string): Promise<void> {
  await ctx.answerCallbackQuery({ text: 'Hafıza silindi.' });
  memoryRepository.deleteMemory(memoryId);

  const keyboard = new InlineKeyboard()
    .text('🕒 Son Notlar', 'nav:recent')
    .text('🏠 Ana Menü', 'nav:start');

  await ctx.editMessageText('🗑️ <b>Hafıza başarıyla silindi.</b>', {
    parse_mode: 'HTML',
    reply_markup: keyboard,
  });
}

async function handleMemDelCancel(ctx: Context, memoryId: string): Promise<void> {
  await ctx.answerCallbackQuery({ text: 'Silme işlemi iptal edildi.' });
  const memory = memoryRepository.getMemoryById(memoryId);
  if (!memory) {
    await ctx.editMessageText('İşlem iptal edildi.', {
      reply_markup: new InlineKeyboard().text('🏠 Ana Menü', 'nav:start'),
    });
    return;
  }

  const card = formatMemoryCard(memory);
  const keyboard = new InlineKeyboard()
    .text('🔍 Benzerleri Ara', `mem:search_similar:${memory.id}`)
    .text('🗑️ Sil', `mem:del_prompt:${memory.id}`);

  await ctx.editMessageText(card, {
    parse_mode: 'HTML',
    reply_markup: keyboard,
  });
}

async function handleMemSearchSimilar(ctx: Context, memoryId: string): Promise<void> {
  const memory = memoryRepository.getMemoryById(memoryId);
  if (!memory) {
    await ctx.answerCallbackQuery({ text: 'Hafıza bulunamadı.', show_alert: true });
    return;
  }

  await ctx.answerCallbackQuery({ text: 'Benzer hafızalar aranıyor...' });
  const query = memory.tags.length > 0 ? memory.tags.join(' ') : memory.title;
  const embedding = await geminiService.createEmbedding(query);
  const results = memoryRepository.searchHybrid(query, embedding, 4);
  const filtered = results.filter((r) => r.id !== memoryId);

  if (filtered.length === 0) {
    await ctx.reply(
      `🔍 <b>"${escapeHtml(memory.title)}"</b> ile benzer başka bir hafıza bulunamadı.`,
      {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().text('🏠 Ana Menü', 'nav:start'),
      },
    );
    return;
  }

  const lines = [
    `🔍 <b>"${escapeHtml(memory.title)}"</b> ile Benzer Hafızalar:`,
    '━━━━━━━━━━━━━━━━━━━━',
    ...filtered.map((m, idx) => formatMemoryCard(m, idx + 1, m.score)),
  ];

  await ctx.reply(lines.join('\n'), {
    parse_mode: 'HTML',
    reply_markup: new InlineKeyboard().text('🏠 Ana Menü', 'nav:start'),
  });
}

async function handleRemDone(ctx: Context, reminderId: string): Promise<void> {
  await ctx.answerCallbackQuery({ text: 'Görev tamamlandı! 🎉' });
  memoryRepository.updateReminderStatus(reminderId, 'completed');

  const keyboard = new InlineKeyboard()
    .text('⏰ Hatırlatıcılar', 'nav:reminders')
    .text('🏠 Ana Menü', 'nav:start');

  await ctx.editMessageText('✅ <b>Görev tamamlandı olarak işaretlendi.</b>', {
    parse_mode: 'HTML',
    reply_markup: keyboard,
  });
}

async function handleRemSnooze(
  ctx: Context,
  reminderId: string,
  additionalMs: number,
  label: string,
): Promise<void> {
  await ctx.answerCallbackQuery({ text: `${label} ertelendi ⏰` });
  memoryRepository.snoozeReminder(reminderId, additionalMs);

  const keyboard = new InlineKeyboard()
    .text('⏰ Hatırlatıcılar', 'nav:reminders')
    .text('🏠 Ana Menü', 'nav:start');

  await ctx.editMessageText(`⏰ <b>Hatırlatıcı ${label} ertelendi.</b>`, {
    parse_mode: 'HTML',
    reply_markup: keyboard,
  });
}

async function handleRemDelete(ctx: Context, reminderId: string): Promise<void> {
  await ctx.answerCallbackQuery({ text: 'Hatırlatıcı silindi.' });
  memoryRepository.deleteReminder(reminderId);
  const reminders = memoryRepository.listPendingReminders(10);
  const view = buildRemindersListView(reminders);
  await ctx.editMessageText(view.text, {
    parse_mode: 'HTML',
    reply_markup: view.replyMarkup,
  });
}

async function handleRemViewMem(ctx: Context, memoryId: string): Promise<void> {
  const memory = memoryRepository.getMemoryById(memoryId);
  if (!memory) {
    await ctx.answerCallbackQuery({ text: 'İlişkili hafıza bulunamadı.', show_alert: true });
    return;
  }

  await ctx.answerCallbackQuery();
  const card = formatMemoryCard(memory);
  const keyboard = new InlineKeyboard()
    .text('🔍 Benzerleri Ara', `mem:search_similar:${memory.id}`)
    .text('⏰ Hatırlatıcılar', 'nav:reminders')
    .row()
    .text('🏠 Ana Menü', 'nav:start');

  await ctx.reply(card, {
    parse_mode: 'HTML',
    reply_markup: keyboard,
  });
}

async function handleNavCallbacks(ctx: Context, data: string): Promise<boolean> {
  switch (data) {
    case 'nav:start':
      await handleNavStart(ctx);
      return true;
    case 'nav:stats':
      await handleNavStats(ctx);
      return true;
    case 'nav:recent':
      await handleNavRecent(ctx);
      return true;
    case 'nav:reminders':
      await handleNavReminders(ctx);
      return true;
    case 'nav:clear_context':
      await handleNavClearContext(ctx);
      return true;
    case 'nav:search_tip':
      await handleNavSearchTip(ctx);
      return true;
    default:
      return false;
  }
}

async function handleMemoryCallbacks(ctx: Context, data: string): Promise<boolean> {
  if (data.startsWith('mem:del_prompt:')) {
    await handleMemDelPrompt(ctx, data.slice(15));
    return true;
  }
  if (data.startsWith('mem:del_confirm:')) {
    await handleMemDelConfirm(ctx, data.slice(16));
    return true;
  }
  if (data.startsWith('mem:del_cancel:')) {
    await handleMemDelCancel(ctx, data.slice(15));
    return true;
  }
  if (data.startsWith('mem:search_similar:')) {
    await handleMemSearchSimilar(ctx, data.slice(19));
    return true;
  }
  return false;
}

async function handleReminderCallbacks(ctx: Context, data: string): Promise<boolean> {
  if (data.startsWith('rem:done:')) {
    await handleRemDone(ctx, data.slice(9));
    return true;
  }
  if (data.startsWith('rem:snooze_1h:')) {
    await handleRemSnooze(ctx, data.slice(14), 60 * 60 * 1000, '1 saat');
    return true;
  }
  if (data.startsWith('rem:snooze_1d:')) {
    await handleRemSnooze(ctx, data.slice(14), 24 * 60 * 60 * 1000, 'yarına');
    return true;
  }
  if (data.startsWith('rem:del:')) {
    await handleRemDelete(ctx, data.slice(8));
    return true;
  }
  if (data.startsWith('rem:view_mem:')) {
    await handleRemViewMem(ctx, data.slice(13));
    return true;
  }
  return false;
}

export async function handleCallbackQuery(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data) return;

  try {
    if (await handleNavCallbacks(ctx, data)) return;
    if (await handleMemoryCallbacks(ctx, data)) return;
    if (await handleReminderCallbacks(ctx, data)) return;

    await ctx.answerCallbackQuery();
  } catch (error) {
    console.error('Error handling callback query:', error);
    try {
      await ctx.answerCallbackQuery();
    } catch {
      // Ignore secondary error
    }
  }
}
