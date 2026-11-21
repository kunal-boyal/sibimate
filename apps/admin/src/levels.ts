import { VERIFICATION_LEVELS, type VerificationLevel } from '@sibimate/shared';

/** What each verification level lets a helper do, as the dashboard names it. */
export const LEVELS: Record<VerificationLevel, string> = {
  basic: 'Basic: public places',
  verified: 'Verified: inside homes',
  specialised: 'Specialised',
};

/** True when a helper at `level` may take a task that needs `needed`. */
export const meetsLevel = (level: VerificationLevel, needed: VerificationLevel) =>
  VERIFICATION_LEVELS.indexOf(level) >= VERIFICATION_LEVELS.indexOf(needed);
