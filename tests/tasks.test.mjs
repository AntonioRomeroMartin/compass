// Logic tests for tasks, domains and the Today view: `node --test tests/*.test.mjs`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, endOfWeek, isDate, isoWeekday } from '../lib/period.js';
import * as tasks from '../lib/tasks.js';
import * as domains from '../lib/domains.js';
import * as goals from '../lib/goals.js';
import { buildToday } from '../lib/today.js';

const FRI = '2026-10-23';

/** @param {string} id @param {Partial<import('../lib/tasks.js').Task>} [extra] */
const task = (id, extra = {}) => tasks.newTask({ id, title: `Task ${id}`, domain: 'work', ...extra }, new Date('2026-10-01T00:00:00Z'));

test('civil date helpers', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-03-01', -1), '2028-02-29');
  assert.equal(isoWeekday(FRI), 5);
  assert.equal(isoWeekday('2026-10-25'), 7);
  assert.equal(endOfWeek(FRI), '2026-10-25');
  assert.equal(endOfWeek('2026-10-25'), '2026-10-25');
  assert.ok(isDate('2028-02-29'));
  assert.ok(!isDate('2026-02-30'));
  assert.ok(!isDate('26-1-1'));
});

test('repeat rules as typed', () => {
  assert.deepEqual(tasks.parseRepeat('daily', FRI), { type: 'days', every: 1 });
  assert.deepEqual(tasks.parseRepeat('every 3 days', FRI), { type: 'days', every: 3 });
  assert.deepEqual(tasks.parseRepeat('2d', FRI), { type: 'days', every: 2 });
  assert.deepEqual(tasks.parseRepeat('weekly', FRI), { type: 'weekly', days: [5] });
  assert.deepEqual(tasks.parseRepeat('thu,mon', FRI), { type: 'weekly', days: [1, 4] });
  assert.deepEqual(tasks.parseRepeat('weekly:Tuesday, sat', FRI), { type: 'weekly', days: [2, 6] });
  assert.deepEqual(tasks.parseRepeat('weekdays', FRI), { type: 'weekly', days: [1, 2, 3, 4, 5] });
  assert.deepEqual(tasks.parseRepeat('monthly', FRI), { type: 'monthly', day: 23 });
  assert.deepEqual(tasks.parseRepeat('monthly:31', FRI), { type: 'monthly', day: 31 });
  assert.equal(tasks.parseRepeat('none', FRI), null);
  assert.throws(() => tasks.parseRepeat('fortnightly', FRI), /unknown repeat/);
  assert.throws(() => tasks.parseRepeat('mo', FRI), /unknown repeat/);
  assert.equal(tasks.repeatText({ type: 'weekly', days: [1, 4] }), 'weekly mon,thu');
  assert.equal(tasks.repeatText({ type: 'days', every: 1 }), 'daily');
  assert.equal(tasks.validRepeat({ type: 'weekly', days: [9] }), null);
});

test('next occurrence: from the due date, or from today when late', () => {
  const every3 = /** @type {const} */ ({ type: 'days', every: 3 });
  assert.equal(tasks.nextDue(every3, '2026-10-23', '2026-10-21'), '2026-10-26'); // done early
  assert.equal(tasks.nextDue(every3, '2026-10-23', '2026-10-25'), '2026-10-28'); // done late
  assert.equal(tasks.nextDue(every3, null, '2026-10-25'), '2026-10-28');
  const monThu = /** @type {const} */ ({ type: 'weekly', days: [1, 4] });
  assert.equal(tasks.nextDue(monThu, '2026-10-22', '2026-10-22'), '2026-10-26');
  assert.equal(tasks.nextDue(monThu, '2026-10-19', '2026-10-23'), '2026-10-26'); // late: no pile of copies
  const day31 = /** @type {const} */ ({ type: 'monthly', day: 31 });
  assert.equal(tasks.nextDue(day31, '2027-01-31', '2027-01-31'), '2027-02-28');
  assert.equal(tasks.nextDue(day31, '2028-01-31', '2028-01-31'), '2028-02-29');
  assert.equal(tasks.nextDue(day31, '2027-02-28', '2027-02-28'), '2027-03-31');
  assert.equal(tasks.nextDue({ type: 'monthly', day: 15 }, '2026-12-15', '2026-12-15'), '2027-01-15');
  assert.equal(tasks.firstDue(monThu, FRI), '2026-10-26');
  assert.equal(tasks.firstDue({ type: 'weekly', days: [5] }, FRI), FRI);
  assert.equal(tasks.firstDue({ type: 'monthly', day: 23 }, FRI), FRI);
  assert.equal(tasks.firstDue(every3, FRI), FRI);
});

