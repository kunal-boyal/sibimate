import { canRaiseDispute } from './dispute-rules.js';

const rules = { disputeWindowHours: 48, completionCodeWaitMinutes: 30 };
const now = new Date('2026-11-20T12:00:00Z');
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

describe('canRaiseDispute', () => {
  it('lets either side report a problem within the window after the job, once', () => {
    const job = { startedAt: ago(120), completedAt: ago(60) };
    expect(canRaiseDispute('customer', 'paid', job, rules, false, now)).toBe(true);
    expect(canRaiseDispute('helper', 'completed', job, rules, false, now)).toBe(true);
    expect(canRaiseDispute('customer', 'paid', job, rules, true, now)).toBe(false);
  });

  it('closes the window after the set number of hours', () => {
    const job = { startedAt: ago(49 * 60 + 30), completedAt: ago(48 * 60 + 1) };
    expect(canRaiseDispute('customer', 'paid', job, rules, false, now)).toBe(false);
  });

  it('lets only the helper ask for help during the work, after the code wait', () => {
    expect(canRaiseDispute('helper', 'in_progress', { startedAt: ago(29), completedAt: null }, rules, false, now)).toBe(
      false,
    );
    expect(canRaiseDispute('helper', 'in_progress', { startedAt: ago(31), completedAt: null }, rules, false, now)).toBe(
      true,
    );
    expect(
      canRaiseDispute('customer', 'in_progress', { startedAt: ago(90), completedAt: null }, rules, false, now),
    ).toBe(false);
  });

  it('follows a changed setting', () => {
    const job = { startedAt: ago(10), completedAt: null };
    expect(canRaiseDispute('helper', 'in_progress', job, { ...rules, completionCodeWaitMinutes: 5 }, false, now)).toBe(
      true,
    );
  });
});
