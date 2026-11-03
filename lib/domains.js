// @ts-check
// Registry of domains (areas such as "work", "sport", "studies/course-a"): domains.json in the data repo.
//
// Domains and goal categories are ONE list: a goal's `category` is the id or the name of a domain
// (matched by `domainOfCategory`). Categories that are not registered keep working as plain labels.
// A domain can list the folders where its work happens (`paths`), so a tool started in one of
// them (e.g. `compass today --cwd "$PWD"`) knows which domain it is in.
//
// Same model as goals.js: edits are operations re-applied on top of the latest version.

export { serialize } from './goals.js';

/**
 * @typedef {Object} Domain
 * @property {string} id        hierarchical, "/"-separated: "studies", "studies/course-a"
 * @property {string} name
 * @property {string} [parent]  id of the parent domain; derived from the id ("a/b" → "a") when missing
 * @property {string[]} [paths] folders that belong to this domain (absolute; "~" = home)
 * @property {string} [color]   any CSS color, for the app
 * @property {string} [calendar]       calendar id its events are copied to (sub-domains inherit it; lib/calendar.js)
 * @property {string} [calendarColor]  color id of those copies (inherited too)
 */

/**
 * @typedef {Object} DomainsDoc
 * @property {number} version
 * @property {Domain[]} domains
 * @property {string} [root]  the root folder: its chat sees its own domain in full and every other one's agenda (isRoot)
 */

/**
 * @typedef {{ type: 'add', domain: Domain }
 *   | { type: 'edit', id: string, fields: { name?: string, color?: string | null, calendar?: string | null, calendarColor?: string | null } }
 *   | { type: 'addPath', id: string, path: string }
 *   | { type: 'removePath', id: string, path: string }
 *   | { type: 'move', id: string, before: string | null }
 *   | { type: 'delete', id: string }
 *   | { type: 'setRoot', path: string | null }} Op
 */

const ID = /^[^\s/]+(?:\/[^\s/]+)*$/;

/** @returns {DomainsDoc} */
export function emptyDoc() {
  return { version: 1, domains: [] };
}

/**
 * Is it a valid domain id ("a", "a/b"; no spaces, no empty segments)?
 * @param {unknown} id
 * @returns {id is string}
 */
export function isValidId(id) {
  return typeof id === 'string' && ID.test(id);
}

/**
 * Path without trailing slashes (the root stays "/").
 * @param {string} p
 */
export function cleanPath(p) {
  const s = p.trim();
  return s.length > 1 ? s.replace(/\/+$/, '') || '/' : s;
}

/**
 * Normalizes a document that was read (a bare array of domains is accepted too).
 * Invalid entries and repeated ids are dropped; `validate` explains what is wrong.
 * @param {any} raw
 * @returns {DomainsDoc}
 */
export function normalize(raw) {
  const doc = Array.isArray(raw) ? { domains: raw } : raw && typeof raw === 'object' ? raw : {};
  /** @type {Domain[]} */
  const domains = [];
  for (const d of Array.isArray(doc.domains) ? doc.domains : []) {
    if (!d || typeof d !== 'object' || !isValidId(d.id) || domains.some((x) => x.id === d.id)) continue;
    /** @type {Domain} */
    const out = { ...d, name: typeof d.name === 'string' && d.name.trim() ? d.name.trim() : d.id };
    const slash = d.id.lastIndexOf('/');
    if (typeof d.parent === 'string' && d.parent) out.parent = d.parent;
    else if (slash > 0) out.parent = d.id.slice(0, slash);
    else delete out.parent;
    const paths = Array.isArray(d.paths) ? d.paths.filter((/** @type {unknown} */ p) => typeof p === 'string' && p.trim()).map(cleanPath) : [];
    if (paths.length) out.paths = [...new Set(paths)];
    else delete out.paths;
    for (const k of /** @type {const} */ (['color', 'calendar', 'calendarColor'])) if (typeof d[k] !== 'string' || !d[k]) delete out[k];
    domains.push(out);
  }
  const out = { ...doc, version: Number(doc.version) || 1, domains };
  if (typeof doc.root === 'string' && doc.root.trim()) out.root = cleanPath(doc.root);
  else delete out.root;
  return out;
}

/**
 * Problems in a (normalized) registry, as readable lines. Empty = all good.
 * @param {DomainsDoc} doc
 * @returns {string[]}
 */
export function validate(doc) {
  /** @type {string[]} */
  const problems = [];
  /** @type {Map<string, string>} */
  const owners = new Map();
  for (const d of doc.domains) {
    if (d.parent && !find(doc, d.parent)) problems.push(`“${d.id}”: parent “${d.parent}” does not exist`);
    else if (d.parent && ancestors(doc, d.id).includes(d.id)) problems.push(`“${d.id}”: its parents form a cycle`);
    for (const p of d.paths ?? []) {
      if (!p.startsWith('/') && !p.startsWith('~')) problems.push(`“${d.id}”: path “${p}” is not absolute`);
      const other = owners.get(p);
      if (other) problems.push(`path “${p}” is in both “${other}” and “${d.id}”`);
      else owners.set(p, d.id);
    }
  }
  return problems;
}