test('dates as typed', () => {
  assert.equal(tasks.parseDue('today', FRI), FRI);
  assert.equal(tasks.parseDue('tomorrow', FRI), '2026-10-24');
  assert.equal(tasks.parseDue('+10', FRI), '2026-11-02');
  assert.equal(tasks.parseDue('fri', FRI), '2026-10-30'); // the next one, not today
  assert.equal(tasks.parseDue('Monday', FRI), '2026-10-26');
  assert.equal(tasks.parseDue('2026-12-01', FRI), '2026-12-01');
  assert.equal(tasks.parseDue('none', FRI), null);
  assert.throws(() => tasks.parseDue('2026-02-30', FRI), /invalid date/);
  assert.throws(() => tasks.parseDue('soon', FRI), /invalid date/);
});

test('completing a repeating task creates the next occurrence once', () => {
  const base = tasks.applyOps(tasks.emptyDoc('UTC'), [{
    type: 'add',
    task: task('t1', { due: '2026-10-22', repeat: { type: 'weekly', days: [4] }, focus: true }),
  }, { type: 'add', task: task('s1', { parent: 't1', status: 'done', doneAt: 'y' }) }]);
  /** @type {import('../lib/tasks.js').Op[]} */
  const ops = [{ type: 'done', id: 't1', at: '2026-10-23T08:00:00Z', today: FRI, nextId: 't2' }];
  const doc = tasks.applyOps(base, ops);
  const [done, , next, step] = doc.tasks;
  assert.equal(done.status, 'done');
  assert.equal(done.doneAt, '2026-10-23T08:00:00Z');
  assert.equal(done.next, 't2');
  assert.equal(next.id, 't2');
  assert.equal(next.status, 'open');
  assert.equal(next.due, '2026-10-29');
  assert.equal(next.focus, false);
  assert.deepEqual([step.id, step.parent, step.status], ['t2-1', 't2', 'open'], 'a fresh copy of its parts');
  assert.equal('next' in next, false);
  // Re-applied (e.g. after a conflict): nothing doubles.
  assert.equal(tasks.applyOps(doc, ops).tasks.length, 4);
  // Reopening removes the occurrence it created.
  const reopened = tasks.applyOps(doc, [{ type: 'reopen', id: 't1' }]);
  assert.deepEqual(reopened.tasks.map((t) => [t.id, t.status]), [['t1', 'open'], ['s1', 'done']]);
  assert.equal(reopened.tasks[0].doneAt, null);
  // Dropping with nextId null ends the series.
  const stopped = tasks.applyOps(base, [{ type: 'drop', id: 't1', at: 'x', today: FRI, nextId: null }]);
  assert.deepEqual(stopped.tasks.map((t) => t.status), ['dropped', 'done']);
  // Non-repeating: no copy even with a nextId.
  const once = tasks.applyOps(tasks.emptyDoc(), [{ type: 'add', task: task('a') }, { type: 'done', id: 'a', at: 'x', today: FRI, nextId: 'b' }]);
  assert.equal(once.tasks.length, 1);
});

test('focus: at most 3 open tasks at a time', () => {
  let doc = tasks.applyOps(tasks.emptyDoc(), ['a', 'b', 'c', 'd'].map((id) => ({ type: /** @type {const} */ ('add'), task: task(id) })));
  doc = tasks.applyOps(doc, ['a', 'b', 'c', 'd'].map((id) => ({ type: /** @type {const} */ ('focus'), id, focus: true })));
  assert.deepEqual(tasks.focused(doc).map((t) => t.id), ['a', 'b', 'c']);
  assert.ok(!tasks.canFocus(doc, 'd'));
  assert.ok(tasks.canFocus(doc, 'a'));
  // A closed task frees its place.
  doc = tasks.applyOps(doc, [{ type: 'done', id: 'a', at: 'x', today: FRI, nextId: null }, { type: 'focus', id: 'd', focus: true }]);
  assert.deepEqual(tasks.focused(doc).map((t) => t.id), ['b', 'c', 'd']);
  doc = tasks.applyOps(doc, [{ type: 'focus', id: 'b', focus: false }]);
  assert.deepEqual(tasks.focused(doc).map((t) => t.id), ['c', 'd']);
});

