import type { Context, NextFunction } from 'grammy';
import { env } from '../../config/env';

export async function authGuard(ctx: Context, next: NextFunction): Promise<void> {
  const userId = ctx.from?.id;

  if (!userId || userId !== env.ALLOWED_TELEGRAM_USER_ID) {
    console.warn(`Unauthorized access attempt from user ID: ${userId ?? 'unknown'}`);
    // Silently drop unauthorized requests for security
    return;
  }

  await next();
}
