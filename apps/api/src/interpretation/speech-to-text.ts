import type { OpenAiClient } from './openai.client.js';

export interface Recording {
  audio: Buffer;
  mimeType: string;
  filename: string;
}

/**
 * Turns a customer's recording into text. The recording is held in memory for
 * the length of the request and is never written to disk or to the database.
 */
export abstract class SpeechToText {
  /** False when no provider is connected and customers should type. */
  abstract readonly available: boolean;
  abstract transcribe(recording: Recording): Promise<string>;
}

export class UnavailableSpeechToText extends SpeechToText {
  readonly available = false;

  transcribe(): Promise<string> {
    return Promise.reject(new Error('No speech-to-text provider is configured'));
  }
}

export class OpenAiSpeechToText extends SpeechToText {
  readonly available = true;

  constructor(
    private readonly client: OpenAiClient,
    private readonly model: string,
  ) {
    super();
  }

  transcribe({ audio, mimeType, filename }: Recording): Promise<string> {
    return this.client.transcribe({
      model: this.model,
      audio,
      mimeType,
      filename,
      languages: ['hi', 'en'],
      prompt:
        'A customer in India describing an everyday task they need help with, in Hindi, English or a mix of both. ' +
        'Place names are from Jaipur, such as Mansarovar, Vaishali Nagar and Malviya Nagar.',
    });
  }
}