test('tasks: edit, normalize and commit message', () => {
  let doc = tasks.applyOps(tasks.emptyDoc(), [{ type: 'add', task: task('a', { title: 'Write report' }) }]);
  doc = tasks.applyOps(doc, [
    { type: 'edit', id: 'a', fields: { due: '2026-11-02', notes: 'Line 1\nLine 2' } },
    { type: 'edit', id: 'gone', fields: { title: 'x' } },
  ]);
  assert.equal(doc.tasks[0].due, '2026-11-02');
  assert.deepEqual(tasks.normalize(JSON.parse(tasks.serialize(doc))), doc);
  const raw = tasks.normalize({ tasks: [{ id: 'x', title: 'X', due: '2026-02-30', status: 'weird', repeat: { type: 'days', every: 0 }, parent: 'x' }, { title: 'no id' }] });
  assert.equal(raw.tasks.length, 1);
  assert.deepEqual([raw.tasks[0].due, raw.tasks[0].status, raw.tasks[0].repeat, raw.tasks[0].focus, raw.tasks[0].parent], [null, 'open', null, false, undefined]);
  const ops = /** @type {import('../lib/tasks.js').Op[]} */ ([{ type: 'edit', id: 'a', fields: { due: FRI } }]);
  assert.equal(tasks.commitMessage(ops, doc, tasks.applyOps(doc, ops)), 'tasks: moved “Write report”');
  assert.equal(tasks.commitMessage([{ type: 'done', id: 'a', at: 'x', today: FRI, nextId: null }], doc, doc), 'tasks: done “Write report”');
});

test('due windows: overdue, today (late included), this week and the next 7 days', () => {
  const late = task('a', { due: '2026-10-20' });
  const today = task('b', { due: FRI });
  const sunday = task('c', { due: '2026-10-25' });
  const monday = task('d', { due: '2026-10-26' });
  const undated = task('e');
  const nextFri = task('f', { due: '2026-10-30' });
  const nextSat = task('g', { due: '2026-10-31' });
  /** @param {'overdue'|'today'|'week'|'next7'} w */
  const ids = (w) => [late, today, sunday, monday, undated, nextFri, nextSat].filter((t) => tasks.isDueWithin(t, w, FRI)).map((t) => t.id);
  assert.deepEqual(ids('overdue'), ['a']);
  assert.deepEqual(ids('today'), ['a', 'b']);
  assert.deepEqual(ids('week'), ['a', 'b', 'c']);
  // On a Friday, the next 7 days reach next Friday.
  assert.deepEqual(ids('next7'), ['a', 'b', 'c', 'd', 'f']);
});

const REGISTRY = domains.normalize({
  version: 1,
  domains: [
    { id: 'studies', name: 'Studies', paths: ['~/projects/studies/'] },
    { id: 'studies/course-a', name: 'Course A', paths: ['~/projects/studies/course-a'] },
    { id: 'studies/course-b', name: 'Course B', color: '#336699' },
    { id: 'sport', name: 'Sport', paths: ['/data/sport'] },
    { id: 'sport', name: 'Duplicate' },
    { id: 'bad id', name: 'Spaces' },
  ],
});

test('domains: normalize, hierarchy and lookup', () => {
  assert.deepEqual(REGISTRY.domains.map((d) => d.id), ['studies', 'studies/course-a', 'studies/course-b', 'sport']);
  assert.equal(REGISTRY.domains[1].parent, 'studies');
  assert.equal('parent' in REGISTRY.domains[0], false);
  assert.deepEqual(REGISTRY.domains[0].paths, ['~/projects/studies']);
  assert.deepEqual(domains.children(REGISTRY, 'studies').map((d) => d.id), ['studies/course-a', 'studies/course-b']);
  assert.deepEqual(domains.descendants(REGISTRY, 'studies'), ['studies/course-a', 'studies/course-b']);
  assert.deepEqual(domains.ancestors(REGISTRY, 'studies/course-a'), ['studies']);
  assert.equal(domains.label(REGISTRY, 'studies/course-a'), 'Studies › Course A');
  assert.equal(domains.label(REGISTRY, 'unknown'), 'unknown');
  assert.deepEqual(domains.lookup(REGISTRY, 'course-b').map((d) => d.id), ['studies/course-b']);
  assert.deepEqual(domains.lookup(REGISTRY, 'COURSE A').map((d) => d.id), ['studies/course-a']);
  assert.deepEqual(domains.lookup(REGISTRY, 'nothing'), []);
  // A goal category is a domain id or name.
  assert.equal(domains.domainOfCategory(REGISTRY, 'sport')?.id, 'sport');
  assert.equal(domains.domainOfCategory(REGISTRY, 'Course A')?.id, 'studies/course-a');
  assert.equal(domains.canonical(REGISTRY, 'Reading'), 'Reading');
  assert.deepEqual(domains.validate(REGISTRY), []);
  assert.deepEqual(domains.normalize([{ id: 'x' }]).domains, [{ id: 'x', name: 'x' }]);
});

