import { ApiClientError } from '@sibimate/api-client';
import { type TranslationKey, en } from '@/locales/en';
import { hi } from '@/locales/hi';
import { useSession } from './session';

const tables = { en, hi };

export type Translate = (key: TranslationKey, vars?: Record<string, string | number>) => string;

/** Returns `t` for the language chosen in the app. */
export function useT(): Translate {
  const language = useSession((state) => state.language);
  return (key, vars) => tables[language][key].replace(/\{(\w+)\}/g, (_, name: string) => String(vars?.[name] ?? ''));
}

/** The message key for anything a request threw. Screens keep the key, so the message follows the language. */
export function errorKey(error: unknown): TranslationKey {
  return error instanceof ApiClientError ? `errors.${error.code}` : 'errors.internal';
}

/** +919876543210 as +91 98765 43210, with spaces that do not break across lines. */
export function formatPhone(phone: string): string {
  return phone.replace(/^\+91(\d{5})(\d{5})$/, '+91\u00A0$1\u00A0$2');
}

/** A task's time slot, such as "Sat 21, 3:00 pm", in the app's language. */
export function formatSlot(iso: string, language: 'en' | 'hi'): string {
  return new Date(iso).toLocaleString(language === 'hi' ? 'hi-IN' : 'en-IN', {
    weekday: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
