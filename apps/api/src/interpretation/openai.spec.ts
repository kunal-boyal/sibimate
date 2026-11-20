import { interpreterOutputSchema } from '@sibimate/shared';
import { OpenAiTaskInterpreter } from './openai-task-interpreter.js';
import { OpenAiClient } from './openai.client.js';
import { OpenAiSpeechToText } from './speech-to-text.js';

const DETAILS = {
  title: 'Carry two suitcases',
  description: 'Carry two suitcases from Mansarovar metro station to a home nearby.',
  categorySlug: 'carry-luggage',
  proposedCategory: null,
  requiresSkilled: false,
  helpersNeeded: 1,
  estimatedMinutes: { min: 30, max: 45 },
  requirements: [],
  riskFlags: [],
  followUpQuestion: null,
  confidence: 0.92,
};

const INPUT = {
  text: 'carry two suitcases, call [phone]',
  language: 'en' as const,
  categories: [
    { slug: 'carry-luggage', name: 'Carrying and luggage', requiresSkilled: false },
    { slug: 'plumbing', name: 'Plumbing', requiresSkilled: true },
  ],
};

function setup(response: Response) {
  const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => response);
  const client = new OpenAiClient({ apiKey: 'sk-test', fetch: fetchMock as typeof fetch });
  return { client, fetchMock };
}

const message = (content: object[], status = 'completed') =>
  new Response(JSON.stringify({ status, output: [{ type: 'reasoning' }, { type: 'message', content }] }));

describe('OpenAiTaskInterpreter', () => {
  it('asks for a strict JSON answer and returns it', async () => {
    const { client, fetchMock } = setup(message([{ type: 'output_text', text: JSON.stringify(DETAILS) }]));
    const output = await new OpenAiTaskInterpreter(client, 'gpt-test').interpret(INPUT);
    expect(interpreterOutputSchema.parse(output)).toEqual(DETAILS);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    const body = JSON.parse(init!.body as string);
    expect(body).toMatchObject({
      model: 'gpt-test',
      store: false,
      text: { format: { type: 'json_schema', name: 'task_details', strict: true } },
    });
    expect(body.input[1].content).toContain('- plumbing: Plumbing (skilled)');
    expect(body.input[1].content).toContain('carry two suitcases, call [phone]');
    // Strict mode needs every property listed as required.
    const { schema } = body.text.format;
    expect(schema.required.sort()).toEqual(Object.keys(schema.properties).sort());
  });

  it('turns a model refusal into a blocked request', async () => {
    const { client } = setup(message([{ type: 'refusal', refusal: 'I cannot help with that.' }]));
    const output = await new OpenAiTaskInterpreter(client, 'gpt-test').interpret(INPUT);
    expect(interpreterOutputSchema.parse(output).riskFlags).toEqual(['unsafe']);
  });

  it.each([
    ['an error status', new Response('{"error":{"message":"bad key"}}', { status: 401 })],
    ['an incomplete answer', message([{ type: 'output_text', text: '{"title":' }], 'incomplete')],
    ['text that is not JSON', message([{ type: 'output_text', text: 'Sure! Here you go' }])],
  ])('throws on %s, so the customer gets the typed form', async (_name, response) => {
    const { client } = setup(response);
    await expect(new OpenAiTaskInterpreter(client, 'gpt-test').interpret(INPUT)).rejects.toThrow();
  });
});

describe('OpenAiSpeechToText', () => {
  it('sends the recording with Hindi and English hints and returns the text', async () => {
    const { client, fetchMock } = setup(new Response(JSON.stringify({ text: ' मुझे दो सूटकेस उठवाने हैं ', languages: [] })));
    const text = await new OpenAiSpeechToText(client, 'gpt-transcribe').transcribe({
      audio: Buffer.from('audio-bytes'),
      mimeType: 'audio/mp4',
      filename: 'task.m4a',
    });
    expect(text).toBe('मुझे दो सूटकेस उठवाने हैं');

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions');
    const form = init!.body as FormData;
    expect(form.get('model')).toBe('gpt-transcribe');
    expect(form.getAll('languages[]')).toEqual(['hi', 'en']);
    const file = form.get('file') as File;
    expect([file.name, file.type, await file.text()]).toEqual(['task.m4a', 'audio/mp4', 'audio-bytes']);
  });

  it('throws when the provider fails', async () => {
    const { client } = setup(new Response('rate limited', { status: 429 }));
    const speech = new OpenAiSpeechToText(client, 'gpt-transcribe');
    await expect(
      speech.transcribe({ audio: Buffer.from('x'), mimeType: 'audio/mp4', filename: 'a.m4a' }),
    ).rejects.toThrow(/429/);
  });
});
