import type { Context } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { sendModernMessage } from './format';

export async function handleBotError(
  ctx: Context,
  error: unknown,
  contextLabel: string,
): Promise<void> {
  console.error(`Error handling ${contextLabel}:`, error);
  const err = error as { status?: number; message?: string };
  const isHighDemand =
    err?.status === 503 ||
    err?.status === 429 ||
    /high demand|unavailable|resource_exhausted/i.test(err?.message ?? '');

  const keyboard = new InlineKeyboard().text('🏠 Ana Menü', 'nav:start');

  if (isHighDemand) {
    await sendModernMessage(
      ctx,
      '⏳ <b>Yapay Zeka Servisi Meşgul</b>\nGemini API şu anda yoğun talep altında (503/429). Lütfen birkaç saniye bekleyip tekrar deneyin.',
      { replyMarkup: keyboard },
    );
  } else {
    await sendModernMessage(
      ctx,
      `⚠️ <b>İşlem Sırasında Hata Oluştu</b>\n${contextLabel} işlenirken bir sorun meydana geldi. Lütfen tekrar deneyin.`,
      { replyMarkup: keyboard },
    );
  }
}
