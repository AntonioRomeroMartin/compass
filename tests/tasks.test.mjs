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
    task: task('t1', { due: '2026-10-22', repeat: { type: 'weekly', days: [4] }, focus: true, subtasks: [{ id: 's1', title: 'Step', done: true }] }),
  }]);
  /** @type {import('../lib/tasks.js').Op[]} */
  const ops = [{ type: 'done', id: 't1', at: '2026-10-23T08:00:00Z', today: FRI, nextId: 't2' }];
  const doc = tasks.applyOps(base, ops);
  const [done, next] = doc.tasks;
  assert.equal(done.status, 'done');
  assert.equal(done.doneAt, '2026-10-23T08:00:00Z');
  assert.equal(done.next, 't2');
  assert.equal(next.id, 't2');
  assert.equal(next.status, 'open');
  assert.equal(next.due, '2026-10-29');
  assert.equal(next.focus, false);
  assert.deepEqual(next.subtasks, [{ id: 's1', title: 'Step', done: false }]);
  assert.equal('next' in next, false);
  // Re-applied (e.g. after a conflict): nothing doubles.
  assert.equal(tasks.applyOps(doc, ops).tasks.length, 2);
  // Reopening removes the occurrence it created.
  const reopened = tasks.applyOps(doc, [{ type: 'reopen', id: 't1' }]);
  assert.deepEqual(reopened.tasks.map((t) => [t.id, t.status]), [['t1', 'open']]);
  assert.equal(reopened.tasks[0].doneAt, null);
  // Dropping with nextId null ends the series.
  const stopped = tasks.applyOps(base, [{ type: 'drop', id: 't1', at: 'x', today: FRI, nextId: null }]);
  assert.deepEqual(stopped.tasks.map((t) => t.status), ['dropped']);
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

test('tasks: edit, subtasks, normalize and commit message', () => {
  let doc = tasks.applyOps(tasks.emptyDoc(), [{ type: 'add', task: task('a', { title: 'Write report' }) }]);
  doc = tasks.applyOps(doc, [
    { type: 'edit', id: 'a', fields: { due: '2026-11-02', notes: 'Line 1\nLine 2' } },
    { type: 'addSub', id: 'a', sub: { id: 's1', title: 'Outline', done: false } },
    { type: 'toggleSub', id: 'a', subId: 's1', done: true },
    { type: 'edit', id: 'gone', fields: { title: 'x' } },
  ]);
  assert.equal(doc.tasks[0].due, '2026-11-02');
  assert.deepEqual(doc.tasks[0].subtasks, [{ id: 's1', title: 'Outline', done: true }]);
  assert.deepEqual(tasks.normalize(JSON.parse(tasks.serialize(doc))), doc);
  const raw = tasks.normalize({ tasks: [{ id: 'x', title: 'X', due: '2026-02-30', status: 'weird', repeat: { type: 'days', every: 0 }, subtasks: [null, { id: 's', title: 'S' }] }, { title: 'no id' }] });
  assert.equal(raw.tasks.length, 1);
  assert.deepEqual([raw.tasks[0].due, raw.tasks[0].status, raw.tasks[0].repeat, raw.tasks[0].focus], [null, 'open', null, false]);
  assert.deepEqual(raw.tasks[0].subtasks, [{ id: 's', title: 'S', done: false }]);
  const ops = /** @type {import('../lib/tasks.js').Op[]} */ ([{ type: 'edit', id: 'a', fields: { due: FRI } }]);
  assert.equal(tasks.commitMessage(ops, doc, tasks.applyOps(doc, ops)), 'tasks: moved “Write report”');
  assert.equal(tasks.commitMessage([{ type: 'done', id: 'a', at: 'x', today: FRI, nextId: null }], doc, doc), 'tasks: done “Write report”');
});

