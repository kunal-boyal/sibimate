import { base32Decode, base32Encode, generateTotpSecret, matchTotp, totpCode, totpStep } from './totp.js';

// RFC 6238 appendix B uses the ASCII secret "12345678901234567890" and 8 digits; these are its last 6.
const SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('totp', () => {
  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ])('matches the RFC 6238 vector at %i seconds', (seconds, code) => {
    expect(totpCode(SECRET, totpStep(new Date(seconds * 1000)))).toBe(code);
  });

  it('round-trips base32', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Encode(base32Decode(secret))).toBe(secret);
  });

  it('accepts the neighbouring step for clock drift, and nothing further', () => {
    const now = new Date(1234567890 * 1000);
    const step = totpStep(now);
    expect(matchTotp(SECRET, totpCode(SECRET, step), now)).toBe(step);
    expect(matchTotp(SECRET, totpCode(SECRET, step - 1), now)).toBe(step - 1);
    expect(matchTotp(SECRET, totpCode(SECRET, step - 2), now)).toBeNull();
  });
});