test('domains: move among siblings, new ids from names, usage', () => {
  const ids = (/** @type {import('../lib/domains.js').DomainsDoc} */ d) => d.domains.map((x) => x.id);
  let doc = domains.applyOps(REGISTRY, [{ type: 'move', id: 'sport', before: 'studies' }]);
  assert.deepEqual(ids(doc), ['sport', 'studies', 'studies/course-a', 'studies/course-b']);
  doc = domains.applyOps(doc, [{ type: 'move', id: 'studies/course-a', before: null }]);
  assert.deepEqual(ids(doc), ['sport', 'studies', 'studies/course-b', 'studies/course-a']);
  // `before` that is not a sibling (or no longer exists) means last among its siblings; an unknown id does nothing.
  doc = domains.applyOps(doc, [{ type: 'move', id: 'sport', before: 'studies/course-b' }, { type: 'move', id: 'gone', before: null }]);
  assert.deepEqual(ids(doc), ['studies', 'studies/course-b', 'studies/course-a', 'sport']);
  assert.equal(domains.commitMessage([{ type: 'move', id: 'sport', before: null }]), 'domains: moved “sport”');

  assert.equal(domains.newId(REGISTRY, 'Música y Más'), 'musica-y-mas');
  assert.equal(domains.newId(REGISTRY, 'Course A', 'studies'), 'studies/course-a-2');
  assert.equal(domains.newId(REGISTRY, '¡!'), 'area');

  assert.deepEqual(domains.usage(REGISTRY, 'studies/course-a', { tasks: ['Course A', 'studies', null], goals: ['studies/course-a'], sources: [] }), [['tasks', 1], ['goals', 1]]);
});

test('domains: validation problems', () => {
  const doc = domains.normalize({ domains: [
    { id: 'a/b', name: 'B', paths: ['relative/dir'] },
    { id: 'c', name: 'C', paths: ['/same'] },
    { id: 'd', name: 'D', paths: ['/same'] },
    { id: 'e', parent: 'f' }, { id: 'f', parent: 'e' },
  ] });
  const problems = domains.validate(doc).join('\n');
  assert.match(problems, /“a\/b”: parent “a” does not exist/);
  assert.match(problems, /path “relative\/dir” is not absolute/);
  assert.match(problems, /path “\/same” is in both “c” and “d”/);
  assert.match(problems, /“e”: its parents form a cycle/);
});

test('domains: the longest path containing the folder wins', () => {
  const home = '/home/someone';
  assert.equal(domains.resolvePath(REGISTRY, '/home/someone/projects/studies/course-a/week-3', home)?.id, 'studies/course-a');
  assert.equal(domains.resolvePath(REGISTRY, '/home/someone/projects/studies/course-a', home)?.id, 'studies/course-a');
  assert.equal(domains.resolvePath(REGISTRY, '/home/someone/projects/studies/course-c/', home)?.id, 'studies');
  assert.equal(domains.resolvePath(REGISTRY, '~/projects/studies', home)?.id, 'studies');
  assert.equal(domains.resolvePath(REGISTRY, '/home/someone/projects/studies-old', home), undefined); // whole folder names
  assert.equal(domains.resolvePath(REGISTRY, '/data/sport', home)?.id, 'sport');
  assert.equal(domains.resolvePath(REGISTRY, '/elsewhere', home), undefined);
  const root = domains.normalize({ domains: [{ id: 'all', paths: ['/'] }] });
  assert.equal(domains.resolvePath(root, '/any/where')?.id, 'all');
});

test('domains: operations', () => {
  let doc = domains.applyOps(domains.emptyDoc(), [
    { type: 'add', domain: { id: 'studies', name: 'Studies' } },
    { type: 'add', domain: { id: 'studies', name: 'Again' } },
    { type: 'addPath', id: 'studies', path: '/p/studies/' },
    { type: 'addPath', id: 'studies', path: '/p/studies' },
    { type: 'edit', id: 'studies', fields: { color: 'teal' } },
  ]);
  assert.deepEqual(doc.domains, [{ id: 'studies', name: 'Studies', paths: ['/p/studies'], color: 'teal' }]);
  doc = domains.applyOps(doc, [{ type: 'removePath', id: 'studies', path: '/p/studies' }, { type: 'edit', id: 'studies', fields: { color: null } }]);
  assert.deepEqual(doc.domains, [{ id: 'studies', name: 'Studies' }]);
  assert.equal(domains.commitMessage([{ type: 'add', domain: { id: 'x', name: 'X' } }]), 'domains: new “x”');
});