test('due windows: overdue, today (late included) and this week', () => {
  const late = task('a', { due: '2026-10-20' });
  const today = task('b', { due: FRI });
  const sunday = task('c', { due: '2026-10-25' });
  const monday = task('d', { due: '2026-10-26' });
  const undated = task('e');
  /** @param {'overdue'|'today'|'week'} w */
  const ids = (w) => [late, today, sunday, monday, undated].filter((t) => tasks.isDueWithin(t, w, FRI)).map((t) => t.id);
  assert.deepEqual(ids('overdue'), ['a']);
  assert.deepEqual(ids('today'), ['a', 'b']);
  assert.deepEqual(ids('week'), ['a', 'b', 'c']);
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

test('today: focus, then by domain; a subdomain sees the dated items of its parent', () => {
  const now = new Date('2026-10-23T10:00:00Z');
  const tasksDoc = tasks.applyOps(tasks.emptyDoc('UTC'), [
    { type: 'add', task: task('own', { domain: 'studies/course-a', due: '2026-10-24' }) },
    { type: 'add', task: task('late', { domain: 'studies/course-a', due: '2026-10-01' }) },
    { type: 'add', task: task('parent', { domain: 'studies', due: FRI }) },
    { type: 'add', task: task('parentUndated', { domain: 'studies', ongoing: 'notes/p.md' }) },
    { type: 'add', task: task('ongoing', { domain: 'studies/course-a', ongoing: 'notes/a.md' }) },
    { type: 'add', task: task('sibling', { domain: 'studies/course-b', due: FRI }) },
    { type: 'add', task: task('nextWeek', { domain: 'studies/course-a', due: '2026-10-26' }) },
    { type: 'add', task: task('undated', { domain: 'studies/course-a' }) },
    { type: 'add', task: task('focusHere', { domain: 'studies/course-a' }) },
    { type: 'add', task: task('focusThere', { domain: 'sport', due: FRI }) },
    { type: 'add', task: task('closed', { domain: 'studies/course-a', due: FRI, status: 'done' }) },
    { type: 'focus', id: 'focusHere', focus: true },
    { type: 'focus', id: 'focusThere', focus: true },
  ]);
  const goalsDoc = goals.normalize({ timeZone: 'UTC', goals: [
    { id: 'g1', kind: 'goal', title: 'Study hours', category: 'Studies', horizon: 'week', target: 10, progress: {}, repeat: true },
    { id: 'g2', kind: 'goal', title: 'Runs', category: 'sport', horizon: 'week', target: 3, progress: {}, repeat: true },
    { id: 'g3', kind: 'goal', title: 'Read', category: 'Reading', horizon: 'month', target: 1, progress: {}, repeat: true },
  ] });
  const view = buildToday({ goals: goalsDoc, tasks: tasksDoc, domains: REGISTRY, now, tz: 'UTC', scope: 'studies/course-a' });
  assert.equal(view.date, FRI);
  assert.equal(view.week, '2026-W43');
  assert.deepEqual(view.focus.map((t) => t.id), ['focusHere']);
  assert.equal(view.focusElsewhere, 1);
  assert.deepEqual(view.groups.map((g) => [g.domain, g.inherited]), [['studies/course-a', false], ['studies', true]]);
  const [own, parent] = view.groups;
  assert.deepEqual(own.tasks.map((t) => t.id), ['late', 'own']);
  assert.deepEqual(own.ongoing.map((t) => t.id), ['ongoing']);
  assert.equal(own.label, 'Studies › Course A');
  assert.deepEqual(parent.tasks.map((t) => t.id), ['parent']);
  assert.deepEqual(parent.goals.map((g) => g.id), ['g1']); // category "Studies" = the domain's name
  assert.deepEqual(parent.ongoing, []); // undated items of the parent stay out
  // Without a scope: everything, in registry order; unregistered categories at the end.
  const all = buildToday({ goals: goalsDoc, tasks: tasksDoc, domains: REGISTRY, now, tz: 'UTC' });
  assert.deepEqual(all.groups.map((g) => g.domain), ['studies', 'studies/course-a', 'studies/course-b', 'sport']);
  assert.deepEqual(all.focus.map((t) => t.id), ['focusThere', 'focusHere']);
  assert.deepEqual(all.groups[3].tasks, []); // focus tasks are not repeated in their domain
  assert.deepEqual(all.groups[3].goals.map((g) => g.id), ['g2']);
  // The parent sees its subdomains.
  const studies = buildToday({ goals: goalsDoc, tasks: tasksDoc, domains: REGISTRY, now, tz: 'UTC', scope: 'studies' });
  assert.deepEqual(studies.groups.map((g) => g.domain), ['studies', 'studies/course-a', 'studies/course-b']);
});
