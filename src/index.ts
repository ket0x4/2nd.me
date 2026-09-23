import { createBot, setupBotCommands } from './bot/bot';
import { env } from './config/env';
import { getDatabase } from './db/client';
import { schedulerService } from './services/scheduler';
import { storageService } from './services/storage';

async function main(): Promise<void> {
  console.log('Starting 2nd.me Second Brain Bot...');

  // Ensure storage directories exist
  await storageService.init();

  // Initialize SQLite database and tables
  const db = getDatabase();
  console.log(`Database connected at: ${env.DB_PATH}`);

  // Create bot instance
  const bot = createBot();

  // Graceful shutdown handling
  const stopBot = async () => {
    console.log('\nStopping bot...');
    schedulerService.stop();
    bot.stop();
    db.close();
    process.exit(0);
  };

  process.once('SIGINT', stopBot);
  process.once('SIGTERM', stopBot);

  console.log(`Authorized Telegram User ID: ${env.ALLOWED_TELEGRAM_USER_ID}`);
  console.log('Bot is now listening for incoming messages.');

  await bot.start({
    onStart: async (botInfo) => {
      console.log(`Bot started successfully as @${botInfo.username}`);
      await setupBotCommands(bot);
      schedulerService.start(bot);
      console.log('Automated reminder scheduler started.');
    },
  });
}

main().catch((error) => {
  console.error('Fatal initialization error:', error);
  process.exit(1);
});