test('today: focus, then by domain; a scope in full (later, no date, every goal), without its parent', () => {
  const now = new Date('2026-10-23T10:00:00Z');
  const tasksDoc = tasks.applyOps(tasks.emptyDoc('UTC'), [
    { type: 'add', task: task('own', { domain: 'studies/course-a', due: '2026-10-24' }) },
    { type: 'add', task: task('late', { domain: 'studies/course-a', due: '2026-10-01' }) },
    { type: 'add', task: task('parent', { domain: 'studies', due: FRI }) },
    { type: 'add', task: task('parentUndated', { domain: 'studies', ongoing: 'notes/p.md' }) },
    { type: 'add', task: task('ongoing', { domain: 'studies/course-a', ongoing: 'notes/a.md' }) },
    { type: 'add', task: task('sibling', { domain: 'studies/course-b', due: FRI }) },
    { type: 'add', task: task('nextWeek', { domain: 'studies/course-a', due: '2026-10-26' }) },
    { type: 'add', task: task('inTwoWeeks', { domain: 'studies/course-a', due: '2026-11-06' }) },
    { type: 'add', task: task('undated', { domain: 'studies/course-a' }) },
    { type: 'add', task: task('focusHere', { domain: 'studies/course-a' }) },
    { type: 'add', task: task('focusThere', { domain: 'sport', due: FRI }) },
    { type: 'add', task: task('closed', { domain: 'studies/course-a', due: FRI, status: 'done' }) },
    { type: 'focus', id: 'focusHere', focus: true },
    { type: 'focus', id: 'focusThere', focus: true },
  ]);
  const goalsDoc = goals.normalize({ timeZone: 'UTC', goals: [
    { id: 'g1', kind: 'goal', title: 'Study hours', category: 'Studies', horizon: 'week', target: 10, progress: 0, period: '2026-W43' },
    { id: 'g2', kind: 'goal', title: 'Runs', category: 'sport', horizon: 'week', target: 3, progress: 0, period: '2026-W43' },
    { id: 'g3', kind: 'goal', title: 'Read', category: 'Reading', horizon: 'month', target: 1, progress: 0, period: '2026-10' },
    { id: 'g4', kind: 'goal', title: 'Pass the course', category: 'studies/course-a', horizon: 'month', target: 1, progress: 0, period: '2026-10' },
  ] });
  const view = buildToday({ goals: goalsDoc, tasks: tasksDoc, domains: REGISTRY, now, tz: 'UTC', scope: 'studies/course-a' });
  assert.equal(view.date, FRI);
  assert.equal(view.week, '2026-W43');
  assert.deepEqual(view.focus.map((t) => t.id), ['focusHere']);
  assert.equal(view.focusElsewhere, 1);
  assert.deepEqual(view.groups.map((g) => [g.domain, g.agenda]), [['studies/course-a', false]]); // not its parent
  const [own] = view.groups;
  // The next 7 days, not just this week: Monday's task shows on Friday; one in two weeks under Later.
  assert.deepEqual(own.tasks.map((t) => t.id), ['late', 'own', 'nextWeek']);
  assert.deepEqual(own.later.map((t) => t.id), ['inTwoWeeks']);
  // Without a date (work in progress too); focus tasks are not repeated.
  assert.deepEqual(own.undated.map((t) => t.id), ['ongoing', 'undated']);
  assert.deepEqual(own.ongoing, []);
  assert.deepEqual(own.goals.map((g) => g.id), ['g4']); // every active goal, not only the week's
  assert.equal(own.label, 'Studies › Course A');
  // Without a scope: everything, in registry order; unregistered categories at the end.
  const all = buildToday({ goals: goalsDoc, tasks: tasksDoc, domains: REGISTRY, now, tz: 'UTC' });
  assert.deepEqual(all.groups.map((g) => g.domain), ['studies', 'studies/course-a', 'studies/course-b', 'sport']);
  assert.deepEqual(all.focus.map((t) => t.id), ['focusThere', 'focusHere']);
  assert.deepEqual(all.groups[3].tasks, []); // focus tasks are not repeated in their domain
  assert.deepEqual(all.groups[3].goals.map((g) => g.id), ['g2']);
  // The parent: its sub-domain without a path in full; the one with a path (its own chat), agenda only.
  const studies = buildToday({ goals: goalsDoc, tasks: tasksDoc, domains: REGISTRY, now, tz: 'UTC', scope: 'studies' });
  assert.deepEqual(studies.groups.map((g) => [g.domain, g.agenda]), [['studies', false], ['studies/course-b', false], ['studies/course-a', true]]);
  assert.deepEqual(studies.groups[0].undated.map((t) => t.id), ['parentUndated']);
  assert.deepEqual(studies.groups[0].goals.map((g) => g.id), ['g1']); // category "Studies" = the domain's name
  assert.deepEqual(studies.groups[2].later, []);
  // From the root folder: every other domain is agenda (dated only).
  const root = buildToday({ goals: goalsDoc, tasks: tasksDoc, domains: REGISTRY, now, tz: 'UTC', scope: 'sport', root: true });
  assert.deepEqual(root.groups.map((g) => [g.domain, g.agenda]), [['sport', false], ['studies', true], ['studies/course-a', true], ['studies/course-b', true]]);
  assert.deepEqual(root.groups[2].undated, []);
});

