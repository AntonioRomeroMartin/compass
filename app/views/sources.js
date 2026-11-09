// @ts-check
// Sources: every source, with or without an area, filtered by kind and grouped by status (In progress, Want, Done
// this year…).
import * as sourcesLib from '../../lib/sources.js';
import { canEdit, goalsStore, loaded, persist, sourcesStore, state } from '../core/data.js';
import { $, chipPicker, h } from '../core/ui.js';
import { areaName, openSourceForm, sourceGroups } from '../modules/sources/view.js';

export function renderSourcesView() {
  const view = $('view-sources');
  view.replaceChildren();
  if (!state.cfg) return;
  if (!loaded() && !goalsStore.state.fetchedAt) {
    view.append(h('p', { class: 'empty' }, 'Loading…'));
    return;
  }
  const all = sourcesStore.current().sources;
  const kind = /** @type {sourcesLib.Kind|''} */ (sourcesLib.isKind(state.sourceKind) ? state.sourceKind : '');
  // A chip per kind that has sources (and the chosen one, even if it has none left).
  const kinds = sourcesLib.KINDS.filter((k) => k === kind || all.some((s) => s.kind === k));
  const filter = h('div', { class: 'chip-pick', role: 'radiogroup', 'aria-label': 'Kind' });
  chipPicker(filter, [['', 'All'], ...kinds.map((k) => /** @type {[string, string]} */ ([k, `${sourcesLib.KIND_TEXT[k]}s`]))], kind, (v) => {
    state.sourceKind = v;
    persist();
    renderSourcesView();
  });
  view.append(h('div', { class: 'block-head' }, kinds.length > 1 || kind ? filter : h('span'),
    h('button', { class: 'btn small', disabled: !canEdit(), onclick: () => openSourceForm('', undefined, kind || 'book') }, '+ Source')));
  // Sources with an area carry its name; those in no area carry none.
  view.append(...sourceGroups(kind ? all.filter((s) => s.kind === kind) : all, (s) => areaName(s) || null, kind));
}
