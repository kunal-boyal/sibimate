import { createHmac, randomBytes } from 'node:crypto';

// Time-based one-time passwords (RFC 6238): 6 digits, 30-second steps, HMAC-SHA1, as authenticator apps expect.
const STEP_SECONDS = 30;
const DIGITS = 6;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Buffer): string {
  let bits = '';
  for (const byte of bytes) {
    bits += byte.toString(2).padStart(8, '0');
  }
  return (bits.match(/.{1,5}/g) ?? []).map((chunk) => ALPHABET[parseInt(chunk.padEnd(5, '0'), 2)]).join('');
}

export function base32Decode(text: string): Buffer {
  const bits = text
    .replace(/=+$/, '')
    .toUpperCase()
    .split('')
    .map((char) => ALPHABET.indexOf(char).toString(2).padStart(5, '0'))
    .join('');
  return Buffer.from((bits.match(/.{8}/g) ?? []).map((byte) => parseInt(byte, 2)));
}

/** A new 160-bit secret, in the base32 form authenticator apps take. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpStep(now: Date): number {
  return Math.floor(now.getTime() / 1000 / STEP_SECONDS);
}

export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS).toString().padStart(DIGITS, '0');
}

/** The step `code` is valid for, allowing one step either side for clock drift, or null. */
export function matchTotp(secret: string, code: string, now: Date): number | null {
  const current = totpStep(now);
  return [current, current - 1, current + 1].find((step) => totpCode(secret, step) === code) ?? null;
}

/** The address an authenticator app reads from a QR code. */
export function otpauthUri(secret: string, email: string): string {
  return `otpauth://totp/Sibimate%20Admin:${encodeURIComponent(email)}?secret=${secret}&issuer=Sibimate%20Admin`;
}
