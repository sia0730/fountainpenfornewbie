// src/lib/crypto.ts
// [기능 2] 인스타그램 액세스 토큰을 DB에 저장할 때 AES-256-GCM 방식으로 안전하게 암호화/복호화합니다.
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';

function getSecretKey(): Buffer {
  const rawKey = process.env.TOKEN_ENCRYPTION_KEY || 'default-fallback-key-must-be-32-chars-long!!';
  return crypto.createHash('sha256').update(rawKey).digest();
}

export function encryptToken(plainToken: string): string {
  const key = getSecretKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plainToken, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptToken(encryptedPayload: string): string {
  const parts = encryptedPayload.split(':');
  if (parts.length !== 3) {
    throw new Error('저장된 토큰 형식이 올바르지 않습니다. 계정을 다시 연결해 주세요.');
  }
  const [ivHex, authTagHex, encryptedHex] = parts;
  const key = getSecretKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, 'hex')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}
