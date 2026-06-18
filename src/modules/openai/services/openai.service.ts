import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  stream?: boolean;
}

export interface EmbeddingOptions {
  model?: string;
}

export interface TranscriptionOptions {
  language?: string;
  prompt?: string;
}

@Injectable()
export class OpenAIService {
  private readonly logger = new Logger(OpenAIService.name);
  private readonly client: OpenAI;

  constructor(private readonly config: ConfigService) {
    this.client = new OpenAI({
      apiKey: config.get<string>('OPENAI_API_KEY'),
    });
  }

  // ─── Chat Completions ─────────────────────────────────────────────────────

  async chat(
    messages: ChatMessage[],
    options: CompletionOptions = {},
  ): Promise<string> {
    const {
      model = 'gpt-4o-mini',
      temperature = 0.7,
      maxTokens = 2048,
      systemPrompt,
    } = options;

    const allMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
      ...messages,
    ];

    const response = await this.client.chat.completions.create({
      model,
      messages: allMessages,
      temperature,
      max_tokens: maxTokens,
    });

    return response.choices[0]?.message?.content ?? '';
  }

  async chatWithHistory(
    userMessage: string,
    history: ChatMessage[] = [],
    options: CompletionOptions = {},
  ): Promise<{ reply: string; updatedHistory: ChatMessage[] }> {
    const messages: ChatMessage[] = [
      ...history,
      { role: 'user', content: userMessage },
    ];

    const reply = await this.chat(messages, options);

    return {
      reply,
      updatedHistory: [...messages, { role: 'assistant', content: reply }],
    };
  }

  // ─── Streaming ────────────────────────────────────────────────────────────

  async *chatStream(
    messages: ChatMessage[],
    options: CompletionOptions = {},
  ): AsyncGenerator<string> {
    const { model = 'gpt-4o-mini', temperature = 0.7, systemPrompt } = options;

    const allMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
      ...messages,
    ];

    const stream = await this.client.chat.completions.create({
      model,
      messages: allMessages,
      temperature,
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) yield content;
    }
  }

  // ─── Embeddings ───────────────────────────────────────────────────────────

  async embed(text: string, options: EmbeddingOptions = {}): Promise<number[]> {
    const { model = 'text-embedding-3-small' } = options;

    const response = await this.client.embeddings.create({
      model,
      input: text,
    });

    return response.data[0].embedding;
  }

  async embedMany(texts: string[], options: EmbeddingOptions = {}): Promise<number[][]> {
    const { model = 'text-embedding-3-small' } = options;

    const response = await this.client.embeddings.create({
      model,
      input: texts,
    });

    return response.data.map((d) => d.embedding);
  }

  cosineSimilarity(a: number[], b: number[]): number {
    const dot = a.reduce((sum, val, i) => sum + val * b[i], 0);
    const magA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
    const magB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
    return dot / (magA * magB);
  }

  // ─── Image Generation ─────────────────────────────────────────────────────

  async generateImage(
    prompt: string,
    options: { size?: '256x256' | '512x512' | '1024x1024' | '1792x1024' | '1024x1792'; quality?: 'standard' | 'hd'; n?: number } = {},
  ): Promise<string[]> {
    const { size = '1024x1024', quality = 'standard', n = 1 } = options;

    const response = await this.client.images.generate({
      model: 'dall-e-3',
      prompt,
      size,
      quality,
      n,
    });

    return response.data.map((img) => img.url ?? img.b64_json);
  }

  // ─── Vision (Image Analysis) ──────────────────────────────────────────────

  async analyzeImage(imageUrl: string, prompt: string): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: imageUrl } },
            { type: 'text', text: prompt },
          ],
        },
      ],
      max_tokens: 1024,
    });

    return response.choices[0]?.message?.content ?? '';
  }

  // ─── Audio Transcription ──────────────────────────────────────────────────

  async transcribe(audioBuffer: Buffer, filename: string, options: TranscriptionOptions = {}): Promise<string> {
    const file = new File([audioBuffer as unknown as ArrayBuffer], filename, { type: 'audio/mpeg' });

    const response = await this.client.audio.transcriptions.create({
      model: 'whisper-1',
      file,
      language: options.language,
      prompt: options.prompt,
    });

    return response.text;
  }

  // ─── Text-to-Speech ───────────────────────────────────────────────────────

  async textToSpeech(
    text: string,
    options: { voice?: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer'; speed?: number } = {},
  ): Promise<Buffer> {
    const { voice = 'nova', speed = 1.0 } = options;

    const response = await this.client.audio.speech.create({
      model: 'tts-1',
      input: text,
      voice,
      speed,
    });

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  // ─── Structured Output (JSON Mode) ────────────────────────────────────────

  async extractStructured<T>(
    prompt: string,
    schema: string,
    systemPrompt?: string,
  ): Promise<T> {
    const response = await this.client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: systemPrompt || `Extract data according to this JSON schema: ${schema}. Return ONLY valid JSON.`,
        },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
    });

    return JSON.parse(response.choices[0]?.message?.content ?? '{}') as T;
  }

  // ─── Moderation ───────────────────────────────────────────────────────────

  async moderate(text: string): Promise<{ flagged: boolean; categories: Record<string, boolean> }> {
    const response = await this.client.moderations.create({ input: text });
    const result = response.results[0];
    return {
      flagged: result.flagged,
      categories: result.categories as any,
    };
  }
}
