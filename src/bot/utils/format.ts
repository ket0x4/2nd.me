import type { Context } from 'grammy';
import type { InlineKeyboard } from 'grammy';

/**
 * Escapes characters that have special meaning in Telegram HTML.
 */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Generates an aesthetic text progress bar (e.g. [██████░░░░] 60%).
 */
export function formatProgressBar(
  value: number,
  max: number,
  barLength = 8,
): { bar: string; percentage: number } {
  if (max <= 0) {
    return { bar: '░'.repeat(barLength), percentage: 0 };
  }
  const ratio = Math.min(Math.max(value / max, 0), 1);
  const percentage = Math.round(ratio * 100);
  const filled = Math.round(ratio * barLength);
  const empty = barLength - filled;
  const bar = `${'█'.repeat(filled)}${'░'.repeat(empty)}`;
  return { bar, percentage };
}

/**
 * Converts LLM Markdown output into Telegram-safe HTML.
 */
function markdownToTelegramHtml(markdown: string): string {
  if (!markdown) return '';

  // 1. Placeholder storage for code blocks to prevent nested markdown parsing
  const codeBlocks: string[] = [];
  const inlineCodes: string[] = [];

  // Replace multi-line code blocks: ```lang ... ```
  let processed = markdown.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const escapedCode = escapeHtml(code.trimEnd());
    const placeholder = `@@@CODE_BLOCK_${codeBlocks.length}@@@`;
    if (lang) {
      codeBlocks.push(
        `<pre><code class="language-${escapeHtml(lang)}">${escapedCode}</code></pre>`,
      );
    } else {
      codeBlocks.push(`<pre><code>${escapedCode}</code></pre>`);
    }
    return placeholder;
  });

  // Replace inline code: `...`
  processed = processed.replace(/`([^`\n]+)`/g, (_, code) => {
    const escapedCode = escapeHtml(code);
    const placeholder = `@@@INLINE_CODE_${inlineCodes.length}@@@`;
    inlineCodes.push(`<code>${escapedCode}</code>`);
    return placeholder;
  });

  // 2. Escape any raw HTML characters in the remaining text
  processed = escapeHtml(processed);

  // 3. Convert Markdown headers
  // # Header -> <b>HEADER</b>
  processed = processed.replace(/^#\s+(.+)$/gm, '<b>$1</b>\n');
  // ## Header or ### Header -> <b>Header</b>
  processed = processed.replace(/^#{2,6}\s+(.+)$/gm, '<b>$1</b>');

  // 4. Convert bold: **bold** or __bold__
  processed = processed.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  processed = processed.replace(/__([^_]+)__/g, '<b>$1</b>');

  // 5. Convert italic: *italic* or _italic_ (avoid matching inside identifiers)
  processed = processed.replace(/(^|[^\w*])\*([^*]+)\*([^\w*]|$)/g, '$1<i>$2</i>$3');
  processed = processed.replace(/(^|[^\w_])_([^_]+)_([^\w_]|$)/g, '$1<i>$2</i>$3');

  // 6. Convert strikethrough: ~~text~~
  processed = processed.replace(/~~([^~]+)~~/g, '<s>$1</s>');

  // 7. Convert links: [text](url)
  processed = processed.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');

  // 8. Convert bullet points: - item or * item
  processed = processed.replace(/^[*\\-]\s+(.+)$/gm, '• $1');

  // 9. Convert blockquotes: > quote
  // Group consecutive blockquote lines into a single <blockquote>
  processed = processed.replace(/(^&gt;\s*.+(\n&gt;\s*.*)*)/gm, (match) => {
    const cleaned = match
      .split('\n')
      .map((line) => line.replace(/^&gt;\s?/, ''))
      .join('\n');
    return `<blockquote>${cleaned}</blockquote>`;
  });

  // 10. Restore code blocks & inline code
  for (let i = 0; i < codeBlocks.length; i++) {
    const codeBlock = codeBlocks[i];
    if (codeBlock !== undefined) {
      processed = processed.replace(`@@@CODE_BLOCK_${i}@@@`, codeBlock);
    }
  }
  for (let i = 0; i < inlineCodes.length; i++) {
    const inlineCode = inlineCodes[i];
    if (inlineCode !== undefined) {
      processed = processed.replace(`@@@INLINE_CODE_${i}@@@`, inlineCode);
    }
  }

  return processed.trim();
}

/**
 * Splits a long text into chunks smaller than Telegram's 4096 character limit,
 * taking care not to split in the middle of words or lines.
 */
function splitMessageChunks(text: string, maxLength = 4000): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try splitting by double newline (paragraphs)
    let splitIndex = remaining.lastIndexOf('\n\n', maxLength);

    // If no paragraph break, try single newline
    if (splitIndex <= 0) {
      splitIndex = remaining.lastIndexOf('\n', maxLength);
    }

    // If no newline, try space
    if (splitIndex <= 0) {
      splitIndex = remaining.lastIndexOf(' ', maxLength);
    }

    // Fallback: hard cut
    if (splitIndex <= 0) {
      splitIndex = maxLength;
    }

    const chunk = remaining.substring(0, splitIndex).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }
    remaining = remaining.substring(splitIndex).trim();
  }

  return chunks;
}

interface SendModernOptions {
  replyMarkup?: InlineKeyboard;
  disablePreview?: boolean;
}

/**
 * Sends a message formatted with Telegram HTML.
 * Splits chunks appropriately and includes automatic fallback to plain text
 * if Telegram rejects HTML entities.
 */
export async function sendModernMessage(
  ctx: Context,
  text: string,
  options?: SendModernOptions,
): Promise<void> {
  const isHtml = text.includes('<') && text.includes('>');
  const formatted = isHtml ? text : markdownToTelegramHtml(text);
  const chunks = splitMessageChunks(formatted);

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (!chunk) continue;
    const isLastChunk = i === chunks.length - 1;
    const replyMarkup = isLastChunk ? options?.replyMarkup : undefined;

    try {
      await ctx.reply(chunk, {
        parse_mode: 'HTML',
        reply_markup: replyMarkup,
        link_preview_options: {
          is_disabled: options?.disablePreview ?? true,
        },
      });
    } catch (error: unknown) {
      console.warn(
        'Failed to send message with HTML parse_mode, falling back to plain text:',
        error,
      );
      // Strip HTML tags for fallback
      const plainText = chunk.replace(/<[^>]*>/g, '');
      await ctx.reply(plainText, {
        reply_markup: replyMarkup,
      });
    }
  }
}
