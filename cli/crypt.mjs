// @ts-check
// The sealed format of lib/crypt.js, synchronously with node:crypto (the CLI's writes are synchronous), and the
// passphrase: $COMPASS_PASSPHRASE or the system keyring (secret-tool: service compass, key encryption).

import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { IV_BYTES, ITERATIONS, SALT_BYTES, WrongPassphrase, format, isSealed } from '../lib/crypt.js';

export { isSealed, WrongPassphrase };

const TAG_BYTES = 16;

/** @type {Map<string, Buffer>} */
const keys = new Map();

/** @param {string} passphrase @param {string} salt b64 @param {number} iterations */
function key(passphrase, salt, iterations) {
  const id = `${iterations}:${salt}:${passphrase}`;
  let k = keys.get(id);
  if (!k) keys.set(id, (k = pbkdf2Sync(passphrase, Buffer.from(salt, 'base64'), iterations, 32, 'sha256')));
  return k;
}

/**
 * The passphrase, or null if none is set on this computer.
 * @returns {string|null}
 */
export function passphrase() {
  if (process.env.COMPASS_PASSPHRASE) return process.env.COMPASS_PASSPHRASE;
  try {
    const out = execFileSync('secret-tool', ['lookup', 'service', 'compass', 'key', 'encryption'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000 });
    return out.replace(/\n$/, '') || null;
  } catch {
    return null;
  }
}

/**
 * @param {string} text @param {string} pass @param {string|null} [salt] keep the file's salt, or make a new one
 * @returns {string} the file's text
 */
export function sealSync(text, pass, salt = null) {
  const s = salt ?? randomBytes(SALT_BYTES).toString('base64');
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key(pass, s, ITERATIONS), iv);
  const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return format({ salt: s, iterations: ITERATIONS, iv: iv.toString('base64'), data: data.toString('base64') });
}

/**
 * @param {import('../lib/crypt.js').Sealed} sealed @param {string} pass
 * @returns {{ text: string, salt: string }}
 */
export function openSync(sealed, pass) {
  const all = Buffer.from(sealed.data, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key(pass, sealed.kdf.salt, sealed.kdf.iterations), Buffer.from(sealed.iv, 'base64'));
  decipher.setAuthTag(all.subarray(all.length - TAG_BYTES));
  try {
    const text = Buffer.concat([decipher.update(all.subarray(0, all.length - TAG_BYTES)), decipher.final()]).toString('utf8');
    return { text, salt: sealed.kdf.salt };
  } catch {
    throw new WrongPassphrase();
  }
}
