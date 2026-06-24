const crypto = require('crypto');

const VERSION = 'v1';

function getEncryptionKey() {
  const raw = process.env.AI_CREDENTIAL_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('AI_CREDENTIAL_ENCRYPTION_KEY is required to store AI credentials');
  }

  if (/^[a-f0-9]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
  try {
    const decoded = Buffer.from(raw, 'base64');
    if (decoded.length === 32) return decoded;
  } catch (_) {
    // Fall through to the explicit error below.
  }
  if (raw.length >= 32) return crypto.createHash('sha256').update(raw, 'utf8').digest();
  throw new Error('AI_CREDENTIAL_ENCRYPTION_KEY must contain at least 32 characters');
}

function encryptCredential(value) {
  if (!value) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join('.');
}

function decryptCredential(payload) {
  if (!payload) return '';
  const [version, ivB64, tagB64, encryptedB64] = String(payload).split('.');
  if (version !== VERSION || !ivB64 || !tagB64 || !encryptedB64) {
    throw new Error('Unsupported encrypted credential format');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

function maskCredential(value) {
  if (!value) return null;
  if (value.length <= 8) return '••••••••';
  return `${value.slice(0, 3)}••••${value.slice(-4)}`;
}

module.exports = { encryptCredential, decryptCredential, maskCredential };
