import type { Context } from 'grammy';
import { agentService } from '../../services/agent';
import { geminiService } from '../../services/gemini';
import { storageService } from '../../services/storage';
import { handleBotError } from '../utils/error';
import { sendModernMessage } from '../utils/format';
import { downloadTelegramFile } from '../utils/telegram';
import { buildMediaKeyboard } from '../views';

export async function handleDocumentMessage(ctx: Context): Promise<void> {
  const document = ctx.message?.document;
  if (!document) {
    return;
  }

  await ctx.replyWithChatAction('upload_document');

  try {
    const { buffer } = await downloadTelegramFile(ctx);
    const originalName = document.file_name || `${document.file_unique_id}.bin`;
    const mimeType = document.mime_type || 'application/octet-stream';

    const relativePath = await storageService.saveMedia('docs', originalName, buffer);

    await ctx.replyWithChatAction('typing');

    const caption = ctx.message?.caption;
    const analysis = await geminiService.analyzeDocument(buffer, mimeType, originalName, caption);

    const userPrompt = [
      `The user submitted a document: "${originalName}" (${mimeType}).`,
      `Document Analysis & Key Insights:\n${analysis}`,
      caption ? `User caption: ${caption}` : '',
      'Save this information as a new memory. Provide a concise, elegant confirmation detailing Title, Summary, Tags, and an expandable blockquote for the key insights.',
    ]
      .filter(Boolean)
      .join('\n\n');

    const agentReply = await agentService.handleUserMessage(userPrompt, {
      modality: 'document',
      filePath: relativePath,
    });

    await sendModernMessage(ctx, agentReply, { replyMarkup: buildMediaKeyboard() });
  } catch (error: unknown) {
    await handleBotError(ctx, error, 'doküman');
  }
}
