// @ts-check
// Lectura y escritura de un archivo JSON en un repo de GitHub (API REST "contents").
// Solo habla con https://api.github.com; el token nunca sale del navegador hacia otro sitio.

/**
 * @typedef {Object} RepoConfig
 * @property {string} token
 * @property {string} owner
 * @property {string} repo
 * @property {string} path
 * @property {string} branch
 */

/** Error HTTP de la API, con el código de estado. */
export class GitHubError extends Error {
  /** @param {number} status @param {string} message */
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** @param {RepoConfig} cfg */
function contentsUrl(cfg) {
  const path = cfg.path.split('/').map(encodeURIComponent).join('/');
  return `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${path}`;
}

/** @param {RepoConfig} cfg */
function headers(cfg) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${cfg.token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

/** @param {Response} res */
async function fail(res) {
  let detail = '';
  try {
    detail = (await res.json()).message ?? '';
  } catch {
    // cuerpo sin JSON
  }
  const hints = /** @type {Record<number, string>} */ ({
    401: 'Invalid or expired token.',
    403: 'The token lacks permission (or the API rate limit was hit).',
    404: 'Repo or file not found (or the token has no access to that repo).',
    409: 'Conflict: the file changed on GitHub.',
    422: 'Conflict: the file changed on GitHub.',
  });
  throw new GitHubError(res.status, hints[res.status] ?? `GitHub error ${res.status}: ${detail}`);
}

/** @param {string} text */
export function encodeBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** @param {string} b64 */
export function decodeBase64(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * Lee el archivo. Devuelve su texto y el `sha` necesario para escribirlo.
 * @param {RepoConfig} cfg
 * @returns {Promise<{ text: string, sha: string }>}
 */
export async function readFile(cfg) {
  const url = `${contentsUrl(cfg)}?ref=${encodeURIComponent(cfg.branch)}`;
  const res = await fetch(url, { headers: headers(cfg), cache: 'no-store' });
  if (!res.ok) await fail(res);
  const body = await res.json();
  if (typeof body.content !== 'string') throw new GitHubError(0, 'The path is not a file.');
  return { text: decodeBase64(body.content), sha: body.sha };
}

/**
 * Escribe el archivo. Falla con 409/422 si `sha` ya no es el actual.
 * Con `sha` null crea el archivo (falla si ya existe).
 * @param {RepoConfig} cfg
 * @param {string} text
 * @param {string|null} sha
 * @param {string} message
 * @returns {Promise<string>} nuevo sha
 */
export async function writeFile(cfg, text, sha, message) {
  const res = await fetch(contentsUrl(cfg), {
    method: 'PUT',
    headers: { ...headers(cfg), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, content: encodeBase64(text), ...(sha ? { sha } : {}), branch: cfg.branch }),
  });
  if (!res.ok) await fail(res);
  const body = await res.json();
  return body.content.sha;
}
