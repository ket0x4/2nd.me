import { InlineKeyboard } from 'grammy';
import { env } from '../config/env';
import { memoryRepository } from '../db/repository';
import type { MemoryRecord, ReminderRecord, ScoredMemory } from '../db/schema';
import { escapeHtml, formatProgressBar } from './utils/format';

export function formatReminderDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString('tr-TR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: env.TIMEZONE,
  });
}

function getModalityIcon(modality: string): string {
  switch (modality?.toLowerCase()) {
    case 'voice':
      return '🎙️';
    case 'image':
      return '📸';
    case 'document':
      return '📄';
    default:
      return '💬';
  }
}

export function formatMemoryCard(memory: MemoryRecord, index?: number, score?: number): string {
  const icon = getModalityIcon(memory.modality);
  const modalityLabel = memory.modality.toUpperCase();
  const title = escapeHtml(memory.title);
  const date = new Date(memory.createdAt).toLocaleDateString('tr-TR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: env.TIMEZONE,
  });

  const headerPrefix = index !== undefined ? `<b>${index}.</b> ` : '';
  const header = `${headerPrefix}${icon} <b>${title}</b>`;

  const metaParts: string[] = [`📅 <i>${date}</i>`, `📑 <code>${modalityLabel}</code>`];
  if (score !== undefined) {
    const pct = Math.min(Math.round(score * 100), 100);
    const badge = pct >= 80 ? '🟢' : pct >= 50 ? '🟡' : '⚪';
    metaParts.push(`${badge} <b>%${pct}</b> uyum`);
  }
  const metaLine = metaParts.join(' · ');

  const tags =
    memory.tags.length > 0
      ? memory.tags.map((t) => `<code>#${escapeHtml(t)}</code>`).join(' ')
      : '';

  const summaryBlock = `<blockquote expandable><b>Özet:</b> ${escapeHtml(
    memory.summary,
  )}</blockquote>`;

  const lines = [header, metaLine, summaryBlock, tags ? `🏷️ ${tags}` : '', ''];

  return lines.join('\n');
}

export function buildStartView(): { text: string; replyMarkup: InlineKeyboard } {
  const keyboard = new InlineKeyboard()
    .text('📊 İstatistikler', 'nav:stats')
    .text('🕒 Son Notlar', 'nav:recent')
    .row()
    .text('⏰ Hatırlatıcılar', 'nav:reminders')
    .text('🧹 Bağlamı Temizle', 'nav:clear_context')
    .row()
    .text('🔍 Nasıl Aranır?', 'nav:search_tip');

  const text = [
    '🧠 <b>2nd.me</b> · <i>Kişisel İkinci Beyin</i>',
    '━━━━━━━━━━━━━━━━━━━━',
    'Kişisel bilginizi, düşüncelerinizi, ses kayıtlarınızı, görsellerinizi ve belgelerinizi otomatik olarak yakalar, analiz eder ve depolar.',
    '',
    '✨ <b>Neler Yapabilirsiniz?</b>',
    '🎙️ <b>Ses Kaydı:</b> Otomatik transkript çıkarılır, özetlenir ve hafızaya eklenir.',
    '📸 <b>Fotoğraf / Ekran Görüntüsü:</b> OCR ile metin okunur, görsel analiz edilip indekslenir.',
    '📄 <b>PDF / Doküman:</b> Temel çıktılar ve özet çıkarılarak bilgi bankasına katılır.',
    '💬 <b>Doğrudan Yazın:</b> Fikirlerinizi kaydedin veya geçmiş notlarınız hakkında soru sorun.',
    '',
    '⚡ <b>Hızlı Komutlar:</b>',
    '• <code>/search &lt;kelime&gt;</code> - Hibrit semantik & kelime araması',
    '• <code>/reminders</code> - Aktif hatırlatıcılar ve eylemler',
    '• <code>/recent [sayı]</code> - Son kaydedilen notları listele',
    '• <code>/stats</code> - Beyin istatistikleri ve popüler etiketler',
    '• <code>/clear_context</code> - Sohbet bağlamını sıfırla (hafızalar korunur)',
    '• <code>/help</code> - Kullanım rehberini göster',
  ].join('\n');

  return { text, replyMarkup: keyboard };
}

