import { Injectable, Logger } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import {
  BLOCKING_RISK_FLAGS,
  type InterpreterOutput,
  type TaskCategory,
  type TaskInterpretation,
  TASK_TEXT_MAX,
  interpretRequestSchema,
  interpreterOutputSchema,
} from '@sibimate/shared';
import { and, eq } from 'drizzle-orm';
import { ApiException } from '../common/api-exception.js';
import type { Database } from '../db/db.js';
import { type TaskCategoryRow, type UserRow, taskCategories, taskInterpretations } from '../db/schema.js';
import { redactContactDetails } from './redact.js';
import { type Recording, SpeechToText } from './speech-to-text.js';
import { TaskInterpreter } from './task-interpreter.js';

/** Below this, the task is posted but marked for an admin to look at. */
const REVIEW_CONFIDENCE = 0.6;

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'other'
  );
}

/** The category an interpretation shows: one from the list, or a provisional one the model proposed. */
export function categoryOf(output: InterpreterOutput, categories: TaskCategoryRow[]): TaskCategory {
  const listed = categories.find((category) => category.slug === output.categorySlug);
  if (listed) {
    return { slug: listed.slug, name: listed.name, provisional: listed.reviewStatus !== 'approved' };
  }
  const name = output.proposedCategory ?? 'Other';
  return { slug: slugify(name), name, provisional: true };
}

@Injectable()
export class InterpretationService {
  private readonly logger = new Logger(InterpretationService.name);

  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly interpreter: TaskInterpreter,
    private readonly speech: SpeechToText,
  ) {}

  /** Transcribes a recording, then interprets the transcript. The recording is not kept. */
  async interpretVoice(customer: UserRow, recording: Recording): Promise<TaskInterpretation> {
    if (!this.speech.available) {
      throw new ApiException(503, 'speech_unavailable', 'Voice is unavailable. Type the task instead.');
    }
    let transcript: string;
    try {
      transcript = await this.speech.transcribe(recording);
    } catch (error) {
      this.logger.warn(`Speech-to-text failed: ${error instanceof Error ? error.message : String(error)}`);
      throw new ApiException(503, 'speech_unavailable', 'Voice is unavailable. Type the task instead.');
    }
    const parsed = interpretRequestSchema.safeParse({ text: transcript.slice(0, TASK_TEXT_MAX) });
    if (!parsed.success) {
      throw new ApiException(422, 'speech_not_understood', 'We could not hear a task in that recording.');
    }
    return this.interpret(customer, parsed.data.text);
  }

  async interpret(customer: UserRow, text: string): Promise<TaskInterpretation> {
    if (!this.interpreter.available) {
      throw unavailable(text);
    }
    const categories = await this.db.select().from(taskCategories).where(eq(taskCategories.active, true));

    let output: InterpreterOutput;
    try {
      const raw = await this.interpreter.interpret({
        text: redactContactDetails(text),
        language: customer.language,
        categories: categories.map(({ slug, name, requiresSkilled }) => ({ slug, name, requiresSkilled })),
      });
      output = interpreterOutputSchema.parse(raw);
    } catch (error) {
      // A provider outage or an answer that fails the schema: the customer falls back to the typed form.
      this.logger.warn(
        `Interpreter ${this.interpreter.name} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw unavailable(text);
    }

    // A slug the model invented is treated as no match.
    if (output.categorySlug && !categories.some((category) => category.slug === output.categorySlug)) {
      output = { ...output, categorySlug: null };
    }

    const blocked = output.riskFlags.some((flag) => BLOCKING_RISK_FLAGS.includes(flag));
    const category = categoryOf(output, categories);
    const needsReview =
      blocked || output.confidence < REVIEW_CONFIDENCE || output.riskFlags.length > 0 || category.provisional;

    const [row] = await this.db
      .insert(taskInterpretations)
      .values({
        customerId: customer.id,
        inputText: text,
        output,
        provider: this.interpreter.name,
        decision: blocked ? 'blocked' : null,
        needsReview,
      })
      .returning({ id: taskInterpretations.id });

    if (blocked) {
      throw new ApiException(422, 'task_not_allowed', 'Sibimate cannot help with this request.');
    }

    return {
      id: row!.id,
      inputText: text,
      title: output.title,
      description: output.description,
      category,
      requiresSkilled: output.requiresSkilled,
      helpersNeeded: output.helpersNeeded,
      estimatedMinutes: output.estimatedMinutes,
      requirements: output.requirements,
      followUpQuestion: output.followUpQuestion,
    };
  }

  /** The interpretation a customer is posting a task from, if it is theirs and was not blocked. */
  async findUsable(id: string, customerId: string) {
    const [row] = await this.db
      .select()
      .from(taskInterpretations)
      .where(and(eq(taskInterpretations.id, id), eq(taskInterpretations.customerId, customerId)));
    return row && row.decision !== 'blocked' ? row : undefined;
  }
}

/** `text` goes back to the app, so a customer who spoke can post what was heard without typing it. */
function unavailable(text: string) {
  return new ApiException(503, 'interpreter_unavailable', 'Task understanding is unavailable. Type the task instead.', {
    text,
  });
}
