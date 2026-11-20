import { describe, expect, it } from 'vitest';
import {
  TASK_STATUSES,
  TASK_TRANSITIONS,
  TERMINAL_TASK_STATUSES,
  canTransitionTask,
  nextTaskStatuses,
  type TaskStatus,
} from './task-state.js';

describe('task state machine', () => {
  it('walks the normal path from draft to closed', () => {
    const path: [TaskStatus, TaskStatus, Parameters<typeof canTransitionTask>[2]][] = [
      ['draft', 'posted', 'customer'],
      ['posted', 'matching', 'system'],
      ['matching', 'assigned', 'helper'],
      ['assigned', 'en_route', 'helper'],
      ['en_route', 'in_progress', 'helper'],
      ['in_progress', 'completed', 'helper'],
      ['completed', 'paid', 'system'],
      ['paid', 'closed', 'system'],
    ];
    for (const [from, to, actor] of path) {
      expect(canTransitionTask(from, to, actor), `${from} -> ${to}`).toBe(true);
    }
  });

  it('lets the customer cancel only before the work starts', () => {
    for (const from of ['draft', 'posted', 'matching', 'expired', 'assigned', 'en_route'] as const) {
      expect(canTransitionTask(from, 'cancelled', 'customer')).toBe(true);
    }
    for (const from of ['in_progress', 'completed', 'paid', 'closed'] as const) {
      expect(canTransitionTask(from, 'cancelled', 'customer')).toBe(false);
    }
  });

  it('checks who is making the move', () => {
    expect(canTransitionTask('assigned', 'en_route', 'customer')).toBe(false);
    expect(canTransitionTask('matching', 'expired', 'helper')).toBe(false);
    expect(canTransitionTask('disputed', 'closed', 'customer')).toBe(false);
    expect(canTransitionTask('disputed', 'closed', 'admin')).toBe(true);
  });

  it('refuses moves that are not listed', () => {
    expect(canTransitionTask('draft', 'completed', 'helper')).toBe(false);
    expect(canTransitionTask('assigned', 'in_progress', 'helper')).toBe(false);
  });

  it('returns a cancelling helper’s task to matching', () => {
    expect(nextTaskStatuses('assigned', 'helper').sort()).toEqual(['en_route', 'matching']);
  });

  it('has no way out of a terminal state, and a way out of every other', () => {
    for (const status of TASK_STATUSES) {
      const exits = TASK_TRANSITIONS.filter((t) => t.from === status);
      expect(exits.length === 0, status).toBe(TERMINAL_TASK_STATUSES.includes(status));
    }
  });

  it('lets a helper ask for help when the work is under way, and nobody else', () => {
    expect(canTransitionTask('in_progress', 'disputed', 'helper')).toBe(true);
    expect(canTransitionTask('in_progress', 'disputed', 'customer')).toBe(false);
  });

  it('lists each move once', () => {
    const keys = TASK_TRANSITIONS.map((t) => `${t.from}>${t.to}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
