import type { Bot } from 'grammy';
import { buildReminderNotificationView } from '../bot/views';
import { env } from '../config/env';
import { memoryRepository } from '../db/repository';

class SchedulerService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private bot: Bot | null = null;
  private isProcessing = false;

  public start(bot: Bot): void {
    if (this.timer) {
      return;
    }

    this.bot = bot;
    void this.processDueReminders();
    this.timer = setInterval(() => {
      void this.processDueReminders();
    }, 30_000);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.bot = null;
  }

  public async processDueReminders(): Promise<void> {
    if (!this.bot || this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    try {
      const now = Date.now();
      const dueReminders = memoryRepository.listDueReminders(now, 10);

      for (const reminder of dueReminders) {
        const memory = reminder.memoryId ? memoryRepository.getMemoryById(reminder.memoryId) : null;
        const view = buildReminderNotificationView(reminder, memory);

        try {
          await this.bot.api.sendMessage(env.ALLOWED_TELEGRAM_USER_ID, view.text, {
            parse_mode: 'HTML',
            reply_markup: view.replyMarkup,
          });
          memoryRepository.markReminderNotified(reminder.id);
        } catch (error) {
          console.error(
            `Failed to send reminder notification for reminder ID ${reminder.id}:`,
            error,
          );
        }
      }
    } catch (error) {
      console.error('Error during scheduled reminder processing:', error);
    } finally {
      this.isProcessing = false;
    }
  }
}

export const schedulerService = new SchedulerService();
