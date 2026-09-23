import type { Context } from 'grammy';
import { agentService } from '../../services/agent';
import { handleBotError } from '../utils/error';
import { sendModernMessage } from '../utils/format';

export async function handleTextMessage(ctx: Context): Promise<void> {
  const text = ctx.message?.text?.trim();
  if (!text) {
    return;
  }

  await ctx.replyWithChatAction('typing');

  try {
    const response = await agentService.handleUserMessage(text, { modality: 'text' });
    await sendModernMessage(ctx, response);
  } catch (error: unknown) {
    await handleBotError(ctx, error, 'metin mesajı');
  }
}
