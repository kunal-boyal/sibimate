/** The two OpenAI calls Sibimate makes, over plain HTTPS. */

const BASE_URL = 'https://api.openai.com/v1';
const TIMEOUT_MS = 20_000;

export interface OpenAiOptions {
  apiKey: string;
  /** Replaced in tests. */
  fetch?: typeof fetch;
}

interface ResponsesBody {
  status?: string;
  output?: { type: string; content?: { type: string; text?: string; refusal?: string }[] }[];
}

/** Thrown when the model declines to answer for safety reasons. */
export class OpenAiRefusal extends Error {}

export class OpenAiClient {
  private readonly doFetch: typeof fetch;

  constructor(private readonly options: OpenAiOptions) {
    this.doFetch = options.fetch ?? fetch;
  }

  /** Asks a model for an answer that follows `schema` (Structured Outputs, strict). */
  async structured(request: {
    model: string;
    instructions: string;
    input: string;
    schemaName: string;
    schema: Record<string, unknown>;
  }): Promise<unknown> {
    const response = await this.doFetch(`${BASE_URL}/responses`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.options.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: request.model,
        input: [
          { role: 'system', content: request.instructions },
          { role: 'user', content: request.input },
        ],
        text: { format: { type: 'json_schema', name: request.schemaName, schema: request.schema, strict: true } },
        // Customers' words are not kept by the provider beyond the request.
        store: false,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await this.read(response)) as ResponsesBody;

    const parts = (body.output ?? []).flatMap((item) => (item.type === 'message' ? (item.content ?? []) : []));
    const refusal = parts.find((part) => part.type === 'refusal');
    if (refusal) {
      throw new OpenAiRefusal(refusal.refusal ?? 'The model refused the request');
    }
    const text = parts.find((part) => part.type === 'output_text')?.text;
    if (body.status !== 'completed' || !text) {
      throw new Error(`OpenAI response was ${body.status ?? 'empty'}`);
    }
    return JSON.parse(text);
  }

  /** Transcribes a short recording in its original language. */
  async transcribe(request: {
    model: string;
    audio: Buffer;
    mimeType: string;
    filename: string;
    languages: string[];
    prompt: string;
  }): Promise<string> {
    const form = new FormData();
    form.append('model', request.model);
    form.append('file', new Blob([new Uint8Array(request.audio)], { type: request.mimeType }), request.filename);
    form.append('prompt', request.prompt);
    for (const language of request.languages) {
      form.append('languages[]', language);
    }
    const response = await this.doFetch(`${BASE_URL}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.options.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await this.read(response)) as { text?: unknown };
    if (typeof body.text !== 'string') {
      throw new Error('OpenAI transcription had no text');
    }
    return body.text.trim();
  }

  private async read(response: Response): Promise<unknown> {
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      throw new Error(`OpenAI answered ${response.status}: ${detail}`);
    }
    return response.json();
  }
}