test('domains: chat scope and root folder', () => {
  const doc = domains.normalize({ root: '~/hub/', domains: [
    { id: 'a', name: 'A', paths: ['~/hub'] },
    { id: 'b', name: 'B', paths: ['/b'] },
    { id: 'b/x', name: 'X' },
    { id: 'b/x/deep', name: 'Deep' },
    { id: 'b/y', name: 'Y', paths: ['/b/y'] },
    { id: 'b/y/z', name: 'Z' },
  ] });
  assert.equal(doc.root, '~/hub');
  const sc = domains.chatScope(doc, 'b');
  assert.deepEqual([[...sc.own].sort(), [...sc.agenda].sort(), sc.others], [['b', 'b/x', 'b/x/deep'], ['b/y', 'b/y/z'], false]);
  assert.deepEqual([...domains.chatScope(doc, 'b/y/z').agenda], []); // no parents
  assert.equal(domains.isRoot(doc, '/home/me/hub', '/home/me'), true);
  assert.equal(domains.isRoot(doc, '/home/me/hub/scripts', '/home/me'), true);
  assert.equal(domains.isRoot(doc, '/b', '/home/me'), false);
  assert.equal(domains.isRoot(domains.normalize({ domains: doc.domains }), '/home/me/hub', '/home/me'), false);
  const cleared = domains.applyOps(doc, [{ type: 'setRoot', path: null }]);
  assert.equal(cleared.root, undefined);
  assert.equal(domains.commitMessage([{ type: 'setRoot', path: '/x' }]), 'domains: root folder');
});

// ---- Linked chats ----

/** @param {string} id @param {string|null} parent @param {string} at */
const chat = (id, parent, at) => ({ id, title: `Chat ${id}`, parent, addedAt: `2026-11-0${at}T10:00:00Z` });

test('chats: link keeps one owner, relink moves, unlink lifts the children', () => {
  let doc = tasks.emptyDoc();
  doc = tasks.applyOps(doc, [
    { type: 'add', task: task('t_a') }, { type: 'add', task: task('t_b') },
    { type: 'link', id: 't_a', chat: chat('c1', null, '1') },
    { type: 'link', id: 't_a', chat: chat('c2', 'c1', '2') },
    { type: 'link', id: 't_a', chat: chat('c3', 'c2', '3') },
    { type: 'link', id: 't_b', chat: chat('c1', null, '4') }, // already in t_a: ignored
    { type: 'link', id: 't_a', chat: chat('c1', null, '5') }, // repeated: ignored
    { type: 'link', id: 't_a', chat: chat('c4', 'nope', '4') }, // unknown parent → root
  ]);
  const a = () => /** @type {any} */ (doc.tasks.find((t) => t.id === 't_a'));
  assert.deepEqual(a().sessions.map((/** @type {any} */ c) => [c.id, c.parent]), [['c1', null], ['c2', 'c1'], ['c3', 'c2'], ['c4', null]]);
  assert.equal(doc.tasks[1].sessions, undefined);
  assert.deepEqual(tasks.chatTree(a()).map((n) => [n.chat.id, n.children.map((/** @type {any} */ c) => c.chat.id)]), [['c1', ['c2']], ['c4', []]]);

  // Unlinking the middle chat hands its child to the grandparent; unlinking an unknown id does nothing.
  doc = tasks.applyOps(doc, [{ type: 'unlink', id: 't_a', sessions: ['c2', 'zzz'] }]);
  assert.deepEqual(a().sessions.map((/** @type {any} */ c) => [c.id, c.parent]), [['c1', null], ['c3', 'c1'], ['c4', null]]);

  // Relink moves a chat to another task (it leaves the first one, children lifted).
  doc = tasks.applyOps(doc, [{ type: 'relink', id: 't_b', chat: chat('c1', null, '1') }]);
  assert.deepEqual(a().sessions.map((/** @type {any} */ c) => [c.id, c.parent]), [['c3', null], ['c4', null]]);
  assert.deepEqual(doc.tasks[1].sessions?.map((c) => c.id), ['c1']);

  doc = tasks.applyOps(doc, [{ type: 'unlink', id: 't_b', sessions: ['c1'] }]);
  assert.ok(!('sessions' in doc.tasks[1]), 'an empty list is omitted');
});

test('chats: normalize repairs a damaged list and applyOps ignores a missing task', () => {
  const doc = tasks.normalize({ tasks: [{ id: 't_a', title: 'A', sessions: [
    { id: 'c1', title: 'One', parent: 'c1', addedAt: 'x' }, // own parent → root
    { id: 'c1', title: 'Repeated' },
    { id: 'c2', parent: 'missing' },
    { id: 'c3', parent: 'c2', addedAt: 'y' },
    null, { title: 'no id' },
  ] }, { id: 't_b', title: 'B', sessions: [] }] });
  assert.deepEqual(doc.tasks[0].sessions, [
    { id: 'c1', title: 'One', parent: null, addedAt: 'x' },
    { id: 'c2', title: '', parent: null, addedAt: '' },
    { id: 'c3', title: '', parent: 'c2', addedAt: 'y' },
  ]);
  assert.ok(!('sessions' in doc.tasks[1]));
  assert.deepEqual(tasks.applyOps(doc, [{ type: 'link', id: 'nope', chat: chat('c9', null, '1') }]), doc);
});