/**
 * @param {DomainsDoc} doc
 * @param {string} id
 */
export function find(doc, id) {
  return doc.domains.find((d) => d.id === id);
}

/**
 * Domains a reference may mean: the exact id; otherwise the name (ignoring case);
 * otherwise the last segment of the id ("course-a" → "studies/course-a").
 * @param {DomainsDoc} doc
 * @param {string} ref
 * @returns {Domain[]}
 */
export function lookup(doc, ref) {
  const exact = find(doc, ref);
  if (exact) return [exact];
  const q = ref.trim().toLowerCase();
  const byName = doc.domains.filter((d) => d.name.toLowerCase() === q);
  if (byName.length) return byName;
  return doc.domains.filter((d) => d.id.slice(d.id.lastIndexOf('/') + 1).toLowerCase() === q);
}

/**
 * Domain of a goal category (id or name, ignoring case); undefined if it is not registered.
 * @param {DomainsDoc} doc
 * @param {string} category
 */
export function domainOfCategory(doc, category) {
  return find(doc, category) ?? doc.domains.find((d) => d.name.toLowerCase() === category.trim().toLowerCase());
}

/**
 * Canonical key for grouping: the domain id when registered, otherwise the text as is.
 * @param {DomainsDoc} doc
 * @param {string} text
 */
export function canonical(doc, text) {
  return domainOfCategory(doc, text)?.id ?? text;
}

/**
 * Direct children of a domain.
 * @param {DomainsDoc} doc
 * @param {string} id
 */
export function children(doc, id) {
  return doc.domains.filter((d) => d.parent === id);
}

/**
 * All the domains below one (children, grandchildren…), as ids.
 * @param {DomainsDoc} doc
 * @param {string} id
 * @returns {string[]}
 */
export function descendants(doc, id) {
  /** @type {string[]} */
  const out = [];
  const queue = [id];
  while (queue.length) {
    const cur = /** @type {string} */ (queue.shift());
    for (const c of children(doc, cur)) {
      if (c.id === id || out.includes(c.id)) continue;
      out.push(c.id);
      queue.push(c.id);
    }
  }
  return out;
}

/**
 * Parent, grandparent… of a domain, as ids (stops on a cycle).
 * @param {DomainsDoc} doc
 * @param {string} id
 * @returns {string[]}
 */
export function ancestors(doc, id) {
  /** @type {string[]} */
  const out = [];
  let cur = find(doc, id)?.parent;
  while (cur && !out.includes(cur)) {
    out.push(cur);
    cur = find(doc, cur)?.parent;
  }
  return out;
}

/**
 * Readable name with its parents: "Studies › Course A". Unregistered ids are returned as is.
 * @param {DomainsDoc} doc
 * @param {string} id
 */
export function label(doc, id) {
  const d = find(doc, id);
  if (!d) return id;
  return [...ancestors(doc, id).reverse().map((a) => find(doc, a)?.name ?? a), d.name].join(' › ');
}

/**
 * What a view scoped to a domain shows: `own` (the domain and everything below it, in full)
 * and `inherited` (its parents, only what has a date).
 * @param {DomainsDoc} doc
 * @param {string} id
 */
export function scope(doc, id) {
  return { own: new Set([id, ...descendants(doc, id)]), inherited: new Set(ancestors(doc, id)) };
}

/**
 * Domain of a working folder: among the domains' `paths`, the longest one that contains `cwd` wins
 * (so "/work/client-a" beats "/work"). Matches whole folder names only ("/work" ≠ "/workshop").
 * @param {DomainsDoc} doc
 * @param {string} cwd
 * @param {string} [home]  to expand "~" in `paths` and `cwd`
 * @returns {Domain | undefined}
 */
export function resolvePath(doc, cwd, home) {
  return bestMatch(doc, cwd, home)?.domain;
}

/** @param {string} p @param {string} [home] */
const expandHome = (p, home) => cleanPath(home && (p === '~' || p.startsWith('~/')) ? home + p.slice(1) : p);

/**
 * The domain path that contains `cwd` and is the longest (see resolvePath), with its domain.
 * @param {DomainsDoc} doc @param {string} cwd @param {string} [home]
 * @returns {{ domain: Domain, path: string } | undefined}
 */
function bestMatch(doc, cwd, home) {
  const target = expandHome(cwd, home);
  /** @type {{ domain: Domain, path: string } | undefined} */
  let best;
  for (const d of doc.domains) {
    for (const raw of d.paths ?? []) {
      const p = expandHome(raw, home);
      const inside = target === p || target.startsWith(p === '/' ? '/' : p + '/');
      if (inside && (!best || p.length > best.path.length)) best = { domain: d, path: p };
    }
  }
  return best;
}

/**
 * Is `cwd` in the root folder (the doc's `root`: the folder whose chat oversees every domain)? True when the domain
 * path that wins for `cwd` is the root itself, so a more specific domain inside it is not the root.
 * @param {DomainsDoc} doc @param {string} cwd @param {string} [home]
 */