export function buildStatsView(): { text: string; replyMarkup: InlineKeyboard } {
  const stats = memoryRepository.getStats();
  const total = stats.totalCount;

  const textProgress = formatProgressBar(stats.modalityCounts.text, total);
  const voiceProgress = formatProgressBar(stats.modalityCounts.voice, total);
  const imageProgress = formatProgressBar(stats.modalityCounts.image, total);
  const docProgress = formatProgressBar(stats.modalityCounts.document, total);

  const lines = [
    '📊 <b>Beyin İstatistikleri & Özet</b>',
    '━━━━━━━━━━━━━━━━━━━━',
    `🧠 <b>Toplam Hafıza:</b> <code>${total}</code> adet`,
    '',
    '📑 <b>Modalite Dağılımı:</b>',
    `  💬 Metin:      <code>${stats.modalityCounts.text}</code> [${textProgress.bar}] %${textProgress.percentage}`,
    `  🎙️ Ses:        <code>${stats.modalityCounts.voice}</code> [${voiceProgress.bar}] %${voiceProgress.percentage}`,
    `  📸 Görsel:     <code>${stats.modalityCounts.image}</code> [${imageProgress.bar}] %${imageProgress.percentage}`,
    `  📄 Doküman:    <code>${stats.modalityCounts.document}</code> [${docProgress.bar}] %${docProgress.percentage}`,
    '',
    '🏷️ <b>Popüler Etiketler:</b>',
  ];

  if (stats.topTags.length === 0) {
    lines.push('  <i>Henüz etiket bulunmuyor.</i>');
  } else {
    const tagBadges = stats.topTags
      .map((item) => `<code>#${escapeHtml(item.tag)}</code> (${item.count})`)
      .join('  ');
    lines.push(`  ${tagBadges}`);
  }

  const keyboard = new InlineKeyboard()
    .text('🔄 Yenile', 'nav:stats')
    .text('🕒 Son Notlar', 'nav:recent')
    .row()
    .text('🏠 Ana Menü', 'nav:start');

  return { text: lines.join('\n'), replyMarkup: keyboard };
}

export function buildRecentView(memories: MemoryRecord[]): {
  text: string;
  replyMarkup: InlineKeyboard;
} {
  if (memories.length === 0) {
    const keyboard = new InlineKeyboard().text('🏠 Ana Menü', 'nav:start');
    return {
      text: '📭 <b>Henüz kayıtlı bir hafıza yok.</b>\nBir ses kaydı, görsel veya metin göndererek hafızanızı oluşturmaya başlayın!',
      replyMarkup: keyboard,
    };
  }

  const lines = [
    `🕒 <b>Son Kaydedilen Hafızalar (${memories.length})</b>`,
    '━━━━━━━━━━━━━━━━━━━━',
    ...memories.map((memory: MemoryRecord, index: number) => formatMemoryCard(memory, index + 1)),
  ];

  const keyboard = new InlineKeyboard()
    .text('📊 İstatistikler', 'nav:stats')
    .text('🔍 Arama İpucu', 'nav:search_tip')
    .row()
    .text('🏠 Ana Menü', 'nav:start');

  return { text: lines.join('\n'), replyMarkup: keyboard };
}

export function buildClearContextView(): {
  text: string;
  replyMarkup: InlineKeyboard;
} {
  const keyboard = new InlineKeyboard()
    .text('🕒 Son Notlar', 'nav:recent')
    .text('🏠 Ana Menü', 'nav:start');

  const text = [
    '🧹 <b>Sohbet Bağlamı Sıfırlandı</b>',
    '━━━━━━━━━━━━━━━━━━━━',
    'Kısa vadeli konuşma geçmişi temizlendi. Yeni bir konuya temiz bir başlangıç yapabilirsiniz.',
    '',
    '🔒 <b>Not:</b> Uzun vadeli tüm hafızalarınız ve belgeleriniz güvenle korunmaktadır.',
  ].join('\n');

  return { text, replyMarkup: keyboard };
}

export function buildMediaKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('🕒 Son Notlar', 'nav:recent')
    .text('📊 İstatistikler', 'nav:stats');
}

export function buildSearchPromptView(): {
  text: string;
  replyMarkup: InlineKeyboard;
} {
  const keyboard = new InlineKeyboard()
    .text('🕒 Son Notlar', 'nav:recent')
    .text('🏠 Ana Menü', 'nav:start');

  const text =
    '💡 <b>Arama Kullanımı:</b>\n<code>/search &lt;aramak istediğiniz terim veya konu&gt;</code>\n\n<i>Örnek:</i> <code>/search toplantı kararları</code>';

  return { text, replyMarkup: keyboard };
}

