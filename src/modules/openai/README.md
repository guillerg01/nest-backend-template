# OpenAI Module

Chat completions, streaming, embeddings, RAG, image generation, vision, audio, function calling, and alternatives.

---

## Table of Contents

1. [Setup](#setup)
2. [Chat Completions](#chat-completions)
3. [Streaming with SSE](#streaming-with-sse)
4. [Embeddings and Semantic Search](#embeddings-and-semantic-search)
5. [RAG Pattern](#rag-pattern)
6. [Image Generation (DALL-E 3)](#image-generation)
7. [Vision (GPT-4o)](#vision)
8. [Whisper Transcription](#whisper-transcription)
9. [Text-to-Speech (TTS)](#text-to-speech)
10. [Function Calling / Tool Use](#function-calling)
11. [Structured Output (JSON Mode)](#structured-output)
12. [Moderation API](#moderation-api)
13. [Token Counting and Cost Estimation](#token-counting)
14. [Rate Limits and Error Handling](#rate-limits)
15. [Streaming via WebSocket](#streaming-via-websocket)
16. [Alternatives](#alternatives)

---

## Setup

```bash
npm install openai
```

```typescript
// openai.service.ts
import OpenAI from 'openai';

@Injectable()
export class OpenAIService {
  private openai: OpenAI;

  constructor(private configService: ConfigService) {
    this.openai = new OpenAI({
      apiKey: this.configService.get('OPENAI_API_KEY'),
      maxRetries: 3, // automatic retry on 429/500
      timeout: 60000,
    });
  }
}
```

---

## Chat Completions

### Single Turn

```typescript
async chat(prompt: string, systemPrompt?: string): Promise<string> {
  const messages: OpenAI.ChatCompletionMessageParam[] = [];

  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });

  const completion = await this.openai.chat.completions.create({
    model: 'gpt-4o',
    messages,
    max_tokens: 1000,
    temperature: 0.7, // 0 = deterministic, 1 = creative, 2 = very random
  });

  return completion.choices[0].message.content ?? '';
}
```

### Multi-Turn with History

```typescript
// history is an array of prior messages — client sends them back each time
async chatWithHistory(
  messages: OpenAI.ChatCompletionMessageParam[],
  newMessage: string,
): Promise<{ reply: string; updatedHistory: OpenAI.ChatCompletionMessageParam[] }> {
  const updatedHistory: OpenAI.ChatCompletionMessageParam[] = [
    ...messages,
    { role: 'user', content: newMessage },
  ];

  const completion = await this.openai.chat.completions.create({
    model: 'gpt-4o',
    messages: updatedHistory,
    max_tokens: 2000,
  });

  const reply = completion.choices[0].message.content ?? '';

  updatedHistory.push({ role: 'assistant', content: reply });

  return { reply, updatedHistory };
}
```

**Token limit gotcha:** GPT-4o has a 128k context window. For long conversations, implement sliding window — keep last N messages, or use summarization to compress older history.

---

## Streaming with SSE

Stream response tokens to the client as they arrive instead of waiting for the full response.

```typescript
// openai.controller.ts
@Get('stream')
@Sse()
async streamChat(
  @Query('message') message: string,
  @CurrentUser() user: User,
): Promise<Observable<MessageEvent>> {
  const stream = await this.openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: message }],
    stream: true,
  });

  return new Observable(observer => {
    (async () => {
      try {
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content ?? '';
          if (delta) {
            observer.next({ data: JSON.stringify({ delta }) } as MessageEvent);
          }
        }
        observer.next({ data: JSON.stringify({ done: true }) } as MessageEvent);
        observer.complete();
      } catch (err) {
        observer.error(err);
      }
    })();
  });
}
```

### Frontend Consumption

```typescript
// React / vanilla JS
const eventSource = new EventSource(`/openai/stream?message=${encodeURIComponent(message)}`);

let fullResponse = '';

eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);

  if (data.done) {
    eventSource.close();
    return;
  }

  fullResponse += data.delta;
  setResponse(fullResponse); // update state incrementally
};

eventSource.onerror = () => {
  eventSource.close();
};
```

---

## Embeddings and Semantic Search

Embeddings are numerical representations of text that capture semantic meaning. Similar text has similar vectors.

### Generating Embeddings

```typescript
async createEmbedding(text: string): Promise<number[]> {
  const response = await this.openai.embeddings.create({
    model: 'text-embedding-3-small', // 1536 dimensions, cheap
    // model: 'text-embedding-3-large', // 3072 dimensions, more accurate
    input: text.replace(/\n/g, ' '), // clean whitespace
  });
  return response.data[0].embedding;
}
```

### Cosine Similarity

```typescript
function cosineSimilarity(a: number[], b: number[]): number {
  const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
  const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
  return dotProduct / (magnitudeA * magnitudeB);
}
// Returns -1 to 1. Higher = more similar. Threshold ≥ 0.8 = very similar.
```

### Vector Storage

For production semantic search, store vectors in a **vector database**:

| DB | Notes |
|---|---|
| [pgvector](https://github.com/pgvector/pgvector) | PostgreSQL extension — add to your existing DB, no new infra |
| [Pinecone](https://pinecone.io) | Managed, fully hosted, great DX |
| [Weaviate](https://weaviate.io) | Open-source, rich filtering |
| [Chroma](https://www.trychroma.com) | Simple, great for prototyping |
| [Qdrant](https://qdrant.tech) | Rust-based, fast, self-hostable |

```typescript
// Using pgvector with TypeORM
// npm install pgvector

// In migration: CREATE EXTENSION IF NOT EXISTS vector;

@Entity('documents')
export class Document extends BaseEntity {
  @Column('text')
  content: string;

  @Column({ type: 'text', nullable: true }) // store as JSON string for TypeORM
  embedding: string; // JSON-serialized number[]

  async setEmbedding(vector: number[]) {
    this.embedding = JSON.stringify(vector);
  }

  getEmbedding(): number[] {
    return JSON.parse(this.embedding);
  }
}

// Similarity search with raw SQL (pgvector)
async findSimilar(queryEmbedding: number[], limit = 10): Promise<Document[]> {
  return this.documentRepo.query(
    `SELECT *, embedding <=> $1 AS distance
     FROM documents
     ORDER BY embedding <=> $1
     LIMIT $2`,
    [`[${queryEmbedding.join(',')}]`, limit],
  );
}
```

---

## RAG Pattern

Retrieval Augmented Generation: find relevant documents from your knowledge base, inject them into the prompt, let the model answer using that context.

```
User Question
     │
     ▼
1. Embed the question (text-embedding-3-small)
     │
     ▼
2. Search vector DB for similar document chunks
     │
     ▼
3. Retrieve top K most relevant chunks
     │
     ▼
4. Build prompt: system prompt + context chunks + user question
     │
     ▼
5. Send to GPT-4o → grounded, factual answer
```

```typescript
async ragQuery(question: string): Promise<string> {
  // 1. Embed the question
  const questionEmbedding = await this.createEmbedding(question);

  // 2. Find relevant chunks
  const relevantChunks = await this.documentsService.findSimilar(
    questionEmbedding,
    5 // top 5 chunks
  );

  // 3. Build context
  const context = relevantChunks
    .map((doc, i) => `[${i + 1}] ${doc.content}`)
    .join('\n\n');

  // 4. Build grounded prompt
  const messages: OpenAI.ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: `You are a helpful assistant. Answer questions based ONLY on the provided context.
If the context doesn't contain the answer, say "I don't have information about that."
Do not make up information.

Context:
${context}`,
    },
    { role: 'user', content: question },
  ];

  // 5. Get grounded answer
  const completion = await this.openai.chat.completions.create({
    model: 'gpt-4o',
    messages,
    temperature: 0, // deterministic for factual questions
  });

  return completion.choices[0].message.content ?? '';
}
```

---

## Image Generation

```typescript
async generateImage(
  prompt: string,
  size: '1024x1024' | '1792x1024' | '1024x1792' = '1024x1024',
): Promise<string> {
  const response = await this.openai.images.generate({
    model: 'dall-e-3',
    prompt,
    n: 1,
    size,
    quality: 'hd', // 'standard' for cheaper
    style: 'vivid', // 'vivid' or 'natural'
    response_format: 'url', // or 'b64_json' for base64
  });

  return response.data[0].url; // URL expires after 1 hour — download and store in S3
}
```

---

## Vision

GPT-4o can analyze images alongside text.

```typescript
async analyzeImage(imageUrl: string, question: string): Promise<string> {
  const response = await this.openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: {
              url: imageUrl,
              detail: 'high', // 'low' for cheaper/faster, 'high' for detailed analysis
            },
          },
          { type: 'text', text: question },
        ],
      },
    ],
    max_tokens: 1000,
  });

  return response.choices[0].message.content ?? '';
}

// Pass base64 image (e.g., from file upload)
async analyzeUploadedImage(
  imageBuffer: Buffer,
  mimeType: string,
  question: string,
): Promise<string> {
  const base64 = imageBuffer.toString('base64');
  return this.analyzeImage(`data:${mimeType};base64,${base64}`, question);
}
```

---

## Whisper Transcription

```typescript
async transcribeAudio(
  audioBuffer: Buffer,
  filename: string,
  language?: string, // ISO 639-1 code, e.g., 'es', 'en'. Omit for auto-detect.
): Promise<string> {
  // Whisper accepts: flac, m4a, mp3, mp4, mpeg, mpga, oga, ogg, wav, webm
  const file = new File([audioBuffer], filename, { type: 'audio/mpeg' });

  const transcription = await this.openai.audio.transcriptions.create({
    file,
    model: 'whisper-1',
    language,
    response_format: 'text', // or 'json', 'srt', 'vtt' for subtitles
  });

  return transcription;
}
```

---

## Text-to-Speech

```typescript
async textToSpeech(
  text: string,
  voice: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer' = 'nova',
): Promise<Buffer> {
  const response = await this.openai.audio.speech.create({
    model: 'tts-1', // or 'tts-1-hd' for higher quality
    voice,
    input: text,
    response_format: 'mp3', // mp3, opus, aac, flac
    speed: 1.0, // 0.25 to 4.0
  });

  // Convert to Buffer for storage or streaming
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
```

---

## Function Calling

Let the model decide when to call your functions and with what arguments. Enables AI agents.

```typescript
async chatWithTools(userMessage: string): Promise<string> {
  const tools: OpenAI.ChatCompletionTool[] = [
    {
      type: 'function',
      function: {
        name: 'get_weather',
        description: 'Get current weather for a city',
        parameters: {
          type: 'object',
          properties: {
            city: { type: 'string', description: 'City name' },
            units: { type: 'string', enum: ['celsius', 'fahrenheit'] },
          },
          required: ['city'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'create_calendar_event',
        description: 'Create a calendar event',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            date: { type: 'string', description: 'ISO 8601 date' },
            duration: { type: 'number', description: 'Duration in minutes' },
          },
          required: ['title', 'date'],
        },
      },
    },
  ];

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'user', content: userMessage },
  ];

  let response = await this.openai.chat.completions.create({
    model: 'gpt-4o',
    messages,
    tools,
    tool_choice: 'auto', // model decides when to use tools
  });

  // Agentic loop — model may call multiple tools
  while (response.choices[0].finish_reason === 'tool_calls') {
    const toolCalls = response.choices[0].message.tool_calls!;

    // Add assistant's tool call message to history
    messages.push(response.choices[0].message);

    // Execute each tool call
    for (const toolCall of toolCalls) {
      const args = JSON.parse(toolCall.function.arguments);
      let result: unknown;

      if (toolCall.function.name === 'get_weather') {
        result = await this.weatherService.getWeather(args.city, args.units);
      } else if (toolCall.function.name === 'create_calendar_event') {
        result = await this.calendarService.create(args);
      }

      // Add tool result to messages
      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      });
    }

    // Get next response (may call more tools or give final answer)
    response = await this.openai.chat.completions.create({
      model: 'gpt-4o',
      messages,
      tools,
    });
  }

  return response.choices[0].message.content ?? '';
}
```

---

## Structured Output

Force the model to return valid JSON matching a schema.

```typescript
async extractStructuredData(text: string): Promise<ExtractedData> {
  const completion = await this.openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: 'Extract structured data from the user text. Return JSON only.',
      },
      { role: 'user', content: text },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'extracted_data',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            email: { type: 'string' },
            phone: { type: 'string' },
            intent: { type: 'string', enum: ['buy', 'sell', 'rent', 'info'] },
          },
          required: ['name', 'email', 'intent'],
          additionalProperties: false,
        },
      },
    },
  });

  return JSON.parse(completion.choices[0].message.content);
}
```

---

## Moderation API

Check if content violates OpenAI's usage policies. Use before sending user content to GPT.

```typescript
async moderateContent(input: string): Promise<{ flagged: boolean; categories: string[] }> {
  const moderation = await this.openai.moderations.create({
    model: 'omni-moderation-latest',
    input,
  });

  const result = moderation.results[0];
  const flaggedCategories = Object.entries(result.categories)
    .filter(([, flagged]) => flagged)
    .map(([category]) => category);

  return {
    flagged: result.flagged,
    categories: flaggedCategories,
  };
}
```

---

## Token Counting

```bash
npm install js-tiktoken
```

```typescript
import { encoding_for_model } from 'js-tiktoken';

countTokens(text: string, model: string = 'gpt-4o'): number {
  const enc = encoding_for_model(model as any);
  const tokens = enc.encode(text);
  enc.free();
  return tokens.length;
}

estimateCost(
  inputTokens: number,
  outputTokens: number,
  model = 'gpt-4o',
): number {
  // Prices in USD per 1M tokens (verify at platform.openai.com/docs/pricing)
  const pricing: Record<string, { input: number; output: number }> = {
    'gpt-4o': { input: 2.50, output: 10.00 },
    'gpt-4o-mini': { input: 0.15, output: 0.60 },
    'gpt-4-turbo': { input: 10.00, output: 30.00 },
  };

  const p = pricing[model] ?? pricing['gpt-4o'];
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}
```

---

## Rate Limits and Error Handling

```typescript
import { APIError } from 'openai';

async chatWithRetry(
  messages: OpenAI.ChatCompletionMessageParam[],
  retries = 3,
): Promise<string> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        messages,
      });
      return completion.choices[0].message.content ?? '';

    } catch (err) {
      if (err instanceof APIError) {
        if (err.status === 429) {
          // Rate limited — exponential backoff
          const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
          this.logger.warn(`Rate limited, retrying in ${delay}ms (attempt ${attempt + 1})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        if (err.status === 503 || err.status === 500) {
          // OpenAI server error — retry
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }

        // Non-retryable errors (400 invalid request, 401 auth)
        throw err;
      }
      throw err;
    }
  }

  throw new Error('Max retries exceeded');
}
```

---

## Streaming via WebSocket

For chat UIs where the entire page uses WebSocket anyway (not SSE).

```typescript
// openai.gateway.ts
@WebSocketGateway({ namespace: '/ai' })
export class OpenAIGateway {
  constructor(private readonly openaiService: OpenAIService) {}

  @SubscribeMessage('chat-stream')
  async handleChatStream(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: { message: string; history: any[] },
  ): Promise<void> {
    const stream = await this.openaiService.createStream([
      ...dto.history,
      { role: 'user', content: dto.message },
    ]);

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? '';
      if (delta) {
        client.emit('stream-chunk', { delta });
      }
    }

    client.emit('stream-end', { done: true });
  }
}
```

---

## Alternatives

### Anthropic Claude

Best model for: code generation, long document analysis, nuanced reasoning, safe outputs.

```bash
npm install @anthropic-ai/sdk
```

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const message = await client.messages.create({
  model: 'claude-sonnet-4-5', // best balance cost/performance
  // model: 'claude-opus-4-5',   // most capable
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Explain async/await in TypeScript.' }],
});

console.log(message.content[0].text);
```

**Docs:** [docs.anthropic.com](https://docs.anthropic.com)

### Google Gemini

```bash
npm install @google/generative-ai
```

```typescript
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro' });

const result = await model.generateContent('What is TypeScript?');
```

### Ollama (Local LLMs)

Run models locally — zero API cost, full privacy. Ideal for on-premise requirements.

```bash
# Install Ollama: https://ollama.ai
ollama pull llama3.2
ollama serve  # starts HTTP API on localhost:11434
```

```typescript
// Use OpenAI-compatible API
const openai = new OpenAI({
  baseURL: 'http://localhost:11434/v1',
  apiKey: 'ollama', // not used but required by client
});

const completion = await openai.chat.completions.create({
  model: 'llama3.2',
  messages: [{ role: 'user', content: 'Hello!' }],
});
```

### LangChain (Abstraction Layer)

Use when: switching between providers, chaining operations, building agents with memory.

```bash
npm install langchain @langchain/openai @langchain/anthropic
```

**Caveat:** LangChain adds significant complexity and abstraction cost. Use it only when you genuinely need multi-provider switching or complex agent patterns.

### Decision Table

| Provider | Best For | Weakness |
|---|---|---|
| OpenAI GPT-4o | General use, vision, function calling | Cost at scale |
| OpenAI gpt-4o-mini | High volume, cost-sensitive | Less capable than 4o |
| Anthropic Claude | Code, long docs, safety | No image generation |
| Google Gemini | Google Workspace integration | Newer ecosystem |
| Ollama | Privacy, no internet, zero cost | Smaller models, requires GPU |
| LangChain | Multi-provider abstraction | Adds complexity |