export function isRoot(doc, cwd, home) {
  return !!doc.root && bestMatch(doc, cwd, home)?.path === expandHome(doc.root, home);
}

/**
 * What the chat of a domain's folder sees (`compass today --cwd`): `own`, the domain and the sub-domains without
 * paths of their own (reached through such ones), in full; and as agenda only (what has a date): the sub-domains
 * with their own paths (they have their own chat) and what is below them, and, in the root, every other domain too
 * (`others`). Its parents are not shown: their chats see it.)
 * @param {DomainsDoc} doc @param {string} id @param {boolean} [root]
 * @returns {{ own: Set<string>, agenda: Set<string>, others: boolean }}
 */
export function chatScope(doc, id, root = false) {
  const own = new Set([id]);
  /** @type {Set<string>} */
  const agenda = new Set();
  const queue = [id];
  while (queue.length) {
    const cur = /** @type {string} */ (queue.shift());
    for (const d of children(doc, cur)) {
      if (own.has(d.id) || agenda.has(d.id)) continue;
      if (d.paths?.length) for (const x of [d.id, ...descendants(doc, d.id)]) agenda.add(x);
      else { own.add(d.id); queue.push(d.id); }
    }
  }
  return { own, agenda, others: root };
}

/**
 * Applies operations to a copy of the document (ops on domains that no longer exist are ignored).
 * @param {DomainsDoc} doc
 * @param {Op[]} ops
 * @returns {DomainsDoc}
 */
export function applyOps(doc, ops) {
  /** @type {DomainsDoc} */
  const out = structuredClone(doc);
  for (const op of ops) {
    switch (op.type) {
      case 'add':
        if (isValidId(op.domain.id) && !find(out, op.domain.id)) out.domains.push(structuredClone(op.domain));
        break;
      case 'edit': {
        const d = find(out, op.id);
        if (!d) break;
        if (op.fields.name) d.name = op.fields.name;
        for (const k of /** @type {const} */ (['color', 'calendar', 'calendarColor'])) {
          const v = op.fields[k];
          if (v) d[k] = v;
          else if (v === null) delete d[k];
        }
        break;
      }
      case 'addPath': {
        const d = find(out, op.id);
        const p = cleanPath(op.path);
        if (d && p && !d.paths?.includes(p)) (d.paths ??= []).push(p);
        break;
      }
      case 'removePath': {
        const d = find(out, op.id);
        if (!d?.paths) break;
        d.paths = d.paths.filter((p) => p !== cleanPath(op.path));
        if (!d.paths.length) delete d.paths;
        break;
      }
      case 'move': {
        // Order among its siblings (same parent): just before `before`, or at the end (null, or not a sibling).
        const d = find(out, op.id);
        if (!d) break;
        const rest = out.domains.filter((x) => x !== d);
        const before = op.before ? rest.find((x) => x.id === op.before && x.parent === d.parent) : undefined;
        rest.splice(before ? rest.indexOf(before) : rest.length, 0, d);
        out.domains = rest;
        break;
      }
      case 'setRoot':
        if (op.path) out.root = cleanPath(op.path);
        else delete out.root;
        break;
      case 'delete':
        out.domains = out.domains.filter((d) => d.id !== op.id);
        break;
    }
  }
  return out;
}

/**
 * Id for a new domain from its name: "Course A" under "studies" → "studies/course-a" ("-2", "-3"… if taken).
 * @param {DomainsDoc} doc @param {string} name @param {string} [parent]
 */
export function newId(doc, name, parent) {
  const slug = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'area';
  const base = parent ? `${parent}/${slug}` : slug;
  let id = base;
  for (let n = 2; find(doc, id); n++) id = `${base}-${n}`;
  return id;
}

/**
 * What still uses a domain (itself, not its sub-domains): how many of each kind, only the kinds with some.
 * @param {DomainsDoc} doc @param {string} id
 * @param {Record<string, (string|null|undefined)[]>} refs  the domain (or category) of each item, by kind
 * @returns {[string, number][]}
 */
export function usage(doc, id, refs) {
  /** @type {[string, number][]} */
  const used = Object.entries(refs).map(([kind, list]) => [kind, list.filter((r) => !!r && canonical(doc, r) === id).length]);
  return used.filter(([, n]) => n > 0);
}

/**
 * Commit message for a batch of operations.
 * @param {Op[]} ops
 */
export function commitMessage(ops) {
  const parts = new Set();
  for (const op of ops) {
    switch (op.type) {
      case 'add': parts.add(`new “${op.domain.id}”`); break;
      case 'edit': parts.add(`edited “${op.id}”`); break;
      case 'addPath':
      case 'removePath': parts.add(`paths “${op.id}”`); break;
      case 'move': parts.add(`moved “${op.id}”`); break;
      case 'delete': parts.add(`deleted “${op.id}”`); break;
      case 'setRoot': parts.add('root folder'); break;
    }
  }
  const text = [...parts].join(', ');
  return `domains: ${text.length > 120 ? text.slice(0, 117) + '…' : text || 'update'}`;
}