test('chats: closing a task or an occurrence does not touch its chats; commit message names the task', () => {
  const t = task('t_a', { repeat: { type: 'days', every: 1 }, due: FRI });
  const base = tasks.applyOps(tasks.emptyDoc(), [{ type: 'add', task: t }, { type: 'link', id: 't_a', chat: chat('c1', null, '1') }]);
  const ops = /** @type {import('../lib/tasks.js').Op[]} */ ([{ type: 'done', id: 't_a', at: '2026-11-05T00:00:00Z', today: FRI, nextId: 't_n' }]);
  const after = tasks.applyOps(base, ops);
  assert.equal(after.tasks[0].sessions?.length, 1);
  assert.ok(!after.tasks[1].sessions, 'the next occurrence starts without chats');
  const link = /** @type {import('../lib/tasks.js').Op[]} */ ([{ type: 'unlink', id: 't_a', sessions: ['c1'] }]);
  assert.equal(tasks.commitMessage(link, base, after), 'tasks: chats “Task t_a”');
});

// ---- Subtasks: tasks with a parent ----

const at = '2026-11-05T00:00:00Z';
/** @param {import('../lib/tasks.js').TasksDoc} doc */
const states = (doc) => doc.tasks.map((t) => `${t.id}:${t.status}`).join(' ');

test('subtasks: a task with a parent; children, descendants, progress and what counts as a step', () => {
  const doc = tasks.applyOps(tasks.emptyDoc(), [
    { type: 'add', task: task('a') }, { type: 'add', task: task('b', { parent: 'a' }) },
    { type: 'add', task: task('c', { parent: 'b' }) }, { type: 'add', task: task('d', { parent: 'a', domain: 'home' }) },
    { type: 'add', task: task('e', { parent: 'a', due: FRI }) }, { type: 'add', task: task('f', { parent: 'nope' }) },
  ]);
  assert.equal(doc.tasks.find((t) => t.id === 'f')?.parent, undefined, 'an unknown parent is left out');
  assert.deepEqual(tasks.children(doc, 'a').map((t) => t.id), ['b', 'd', 'e']);
  assert.deepEqual(tasks.descendants(doc, 'a').map((t) => t.id), ['b', 'c', 'd', 'e']);
  assert.deepEqual(['b', 'c', 'd', 'e'].map((id) => tasks.isStep(doc, /** @type {any} */ (doc.tasks.find((t) => t.id === id)))), [true, true, false, false]);
  const after = tasks.applyOps(doc, [{ type: 'done', id: 'b', at, today: FRI, nextId: null }, { type: 'drop', id: 'd', at, today: FRI, nextId: null }]);
  assert.deepEqual(tasks.progress(after, /** @type {any} */ (after.tasks[0])), { done: 1, total: 2 }, 'dropped ones do not count');

  // Moving under another task: never under itself or something under it.
  const moved = tasks.applyOps(doc, [{ type: 'edit', id: 'a', fields: { parent: 'c' } }, { type: 'edit', id: 'c', fields: { parent: 'e' } }, { type: 'edit', id: 'd', fields: { parent: null } }]);
  assert.deepEqual(moved.tasks.map((t) => t.parent ?? '-').join(' '), '- a e - a -');
});

test('subtasks: closing a task closes the open ones under it, and reopening brings back exactly those', () => {
  const base = tasks.applyOps(tasks.emptyDoc(), [
    { type: 'add', task: task('a') }, { type: 'add', task: task('b', { parent: 'a', domain: 'other' }) },
    { type: 'add', task: task('c', { parent: 'b' }) }, { type: 'add', task: task('d', { parent: 'a' }) },
    { type: 'add', task: task('e', { parent: 'a' }) },
    { type: 'done', id: 'd', at: '2026-11-01T00:00:00Z', today: FRI, nextId: null },
    { type: 'drop', id: 'e', at: '2026-11-01T00:00:00Z', today: FRI, nextId: null },
  ]);
  for (const type of /** @type {const} */ (['done', 'drop'])) {
    const closed = tasks.applyOps(base, [{ type, id: 'a', at, today: FRI, nextId: null }]);
    const s = type === 'done' ? 'done' : 'dropped';
    assert.equal(states(closed), `a:${s} b:${s} c:${s} d:done e:dropped`);
    assert.equal(states(tasks.applyOps(closed, [{ type: 'reopen', id: 'a' }])), 'a:open b:open c:open d:done e:dropped');
    // One of them can be brought back alone, with what went down with it.
    assert.equal(states(tasks.applyOps(closed, [{ type: 'reopen', id: 'b' }])), `a:${s} b:open c:open d:done e:dropped`);
  }
  // Deleting a task deletes what is under it.
  assert.equal(states(tasks.applyOps(base, [{ type: 'delete', id: 'b' }])), 'a:open d:done e:dropped');
});

