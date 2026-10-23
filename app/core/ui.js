// @ts-check
// DOM helpers, local storage and small widgets shared by every view.


/**
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {Record<string, any>} [props]
 * @param {...(Node|string|null|undefined|false)} children
 * @returns {HTMLElementTagNameMap[K]}
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k in el) /** @type {any} */ (el)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

/** @param {string} id */
export const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

/** @param {number} n */
export const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toLocaleString('en-GB', { maximumFractionDigits: 2 }));

/** @param {string} key */
export function lsGet(key) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}

/** @param {string} key @param {unknown} value */
export function lsSet(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable: the app keeps working in memory
  }
}

/** Chips that work as a single choice. @param {HTMLElement} box @param {[string, string][]} items @param {string} value @param {(v: string) => void} onPick */
export function chipPicker(box, items, value, onPick) {
  box.replaceChildren(
    ...items.map(([v, text]) => h('button', {
      type: 'button', role: 'radio', class: 'chip-opt', 'aria-checked': String(v === value), 'data-v': v,
      onclick: (/** @type {MouseEvent} */ ev) => {
        for (const b of box.querySelectorAll('button')) b.setAttribute('aria-checked', String(b === ev.currentTarget));
        onPick(v);
      },
    }, text)),
  );
}

/**
 * Editable row of a list of steps (sub-goals, subtasks); Enter adds another row instead of submitting.
 * @param {string} id @param {string} title @param {string} placeholder @param {string} addId id of the "+ Add" button
 */
export function editRow(id, title, placeholder, addId) {
  const li = h('li', {});
  if (id) li.dataset.id = id;
  const input = h('input', { value: title, maxlength: 120, autocomplete: 'off', placeholder, 'aria-label': placeholder });
  input.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' || ev.isComposing) return;
    ev.preventDefault();
    /** @type {HTMLButtonElement} */ ($(addId)).click();
  });
  li.append(input, h('button', { type: 'button', class: 'link danger', 'aria-label': 'Remove', onclick: () => li.remove() }, 'Remove'));
  return li;
}
