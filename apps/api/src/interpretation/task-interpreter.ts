import { Injectable } from '@nestjs/common';
import type { InterpreterOutput, Language, RiskFlag } from '@sibimate/shared';

export interface InterpreterInput {
  /** The customer's words, with contact details already removed. */
  text: string;
  language: Language;
  /** The categories the interpreter may choose from. */
  categories: { slug: string; name: string; requiresSkilled: boolean }[];
}

/**
 * Turns what a customer said into task details. The model provider sits behind
 * this class, so it can change without touching the rest of the code. The
 * answer is validated against interpreterOutputSchema by the caller, so an
 * implementation may return whatever its provider produced.
 */
export abstract class TaskInterpreter {
  /** Stored with each interpretation, to compare providers and prompts later. */
  abstract readonly name: string;
  /** False when no provider is connected and customers should use the typed form. */
  abstract readonly available: boolean;
  abstract interpret(input: InterpreterInput): Promise<unknown>;
}

@Injectable()
export class UnavailableTaskInterpreter extends TaskInterpreter {
  readonly name = 'none';
  readonly available = false;

  interpret(): Promise<unknown> {
    return Promise.reject(new Error('No task interpreter is configured'));
  }
}

const KEYWORDS: { slug: string; words: RegExp; minutes: [number, number] }[] = [
  { slug: 'plumbing', words: /\b(plumb\w*|tap|leak\w*|pipe|nal|flush|drain)\b/i, minutes: [30, 90] },
  {
    slug: 'electrical',
    words: /\b(electric\w*|wiring|switch|socket|fan|bijli|mcb|light fitting)\b/i,
    minutes: [30, 90],
  },
  { slug: 'carpentry', words: /\b(carpent\w*|furniture repair|door hinge|drawer|badhai)\b/i, minutes: [45, 120] },
  { slug: 'appliance-repair', words: /\b(repair\w*|not working|servic\w*|geyser)\b/i, minutes: [45, 120] },
  { slug: 'painting', words: /\b(paint\w*|whitewash|putty)\b/i, minutes: [120, 480] },
  { slug: 'tutoring', words: /\b(tutor\w*|tuition|teach\w*|homework)\b/i, minutes: [60, 90] },
  { slug: 'carry-luggage', words: /\b(carry|luggage|suitcases?|bags?|saa?maa?n|coolie)\b/i, minutes: [30, 45] },
  { slug: 'parcel-drop', words: /\b(parcel|courier|deliver\w*|drop off|document)\b/i, minutes: [30, 60] },
  { slug: 'shopping-pickup', words: /\b(grocer\w*|shopping|buy|medicines?|sabzi|kirana|market)\b/i, minutes: [30, 60] },
  { slug: 'queue-waiting', words: /\b(queue|line|token|counter)\b/i, minutes: [60, 120] },
  { slug: 'wait-at-home', words: /\b(wait at (my )?(home|house|flat))\b/i, minutes: [60, 180] },
  { slug: 'shifting', words: /\b(shift\w*|move|moving|relocat\w*|load|unload)\b/i, minutes: [60, 180] },
  { slug: 'cleaning', words: /\b(clean\w*|safai|sweep\w*|mop\w*|dust\w*|wash\w*)\b/i, minutes: [60, 120] },
  { slug: 'event-setup', words: /\b(event|party|decorat\w*|tent|function|wedding)\b/i, minutes: [120, 240] },
  {
    slug: 'elder-company',
    words: /\b(elder\w*|grand(mother|father|parents?)|dadi|nani|accompany)\b/i,
    minutes: [60, 180],
  },
  { slug: 'errand', words: /\b(errand|pick up|collect|fetch|bring|submit|bank|post office)\b/i, minutes: [30, 60] },
];

const RISKS: { flag: RiskFlag; words: RegExp }[] = [
  { flag: 'illegal', words: /\b(weapons?|guns?|drugs|ganja|explosives?|steal|stolen|hack\w*|fake (id|document)s?)\b/i },
  { flag: 'unsafe', words: /\b(climb (the )?(tower|pole)|high voltage|without safety|beat (him|her|them) up)\b/i },
  { flag: 'medical', words: /\b(injection|give medicine|dress(ing)? (a |the )?wound)\b/i },
  { flag: 'valuables', words: /\b(cash|jewell?ery|gold|cheque)\b/i },
];

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, do: 2, teen: 3, char: 4 };

/**
 * A keyword stand-in for the model, for development and tests only: it lets
 * the whole flow run before a provider is chosen. It does not understand
 * language, and loadEnv() refuses it in production.
 */
@Injectable()
export class RuleBasedTaskInterpreter extends TaskInterpreter {
  readonly name = 'rules';
  readonly available = true;

  async interpret({ text, categories }: InterpreterInput): Promise<InterpreterOutput> {
    const match = KEYWORDS.find(({ slug, words }) => words.test(text) && categories.some((c) => c.slug === slug));
    const category = categories.find((c) => c.slug === match?.slug);
    const [min, max] = match?.minutes ?? [30, 60];

    const people =
      /\b(\d|one|two|three|four|five|do|teen|char)\s+(people|persons?|helpers?|men|log|aadmi|workers?)\b/i.exec(text);
    const helpersNeeded = people ? (NUMBER_WORDS[people[1]!.toLowerCase()] ?? Number(people[1])) : 1;

    const sentence = text.replace(/\s+/g, ' ').trim();
    const action = sentence
      .replace(/^(please|pls|hi|hello)[, ]+/i, '')
      .replace(
        /^(i|we) (need|want) (someone|somebody|help|(a|one|two|three|four|five|\d) (person|people|helpers?)) (to|for|who can) /i,
        '',
      )
      .replace(/^(can|could) (someone|somebody|anyone) (please )?/i, '');
    const firstClause = action.split(/[.,;!?\n]/)[0]!.trim() || sentence;
    const title = capitalise(firstClause.length > 60 ? `${firstClause.slice(0, 57).trimEnd()}...` : firstClause);

    return {
      title: title.length >= 3 ? title : 'Task',
      description: capitalise(/[.!?]$/.test(sentence) ? sentence : `${sentence}.`),
      categorySlug: category?.slug ?? null,
      proposedCategory: null,
      requiresSkilled: category?.requiresSkilled ?? false,
      helpersNeeded,
      estimatedMinutes: { min, max },
      requirements: [],
      riskFlags: RISKS.filter(({ words }) => words.test(text)).map(({ flag }) => flag),
      followUpQuestion: sentence.split(' ').length < 6 ? 'Where should the helper come, and when?' : null,
      confidence: category ? 0.8 : 0.3,
    };
  }
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
