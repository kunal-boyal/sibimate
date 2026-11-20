import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** Encrypts a short text with AES-256-GCM under a 32-byte key. */
export function seal(key: Buffer, text: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((part) => part.toString('base64')).join('.');
}

/** Reverses seal(). Throws when the text was changed or the key is wrong. */
export function open(key: Buffer, sealed: string): string {
  const [iv, tag, data] = sealed.split('.').map((part) => Buffer.from(part, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', key, iv!);
  decipher.setAuthTag(tag!);
  return Buffer.concat([decipher.update(data!), decipher.final()]).toString('utf8');
}
