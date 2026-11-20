import type { TaskInterpretation } from '@sibimate/shared';
import { create } from 'zustand';

interface DraftState {
  /** What the customer typed on the home screen. */
  text: string;
  /** The AI-written details waiting to be accepted, or null when the typed form is used. */
  interpretation: TaskInterpretation | null;
  setText: (text: string) => void;
  setInterpretation: (interpretation: TaskInterpretation | null) => void;
  clear: () => void;
}

/** The task being written, shared by the home and confirm screens. It is never saved to the phone. */
export const useDraft = create<DraftState>((set) => ({
  text: '',
  interpretation: null,
  setText: (text) => set({ text }),
  setInterpretation: (interpretation) => set({ interpretation }),
  clear: () => set({ text: '', interpretation: null }),
}));
