import type { Context } from 'grammy';
import { agentService } from '../../services/agent';
import { geminiService } from '../../services/gemini';
import { storageService } from '../../services/storage';
import { handleBotError } from '../utils/error';
import { sendModernMessage } from '../utils/format';
import { downloadTelegramFile } from '../utils/telegram';
import { buildMediaKeyboard } from '../views';

function resolveAudioExtension(mimeType: string): string {
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('mp3')) return 'mp3';
  if (mimeType.includes('m4a')) return 'm4a';
  return 'ogg';
}

export async function handleVoiceMessage(ctx: Context): Promise<void> {
  const voice = ctx.message?.voice;
  const audio = ctx.message?.audio;
  const target = voice ?? audio;

  if (!target) {
    return;
  }

  await ctx.replyWithChatAction('record_voice');

  try {
    const { buffer } = await downloadTelegramFile(ctx);
    const mimeType = target.mime_type || (voice ? 'audio/ogg' : 'audio/mp3');
    const extension = resolveAudioExtension(mimeType);
    const filename = `${target.file_unique_id}.${extension}`;

    const relativePath = await storageService.saveMedia('audio', filename, buffer);
    const fullPath = storageService.getFullPath(relativePath);

    await ctx.replyWithChatAction('typing');

    const transcript = await geminiService.transcribeAudio(fullPath, mimeType);
    if (!transcript || transcript.trim().length === 0) {
      await sendModernMessage(
        ctx,
        '🎙️ <b>Ses İşlendi</b>\nSes dosyası alındı ancak transkript edilebilir net bir konuşma tespit edilemedi. Lütfen daha net bir kayıt deneyin.',
      );
      return;
    }

    const caption = ctx.message?.caption ? `\nUser caption: ${ctx.message.caption}` : '';
    const userPrompt = [
      'The user submitted a voice recording.',
      `Clean Transcript:\n"${transcript}"${caption}`,
      'Save this information as a new memory. Provide a concise, elegant confirmation with the Title, Summary, Tags, and an expandable blockquote for the transcript.',
    ].join('\n\n');

    const agentReply = await agentService.handleUserMessage(userPrompt, {
      modality: 'voice',
      filePath: relativePath,
    });

    await sendModernMessage(ctx, agentReply, { replyMarkup: buildMediaKeyboard() });
  } catch (error: unknown) {
    await handleBotError(ctx, error, 'ses kaydı');
  }
}
