// @ts-check
// Client-side encryption of a data file (the journal; later finance and trading) with the user's passphrase.
// The repo only ever sees the sealed form:
//   { "version": 1, "sealed": "AES-256-GCM", "kdf": { "name": "PBKDF2-SHA256", "iterations": N, "salt": b64 },
//     "iv": b64, "data": b64 }
// `data` is the ciphertext of the file's JSON followed by the 16-byte GCM tag (as WebCrypto returns it). The app
// uses the async functions here (WebCrypto); the CLI, whose writes are synchronous, does the same with node:crypto
// (cli/crypt.mjs). The tests check that each opens what the other seals.

export const ITERATIONS = 600000;
export const SALT_BYTES = 16;
export const IV_BYTES = 12;

/**
 * @typedef {Object} Sealed
 * @property {number} version
 * @property {'AES-256-GCM'} sealed
 * @property {{ name: 'PBKDF2-SHA256', iterations: number, salt: string }} kdf
 * @property {string} iv
 * @property {string} data
 */

/** @param {Uint8Array} bytes */
export function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** @param {string} b64 */
export const fromB64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/** Is this (parsed) file sealed? @param {any} raw @returns {raw is Sealed} */
export const isSealed = (raw) => !!raw && raw.sealed === 'AES-256-GCM' && typeof raw.data === 'string' && typeof raw.iv === 'string'
  && raw.kdf?.name === 'PBKDF2-SHA256' && typeof raw.kdf.salt === 'string' && Number.isInteger(raw.kdf.iterations);

/** Raised when the passphrase does not open the file. */
export class WrongPassphrase extends Error {
  constructor() {
    super('The encryption password does not open this file.');
    this.name = 'WrongPassphrase';
  }
}

/** Derived keys by passphrase and salt: deriving takes a moment, so each is done once. @type {Map<string, Promise<CryptoKey>>} */
const keys = new Map();

/** @param {string} passphrase @param {string} salt b64 @param {number} iterations */
function deriveKey(passphrase, salt, iterations) {
  const id = `${iterations}:${salt}:${passphrase}`;
  let key = keys.get(id);
  if (!key) {
    key = crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'])
      .then((base) => crypto.subtle.deriveKey(
        { name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(salt), iterations },
        base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
      ));
    keys.set(id, key);
  }
  return key;
}

/**
 * Seals a text. Keeps the salt of the file it replaces (so the key is not derived again), or makes a new one.
 * @param {string} text @param {string} passphrase @param {string|null} [salt]
 * @returns {Promise<string>} the file's new text
 */
export async function seal(text, passphrase, salt = null) {
  const s = salt ?? toB64(crypto.getRandomValues(new Uint8Array(SALT_BYTES)));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(passphrase, s, ITERATIONS);
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text)));
  return format({ salt: s, iterations: ITERATIONS, iv: toB64(iv), data: toB64(data) });
}

/**
 * Opens a sealed file.
 * @param {Sealed} sealed @param {string} passphrase
 * @returns {Promise<{ text: string, salt: string }>}
 */
export async function open(sealed, passphrase) {
  const key = await deriveKey(passphrase, sealed.kdf.salt, sealed.kdf.iterations);
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(sealed.iv) }, key, fromB64(sealed.data));
    return { text: new TextDecoder().decode(plain), salt: sealed.kdf.salt };
  } catch {
    throw new WrongPassphrase();
  }
}

/**
 * The file's text from its parts (shared by app and CLI so both write the same thing).
 * @param {{ salt: string, iterations: number, iv: string, data: string }} p
 */
export function format(p) {
  /** @type {Sealed} */
  const doc = { version: 1, sealed: 'AES-256-GCM', kdf: { name: 'PBKDF2-SHA256', iterations: p.iterations, salt: p.salt }, iv: p.iv, data: p.data };
  return JSON.stringify(doc, null, 2) + '\n';
}
