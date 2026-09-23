import type { Context } from 'grammy';
import { agentService } from '../../services/agent';
import { geminiService } from '../../services/gemini';
import { storageService } from '../../services/storage';
import { handleBotError } from '../utils/error';
import { sendModernMessage } from '../utils/format';
import { downloadTelegramFile } from '../utils/telegram';
import { buildMediaKeyboard } from '../views';

export async function handlePhotoMessage(ctx: Context): Promise<void> {
  const photos = ctx.message?.photo;
  if (!photos || photos.length === 0) {
    return;
  }

  const photo = photos[photos.length - 1];
  if (!photo) {
    return;
  }

  await ctx.replyWithChatAction('upload_photo');

  try {
    const { buffer } = await downloadTelegramFile(ctx);
    const filename = `${photo.file_unique_id}.jpg`;
    const relativePath = await storageService.saveMedia('images', filename, buffer);

    await ctx.replyWithChatAction('typing');

    const caption = ctx.message?.caption;
    const analysis = await geminiService.analyzeImage(buffer, 'image/jpeg', caption);

    const userPrompt = [
      'The user submitted an image or photo.',
      `Visual Analysis & OCR:\n${analysis}`,
      caption ? `User caption: ${caption}` : '',
      'Save this information as a new memory. Provide a concise, elegant confirmation detailing Title, Summary, Tags, and an expandable blockquote for the visual breakdown or OCR text.',
    ]
      .filter(Boolean)
      .join('\n\n');

    const agentReply = await agentService.handleUserMessage(userPrompt, {
      modality: 'image',
      filePath: relativePath,
    });

    await sendModernMessage(ctx, agentReply, { replyMarkup: buildMediaKeyboard() });
  } catch (error: unknown) {
    await handleBotError(ctx, error, 'fotoğraf / görsel');
  }
}
