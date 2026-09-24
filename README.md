# 2nd.me

A fast, type-safe, autonomous personal second brain Telegram bot built with **Bun**, **SQLite Hybrid Search**, and the **Google Gemini API**.

---

## ⚡ Features

- **Multimodal Capture**: Ingest voice notes, images/photos (OCR), and documents (PDF, text) with smart summarization and tagging.
- **Hybrid Search**: Combines SQLite FTS5 (BM25 keyword search) with 768-dimensional dense vector embeddings (`gemini-embedding-2`) using Reciprocal Rank Fusion (RRF).
- **Autonomous Agent**: Powered by `gemini-3.5-flash-lite` (with `gemma-4-31b-it` fallback) using function calling to save, retrieve, update, and manage memories.
- **Proactive Reminders**: Automatically detects deadlines and actionable tasks, scheduling reminders with snooze and completion controls.
- **Sliding Context**: Keeps immediate conversational flow fresh while querying long-term memories when relevant.
- **Private & Local**: Single-user Telegram whitelist; all media and SQLite database files remain on your local disk.

---

## 🚀 Quickstart

### Prerequisites
- [Bun](https://bun.sh) (v1.1+)
- Telegram Bot Token ([@BotFather](https://t.me/BotFather))
- Your Numeric Telegram User ID ([@userinfobot](https://t.me/userinfobot))
- Google Gemini API Key ([Google AI Studio](https://aistudio.google.com/))

### Setup
```bash
# 1. Install dependencies
bun install

# 2. Configure environment
cp .env.example .env
```

Fill in your `.env` credentials:
```env
TELEGRAM_BOT_TOKEN=your_bot_token
ALLOWED_TELEGRAM_USER_ID=your_numeric_user_id
GEMINI_API_KEY=your_gemini_api_key
DEFAULT_MODEL=gemini-3.5-flash-lite
FALLBACK_MODEL=gemma-4-31b-it
```

```bash
# 3. Start development server
bun run dev
```

---

## 💬 Bot Commands

| Command | Description |
| :--- | :--- |
| `/start` | Open dashboard and main navigation |
| `/search <query>` | Hybrid search across all memories (BM25 + Vector) |
| `/reminders` | View, complete, or snooze active reminders |
| `/recent [n]` | Display latest saved memories |
| `/stats` | View repository metrics, top tags, and modality breakdown |
| `/clear_context` | Reset active conversation context |
| `/help` | List available commands |

> Send any voice recording, image, or document directly to the bot to automatically transcribe, analyze, and index it into your second brain.

---

## 🧪 Quality & Verification

Every change is verified against strict linting, type safety, test coverage, and dead code checks:

```bash
bun run verify
```