test('subtasks: a repeating task copies its parts, shifting their dates, and reopening takes the copy back', () => {
  const base = tasks.applyOps(tasks.emptyDoc(), [
    { type: 'add', task: task('a', { repeat: { type: 'days', every: 7 }, due: FRI }) },
    { type: 'add', task: task('b', { parent: 'a', due: '2026-10-21' }) }, { type: 'add', task: task('c', { parent: 'b' }) },
    { type: 'add', task: task('d', { parent: 'a' }) }, { type: 'drop', id: 'd', at: '2026-10-01T00:00:00Z', today: FRI, nextId: null },
    { type: 'link', id: 'b', chat: chat('c1', null, '1') },
  ]);
  const doc = tasks.applyOps(base, [{ type: 'done', id: 'a', at, today: FRI, nextId: 'n' }]);
  const copies = doc.tasks.filter((t) => t.createdAt === at);
  assert.deepEqual(copies.map((t) => [t.id, t.parent, t.due, t.status, t.sessions]), [
    ['n', undefined, '2026-10-30', 'open', undefined], ['n-1', 'n', '2026-10-28', 'open', undefined], ['n-2', 'n-1', null, 'open', undefined],
  ]);
  assert.equal(states(tasks.applyOps(doc, [{ type: 'reopen', id: 'a' }])), 'a:open b:open c:open d:dropped');
});

test('subtasks: chats live in the task they are about, and a part stays out of the archive while its task does', () => {
  const doc = tasks.applyOps(tasks.emptyDoc(), [
    { type: 'add', task: task('a') }, { type: 'add', task: task('b', { parent: 'a' }) },
    { type: 'link', id: 'a', chat: chat('c1', null, '1') }, { type: 'link', id: 'b', chat: chat('c2', 'c1', '2') },
    { type: 'done', id: 'b', at: '2026-01-01T00:00:00Z', today: FRI, nextId: null },
  ]);
  assert.deepEqual(doc.tasks[1].sessions?.map((c) => [c.id, c.parent]), [['c2', null]], 'a chat of another task cannot be its parent');
  assert.deepEqual(Object.keys(tasks.splitArchive(doc, FRI).byYear), []);
  const both = tasks.applyOps(doc, [{ type: 'done', id: 'a', at: '2026-01-02T00:00:00Z', today: FRI, nextId: null }]);
  assert.deepEqual(tasks.splitArchive(both, FRI).byYear['2026']?.map((t) => t.id), ['a', 'b']);
});

test('subtasks: the older shape (a subtasks list) is read as tasks with a parent', () => {
  const doc = tasks.normalize({ tasks: [
    { id: 't_a', title: 'Trip', domain: 'home', status: 'open', createdAt: 'x', subtasks: [
      { id: 's_1', title: 'Pack', done: true }, { id: 's_2', title: 'Flights', done: false, task: 't_b' },
      { id: 't_b', title: 'Same id as a task', done: false }, null,
    ], sessions: [
      { id: 'c1', parent: null }, { id: 'c2', parent: 'c1', subtask: 's_1' }, { id: 'c3', parent: 'c2' }, { id: 'c4', parent: null, subtask: 's_2' },
    ] },
    { id: 't_b', title: 'Book flights', domain: 'money', status: 'open', subtasks: [] },
    { id: 't_c', title: 'Closed', domain: 'home', status: 'done', doneAt: 'z', subtasks: [{ id: 's_3', title: 'Left', done: false }] },
  ] });
  assert.deepEqual(doc.tasks.map((t) => [t.id, t.parent ?? '-', t.domain, t.status, (t.sessions ?? []).map((c) => `${c.id}<${c.parent ?? '-'}`).join(',')]), [
    ['t_a', '-', 'home', 'open', 'c1<-'],
    ['s_1', 't_a', 'home', 'done', 'c2<-,c3<c2'],
    ['t_b-t_a', 't_a', 'home', 'open', ''],
    ['t_b', 't_a', 'money', 'open', 'c4<-'],
    ['t_c', '-', 'home', 'done', ''],
    ['s_3', 't_c', 'home', 'done', ''],
  ]);
  assert.ok(doc.tasks.every((t) => !('subtasks' in t)));
  // Saved and read again, nothing changes.
  assert.deepEqual(tasks.normalize(JSON.parse(tasks.serialize(doc))), doc);
});
