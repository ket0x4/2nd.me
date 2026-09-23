import { Bot } from 'grammy';
import { env } from '../config/env';
import { handleCallbackQuery } from './handlers/callbacks';
import {
  handleClearContextCommand,
  handleRecentCommand,
  handleRemindersCommand,
  handleSearchCommand,
  handleStartCommand,
  handleStatsCommand,
} from './handlers/commands';
import { handleDocumentMessage } from './handlers/document';
import { handlePhotoMessage } from './handlers/photo';
import { handleTextMessage } from './handlers/text';
import { handleVoiceMessage } from './handlers/voice';
import { authGuard } from './middleware/auth';

export async function setupBotCommands(bot: Bot): Promise<void> {
  try {
    await bot.api.setMyCommands([
      { command: 'start', description: '🚀 Ana menü ve kullanım rehberi' },
      { command: 'reminders', description: '⏰ Aktif hatırlatıcılar ve görevler' },
      { command: 'search', description: '🔍 Hibrit arama (semantik + kelime)' },
      { command: 'recent', description: '🕒 Son kaydedilen notları listele' },
      { command: 'stats', description: '📊 Beyin istatistikleri ve etiketler' },
      { command: 'clear_context', description: '🧹 Sohbet bağlamını sıfırla' },
      { command: 'help', description: '💡 Kullanım ipuçları ve yardım' },
    ]);
  } catch (error) {
    console.warn('Notice: Telegram setMyCommands could not be updated:', error);
  }
}

export function createBot(): Bot {
  const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

  // Authentication guard ensuring private single-user access
  bot.use(authGuard);

  // Command handlers
  bot.command('start', handleStartCommand);
  bot.command('help', handleStartCommand);
  bot.command('stats', handleStatsCommand);
  bot.command('search', handleSearchCommand);
  bot.command('recent', handleRecentCommand);
  bot.command('reminders', handleRemindersCommand);
  bot.command('clear_context', handleClearContextCommand);

  // Interactive inline button callbacks
  bot.on('callback_query:data', handleCallbackQuery);

  // Modality handlers
  bot.on(['message:voice', 'message:audio'], handleVoiceMessage);
  bot.on('message:photo', handlePhotoMessage);
  bot.on('message:document', handleDocumentMessage);
  bot.on('message:text', handleTextMessage);

  // Catch-all error logging
  bot.catch((err) => {
    console.error('Unhandled bot error:', err);
  });

  return bot;
}