export function buildSearchResultsView(
  query: string,
  results: ScoredMemory[],
): { text: string; replyMarkup: InlineKeyboard } {
  if (results.length === 0) {
    const keyboard = new InlineKeyboard()
      .text('🕒 Son Notlar', 'nav:recent')
      .text('🏠 Ana Menü', 'nav:start');

    return {
      text: `🔍 <b>"${escapeHtml(query)}"</b> için eşleşen bir hafıza kaydı bulunamadı.`,
      replyMarkup: keyboard,
    };
  }

  const lines = [
    '🔍 <b>Hibrit Arama Sonuçları</b>',
    `🔎 <i>"${escapeHtml(query)}"</i> sorgusu için en alakalı kayıtlar:`,
    '━━━━━━━━━━━━━━━━━━━━',
    ...results.map((memory: ScoredMemory, index: number) =>
      formatMemoryCard(memory, index + 1, memory.score),
    ),
  ];

  const keyboard = new InlineKeyboard()
    .text('📊 İstatistikler', 'nav:stats')
    .text('🕒 Son Notlar', 'nav:recent')
    .row()
    .text('🏠 Ana Menü', 'nav:start');

  return { text: lines.join('\n'), replyMarkup: keyboard };
}

export function buildReminderNotificationView(
  reminder: ReminderRecord,
  memory?: MemoryRecord | null,
): { text: string; replyMarkup: InlineKeyboard } {
  const formattedDate = formatReminderDate(reminder.dueAt);
  const lines = [
    '⏰ <b>Zamanı Geldi: Hatırlatıcı!</b>',
    '━━━━━━━━━━━━━━━━━━━━',
    `📌 <b>${escapeHtml(reminder.text)}</b>`,
    `📅 <i>${formattedDate}</i>`,
  ];

  if (memory) {
    lines.push(
      '',
      `<blockquote expandable><b>İlişkili Not:</b> ${escapeHtml(memory.title)}\n${escapeHtml(
        memory.summary,
      )}</blockquote>`,
    );
  }

  const keyboard = new InlineKeyboard()
    .text('✅ Tamamlandı', `rem:done:${reminder.id}`)
    .row()
    .text('⏰ 1 Saat Ertele', `rem:snooze_1h:${reminder.id}`)
    .text('📅 Yarına Ertele', `rem:snooze_1d:${reminder.id}`);

  if (reminder.memoryId) {
    keyboard.row().text('🔗 İlgili Notu Aç', `rem:view_mem:${reminder.memoryId}`);
  }

  return { text: lines.join('\n'), replyMarkup: keyboard };
}

export function buildRemindersListView(reminders: ReminderRecord[]): {
  text: string;
  replyMarkup: InlineKeyboard;
} {
  const keyboard = new InlineKeyboard();

  if (reminders.length === 0) {
    keyboard.text('🏠 Ana Menü', 'nav:start');
    return {
      text: [
        '📭 <b>Aktif bir hatırlatıcınız bulunmuyor.</b>',
        '━━━━━━━━━━━━━━━━━━━━',
        'Bir ses kaydı, görsel veya metin gönderirken örneğin <i>"Yarın 15:00\'te fatura ödemesini hatırlat"</i> diyerek otonom hatırlatıcı kurabilirsiniz.',
      ].join('\n'),
      replyMarkup: keyboard,
    };
  }

  const lines = [`⏰ <b>Aktif Hatırlatıcılar (${reminders.length})</b>`, '━━━━━━━━━━━━━━━━━━━━'];

  reminders.forEach((rem, idx) => {
    const formatted = formatReminderDate(rem.dueAt);
    lines.push(`<b>${idx + 1}.</b> 📌 <b>${escapeHtml(rem.text)}</b>`);
    lines.push(`    📅 <i>${formatted}</i>`);
    keyboard
      .text(`✅ #${idx + 1} Tamamla`, `rem:done:${rem.id}`)
      .text(`🗑️ Sil`, `rem:del:${rem.id}`)
      .row();
  });

  keyboard.text('🔄 Yenile', 'nav:reminders').text('🏠 Ana Menü', 'nav:start');

  return { text: lines.join('\n'), replyMarkup: keyboard };
}
