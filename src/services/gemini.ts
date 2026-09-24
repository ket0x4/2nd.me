import { GoogleGenAI } from '@google/genai';
import { env } from '../config/env';
import { withRetry } from '../utils/retry';

class GeminiService {
  private ai: GoogleGenAI;

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  }

  public async createEmbedding(text: string): Promise<Float32Array> {
    const trimmed = text.trim();
    if (!trimmed) {
      return new Float32Array(768);
    }

    return await withRetry(async () => {
      try {
        const response = await this.ai.models.embedContent({
          model: 'gemini-embedding-2',
          contents: trimmed,
          config: {
            outputDimensionality: 768,
          },
        });

        const values = response.embeddings?.[0]?.values;
        if (!values || values.length === 0) {
          throw new Error('Received empty embedding from Gemini API');
        }

        return new Float32Array(values);
      } catch (error: unknown) {
        const err = error as { status?: number; message?: string };
        if (err?.status === 503 || /high demand|unavailable/i.test(err?.message ?? '')) {
          console.warn('gemini-embedding-2 busy, falling back to gemini-embedding-001');
          const fallbackResp = await this.ai.models.embedContent({
            model: 'gemini-embedding-001',
            contents: trimmed,
            config: {
              outputDimensionality: 768,
            },
          });
          const fbValues = fallbackResp.embeddings?.[0]?.values;
          if (fbValues && fbValues.length > 0) {
            return new Float32Array(fbValues);
          }
        }
        throw error;
      }
    });
  }

  private async transcribeSpecialized(fileUri: string, mimeType: string): Promise<string> {
    return await withRetry(
      async () => {
        const interaction = await this.ai.interactions.create({
          model: 'gemini-3.5-transcribe',
          input: [
            {
              type: 'audio',
              uri: fileUri,
              mime_type: mimeType,
            },
          ],
          generation_config: {
            transcription_config: {
              mode: 'smart',
            },
          },
        });

        if (interaction.output_text && interaction.output_text.trim().length > 0) {
          return interaction.output_text.trim();
        }
        throw new Error('Empty transcript received from gemini-3.5-transcribe');
      },
      { maxRetries: 2, initialDelayMs: 1200 },
    );
  }

  private async transcribeWithModel(
    fileUri: string,
    mimeType: string,
    model: string,
    instruction: string,
    retries = 2,
  ): Promise<string> {
    return await withRetry(
      async () => {
        const response = await this.ai.models.generateContent({
          model,
          contents: [
            {
              role: 'user',
              parts: [
                {
                  fileData: {
                    fileUri,
                    mimeType,
                  },
                },
                { text: instruction },
              ],
            },
          ],
        });

        return response.text?.trim() ?? '';
      },
      { maxRetries: retries, initialDelayMs: 1500 },
    );
  }

  public async transcribeAudio(filePath: string, mimeType: string): Promise<string> {
    const uploaded = await withRetry(async () => {
      return await this.ai.files.upload({
        file: filePath,
        config: { mimeType },
      });
    });

    if (!uploaded.uri) {
      throw new Error('File upload failed to return a valid URI');
    }

    const fileUri = uploaded.uri;
    const resolvedMime = uploaded.mimeType ?? mimeType;

    try {
      // Stage 1: Specialized gemini-3.5-transcribe with smart mode
      try {
        const transcript = await this.transcribeSpecialized(fileUri, resolvedMime);
        if (transcript) return transcript;
      } catch (err) {
        console.warn('Specialized transcription unavailable, falling back to flash:', err);
      }

      // Stage 2: Multimodal audio understanding via DEFAULT_MODEL (gemini-3.5-flash-lite)
      const prompt =
        'Transcribe this voice recording accurately. Remove verbal fillers (um, uh, like), fix self-corrections, and format it clearly into sentences, paragraphs, or bullet points if applicable.';

      try {
        const transcript = await this.transcribeWithModel(
          fileUri,
          resolvedMime,
          env.DEFAULT_MODEL,
          prompt,
          2,
        );
        if (transcript) return transcript;
      } catch (err) {
        console.warn(
          `${env.DEFAULT_MODEL} unavailable, falling back to ${env.FALLBACK_MODEL}:`,
          err,
        );
      }

      // Stage 3: Cascade fallback to FALLBACK_MODEL
      return await this.transcribeWithModel(fileUri, resolvedMime, env.FALLBACK_MODEL, prompt, 2);
    } finally {
      if (uploaded.name) {
        await this.ai.files.delete({ name: uploaded.name }).catch(() => {});
      }
    }
  }

  private async generateWithMultimodalInline(
    buffer: Buffer,
    mimeType: string,
    prompt: string,
    label: string,
  ): Promise<string> {
    const parts = [
      {
        inlineData: {
          data: buffer.toString('base64'),
          mimeType,
        },
      },
      { text: prompt },
    ];

    return await withRetry(async () => {
      try {
        const response = await this.ai.models.generateContent({
          model: env.DEFAULT_MODEL,
          contents: [{ role: 'user', parts }],
        });

        return response.text?.trim() ?? '';
      } catch (err: unknown) {
        const error = err as { status?: number; message?: string };
        if (error?.status === 503 || /high demand|unavailable/i.test(error?.message ?? '')) {
          console.warn(
            `${env.DEFAULT_MODEL} busy for ${label}, falling back to ${env.FALLBACK_MODEL}`,
          );
          const response = await this.ai.models.generateContent({
            model: env.FALLBACK_MODEL,
            contents: [{ role: 'user', parts }],
          });
          return response.text?.trim() ?? '';
        }
        throw err;
      }
    });
  }

  public async analyzeImage(
    imageBuffer: Buffer,
    mimeType: string,
    caption?: string,
  ): Promise<string> {
    const prompt = [
      'You are an expert multimodal information extraction assistant for a personal second brain.',
      'Analyze this image thoroughly:',
      '1. OCR: Extract all readable text, signs, labels, numbers, and dates.',
      '2. Content: Describe in clear detail what is shown (e.g. document, handwritten note, diagram, receipt, whiteboard, screenshot, or scene).',
      '3. Structure: If there are tables, items, prices, or lists, organize them clearly.',
      '4. Summary: Provide key takeaways.',
      caption ? `User provided note/caption: "${caption}"` : '',
      'Be precise, factual, and omit fluff.',
    ]
      .filter(Boolean)
      .join('\n');

    return this.generateWithMultimodalInline(imageBuffer, mimeType, prompt, 'image');
  }

  public async analyzeDocument(
    docBuffer: Buffer,
    mimeType: string,
    filename?: string,
    caption?: string,
  ): Promise<string> {
    const prompt = [
      'You are an expert document analysis assistant for a personal second brain.',
      'Analyze this document thoroughly:',
      `Filename: ${filename ?? 'unknown'}`,
      caption ? `User caption: "${caption}"` : '',
      '1. Extract all key information, main topics, and essential details.',
      '2. Outline key facts, dates, action items, or data tables.',
      '3. Provide a clear, comprehensive summary suitable for future search and retrieval.',
    ]
      .filter(Boolean)
      .join('\n');

    return this.generateWithMultimodalInline(docBuffer, mimeType, prompt, 'document');
  }
}

export const geminiService = new GeminiService();
