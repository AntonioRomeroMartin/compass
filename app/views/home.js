// @ts-check
// Home: one card per area with what each of its modules has to say (figures and a few lines); a card opens its area.

import * as domainsLib from '../../lib/domains.js';
import { areaIds, domainsStore, goalsStore, loaded, state } from '../core/data.js';
import { $, h } from '../core/ui.js';
import { modulesOf } from '../modules/index.js';
import { openArea } from './areas.js';

export function renderHome() {
  const view = $('view-home');
  view.replaceChildren();
  if (!state.cfg) return;
  const doms = domainsStore.current();
  if (!doms.domains.length) {
    view.append(h('p', { class: 'empty' }, loaded() || goalsStore.state.fetchedAt ? 'No areas yet.' : 'Loading…'));
    return;
  }
  const cards = doms.domains.filter((d) => !d.parent).map((d) => {
    const scope = { id: d.id, ids: areaIds(d.id), showSub: true };
    const parts = modulesOf(d.id).map((m) => m.homeCard(scope));
    const stats = parts.flatMap((p) => p.stats);
    const body = parts.flatMap((p) => p.body);
    return h(
      'button',
      { class: 'home-card', onclick: () => openArea(d.id) },
      h('div', { class: 'home-card-head' }, h('span', { class: 'area-name' }, d.name), h('span', { class: 'count' }, '›')),
      h('div', { class: 'stats' }, ...stats.map(([label, value, tone]) => h(
        'span',
        { class: `stat${tone && value ? ` ${tone}` : ''}` },
        h('b', {}, String(value)), ` ${label}`,
      ))),
      ...body,
      domainsLib.children(doms, d.id).length ? h('div', { class: 'chips' }, ...domainsLib.children(doms, d.id).map((k) => h('span', { class: 'chip muted' }, k.name))) : null,
    );
  });
  view.append(h('div', { class: 'home-grid' }, ...cards));
}
