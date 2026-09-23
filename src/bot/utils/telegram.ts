import type { Context } from 'grammy';
import type { File as TelegramFile } from 'grammy/types';
import { env } from '../../config/env';

export async function downloadTelegramFile(
  ctx: Context,
): Promise<{ buffer: Buffer; file: TelegramFile }> {
  const file = await ctx.getFile();
  if (!file.file_path) {
    throw new Error('Telegram did not return a valid file path');
  }

  const url = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download file from Telegram: ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return { buffer, file };
}
