/**
 * The task state machine. The API refuses any move this file does not list,
 * and the database enum mirrors TASK_STATUSES.
 */
export const TASK_STATUSES = [
  'draft',
  'posted',
  'matching',
  'assigned',
  'en_route',
  'in_progress',
  'completed',
  'paid',
  'closed',
  'expired',
  'cancelled',
  'disputed',
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_ACTORS = ['customer', 'helper', 'system', 'admin'] as const;
export type TaskActor = (typeof TASK_ACTORS)[number];

export interface TaskTransition {
  from: TaskStatus;
  to: TaskStatus;
  actors: readonly TaskActor[];
}

/** States a customer can still cancel from: everything before the work starts. */
const CANCELLABLE = ['draft', 'posted', 'matching', 'assigned', 'en_route'] as const;

export const TASK_TRANSITIONS: readonly TaskTransition[] = [
  { from: 'draft', to: 'posted', actors: ['customer'] },
  { from: 'posted', to: 'matching', actors: ['system'] },
  // A helper accepts the customer's price, the customer picks a quote, or an admin assigns by hand.
  { from: 'matching', to: 'assigned', actors: ['helper', 'customer', 'admin'] },
  { from: 'matching', to: 'expired', actors: ['system'] },
  // No helper was found: the customer posts it again, or an admin does, or an admin assigns one by hand.
  { from: 'expired', to: 'matching', actors: ['customer', 'admin'] },
  { from: 'expired', to: 'assigned', actors: ['admin'] },
  { from: 'expired', to: 'cancelled', actors: ['customer'] },
  { from: 'assigned', to: 'en_route', actors: ['helper'] },
  { from: 'en_route', to: 'in_progress', actors: ['helper'] },
  { from: 'in_progress', to: 'completed', actors: ['helper'] },
  // System: release of an early payment or the payment webhook. Helper: cash received.
  { from: 'completed', to: 'paid', actors: ['system', 'helper'] },
  { from: 'paid', to: 'closed', actors: ['system'] },
  // The helper cancels and the task is matched again.
  { from: 'assigned', to: 'matching', actors: ['helper'] },
  { from: 'en_route', to: 'matching', actors: ['helper'] },
  ...CANCELLABLE.map((from) => ({ from, to: 'cancelled', actors: ['customer'] }) as const),
  // A customer who will not give the completion code: the helper asks an admin to step in.
  { from: 'in_progress', to: 'disputed', actors: ['helper'] },
  { from: 'completed', to: 'disputed', actors: ['customer', 'helper'] },
  { from: 'paid', to: 'disputed', actors: ['customer', 'helper'] },
  // An admin resolves the dispute with a refund or a release.
  { from: 'disputed', to: 'closed', actors: ['admin'] },
];

/** A task that still needs something from someone. */
export const ACTIVE_TASK_STATUSES: readonly TaskStatus[] = [
  'posted',
  'matching',
  'assigned',
  'en_route',
  'in_progress',
  'completed',
  'disputed',
];

export const TERMINAL_TASK_STATUSES: readonly TaskStatus[] = ['closed', 'cancelled'];

export function findTaskTransition(from: TaskStatus, to: TaskStatus): TaskTransition | undefined {
  return TASK_TRANSITIONS.find((t) => t.from === from && t.to === to);
}

export function canTransitionTask(from: TaskStatus, to: TaskStatus, actor: TaskActor): boolean {
  return findTaskTransition(from, to)?.actors.includes(actor) ?? false;
}

/** The states `actor` can move a task to from `from`. */
export function nextTaskStatuses(from: TaskStatus, actor: TaskActor): TaskStatus[] {
  return TASK_TRANSITIONS.filter((t) => t.from === from && t.actors.includes(actor)).map((t) => t.to);
}
