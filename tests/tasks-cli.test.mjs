// CLI tests for tasks, domains and today, against temporary git repos: `node --test tests/*.test.mjs`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { git, setup } from './helpers.mjs';

const GOALS = { version: 1, timeZone: 'UTC', categories: ['Sport'], goals: [] };

/** A registry whose paths live in the test's own temporary folder. @param {string} root */
const registry = (root) => ({
  version: 1,
  domains: [
    { id: 'studies', name: 'Studies', paths: [join(root, 'studies')] },
    { id: 'studies/course-a', name: 'Course A', parent: 'studies', paths: [join(root, 'studies', 'course-a')] },
    { id: 'studies/course-b', name: 'Course B', paths: [join(root, 'studies', 'course-b')] },
    { id: 'sport', name: 'Sport' },
  ],
});

/** @param {Record<string, unknown>} [extra] */
function setupWithDomains(extra = {}) {
  const ctx = setup({ 'goals.json': GOALS, ...extra });
  // The registry needs the temporary folder's path, so it is committed in a second step.
  writeFileSync(join(ctx.dir, 'a', 'domains.json'), JSON.stringify(registry(join(ctx.dir, 'work')), null, 2) + '\n');
  git(join(ctx.dir, 'a'), 'add', '.');
  git(join(ctx.dir, 'a'), 'commit', '-qm', 'domains');
  git(join(ctx.dir, 'a'), 'push', '-q');
  git(join(ctx.dir, 'b'), 'pull', '-q');
  return ctx;
}

test('tasks.json is created on the first write, with the zone of goals.json', () => {
  const { dir, run, read } = setup({ 'goals.json': { ...GOALS, timeZone: 'Asia/Tokyo' } });
  assert.equal(read('a', 'tasks.json'), null);
  const out = run('task', 'add', 'Buy shoes', '--domain', 'sport', '--due', '2026-12-01');
  assert.match(out, /^tasks: new “Buy shoes”/);
  assert.match(out, /Buy shoes — due 2026-12-01 .* · sport/);
  git(join(dir, 'b'), 'pull', '-q');
  const doc = read('b', 'tasks.json');
  assert.equal(doc.timeZone, 'Asia/Tokyo');
  assert.equal(doc.tasks[0].domain, 'sport');
  assert.equal(doc.tasks[0].status, 'open');
});

test('domain is required and must be registered (by id, name or last segment)', () => {
  const { dir, runAll, read } = setupWithDomains();
  assert.match(runAll('task', 'add', 'No domain').stderr, /needs a domain/);
  assert.match(runAll('task', 'add', 'Typo', '--domain', 'sprot').stderr, /unknown domain “sprot”/);
  assert.match(runAll('task', 'add', 'Nowhere', '--cwd', join(dir, 'elsewhere')).stderr, /no domain has a path containing --cwd/);
  assert.equal(read('a', 'tasks.json'), null);
  assert.equal(runAll('task', 'add', 'Read chapter', '--domain', 'course-a').status, 0);
  assert.equal(runAll('task', 'add', 'Gym bag', '--domain', 'Sport').status, 0);
  mkdirSync(join(dir, 'work', 'studies', 'course-b', 'week-1'), { recursive: true });
  assert.equal(runAll('task', 'add', 'Slides', '--cwd', join(dir, 'work', 'studies', 'course-b', 'week-1')).status, 0);
  assert.deepEqual(read('a', 'tasks.json').tasks.map((/** @type {any} */ t) => t.domain), ['studies/course-a', 'sport', 'studies/course-b']);
});

test('a repeating task creates its next occurrence when done or dropped', () => {
  const { run, read } = setupWithDomains();
  run('task', 'add', 'Water plants', '--domain', 'sport', '--repeat', 'every 3 days', '--due', '2026-01-10');
  const out = run('task', 'done', 'water');
  assert.match(out, /^next: · \[t_\w+\] Water plants — due \d{4}-\d{2}-\d{2} .*↻ every 3 d/m);
  let list = read('a', 'tasks.json').tasks;
  assert.deepEqual(list.map((/** @type {any} */ t) => t.status), ['done', 'open']);
  assert.equal(list[0].next, list[1].id);
  // Late: it counts from today, so the next one is 3 days from now.
  const today = JSON.parse(run('period')).day;
  const plus3 = new Date(Date.parse(today + 'T00:00:00Z') + 3 * 86400000).toISOString().slice(0, 10);
  assert.equal(list[1].due, plus3);
  run('task', 'drop', 'water');
  list = read('a', 'tasks.json').tasks;
  assert.deepEqual(list.map((/** @type {any} */ t) => t.status), ['done', 'dropped', 'open']);
  run('task', 'drop', 'water', '--stop');
  list = read('a', 'tasks.json').tasks;
  assert.deepEqual(list.map((/** @type {any} */ t) => t.status), ['done', 'dropped', 'dropped']);
  // undo picks the last closed copy.
  run('task', 'undo', 'water');
  assert.deepEqual(read('a', 'tasks.json').tasks.map((/** @type {any} */ t) => t.status), ['done', 'dropped', 'open']);
});

test('task add --stdin: several tasks in one commit, with shared and per-line options', () => {
  const { dir, runInput, read } = setupWithDomains();
  const input = [
    '"Pay the \\"fee\\"" --due 2026-11-02',
    '# a comment, and an empty line',
    '',
    "'Book the room' --domain sport --notes 'by phone'",
  ].join('\n');
  const res = runInput(input, 'task', 'add', '--stdin', '--domain', 'studies/course-a');
  assert.equal(res.status, 0, res.stderr);
  const list = read('a', 'tasks.json').tasks;
  assert.deepEqual(list.map((/** @type {any} */ t) => [t.title, t.domain, t.due, t.notes]),
    [['Pay the "fee"', 'studies/course-a', '2026-11-02', null], ['Book the room', 'sport', null, 'by phone']]);
  assert.equal(git(join(dir, 'a'), 'rev-list', '--count', 'HEAD').trim(), '3'); // init, domains and one commit for both
  assert.match(res.stdout, /Pay the "fee"[\s\S]*Book the room/);
  // One bad line: nothing is written, and the error names the line.
  const bad = runInput('"Fine" --domain sport\n"Wrong" --due someday', 'task', 'add', '--stdin', '--domain', 'sport');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /^error: line 2: /);
  assert.equal(read('a', 'tasks.json').tasks.length, 2);
});

test('no more than 3 tasks with focus', () => {
  const { runAll, read } = setupWithDomains();
  for (const t of ['One', 'Two', 'Three']) assert.equal(runAll('task', 'add', t, '--domain', 'sport', '--focus').status, 0);
  runAll('task', 'add', 'Four', '--domain', 'sport');
  const res = runAll('task', 'focus', 'four');
  assert.equal(res.status, 1);
  assert.match(res.stderr, /already 3 tasks with focus/);
  assert.equal(read('a', 'tasks.json').tasks.filter((/** @type {any} */ t) => t.focus).length, 3);
  assert.equal(runAll('task', 'add', 'Five', '--domain', 'sport', '--focus').status, 1);
  assert.equal(read('a', 'tasks.json').tasks.length, 4);
  runAll('task', 'unfocus', 'two');
  assert.equal(runAll('task', 'focus', 'four').status, 0);
  assert.deepEqual(read('a', 'tasks.json').tasks.filter((/** @type {any} */ t) => t.focus).map((/** @type {any} */ t) => t.title), ['One', 'Three', 'Four']);
});

test('today --cwd: the folder\'s domain, plus the dated items of its parent', () => {
  const { dir, run } = setupWithDomains();
  run('task', 'add', 'Problem set', '--domain', 'course-a', '--due', 'today');
  run('task', 'add', 'Thesis draft', '--domain', 'course-a', '--ongoing', 'notes/thesis.md');
  run('task', 'add', 'Someday reading', '--domain', 'course-a');
  run('task', 'add', 'Enrolment', '--domain', 'studies', '--due', 'today');
  run('task', 'add', 'Parent notes', '--domain', 'studies', '--ongoing', 'notes/parent.md');
  run('task', 'add', 'Lab report', '--domain', 'course-b', '--due', 'today');
  run('task', 'add', 'Stretch', '--domain', 'sport', '--due', 'today', '--focus');
  const out = run('today', '--cwd', join(dir, 'work', 'studies', 'course-a', 'week-2'));
  assert.match(out, /^Scope: Studies › Course A \[studies\/course-a\] \+ dated items of Studies \(from --cwd\)$/m);
  assert.match(out, /^Focus\n {2}\(\+1 in other domains\)$/m);
  assert.match(out, /^Studies › Course A \[studies\/course-a\]\n {2}· \[t_\w+\] Problem set — due \S+ \(today\)\n {2}↳ ongoing \[t_\w+\] Thesis draft → notes\/thesis\.md$/m);
  assert.match(out, /^Studies \[studies\] · parent, dated only\n {2}· \[t_\w+\] Enrolment/m);
  for (const hidden of ['Someday reading', 'Parent notes', 'Lab report', 'Stretch']) assert.doesNotMatch(out, new RegExp(hidden));
  // --domain gives the same; a folder outside every domain shows everything and says so.
  assert.equal(run('today', '--domain', 'course-a'), out.replace(' (from --cwd)', ''));
  const everything = run('today', '--cwd', join(dir, 'elsewhere'));
  assert.match(everything, /^Scope: everything \(no domain has a path containing --cwd\)$/m);
  assert.match(everything, /⭐ \[t_\w+\] Stretch/);
  assert.match(everything, /Lab report/);
  // tasks: the domain and its subdomains.
  const studies = run('tasks', '--domain', 'studies');
  assert.match(studies, /Lab report/);
  assert.doesNotMatch(studies, /Stretch/);
  assert.match(run('tasks', '--due', 'today'), /Stretch/);
  assert.doesNotMatch(run('tasks', '--due', 'today'), /Someday reading/);
});

test('if another device writes at the same time, our change is re-applied on top of theirs', () => {
  const { dir, run, read } = setupWithDomains();
  run('goal', 'add', '--title', 'Strength sessions', '--category', 'sport', '--horizon', 'week', '--target', '3');
  run('task', 'add', 'Leg day', '--domain', 'sport');
  // A pre-push hook simulates the other clone changing a goal and the task right before our push.
  const b = join(dir, 'b');
  const hook = join(dir, 'a', '.git', 'hooks', 'pre-push');
  writeFileSync(hook, `#!/bin/sh
[ -f "${dir}/fired" ] && exit 0
touch "${dir}/fired"
cd "${b}" && git pull -q && node -e '
const fs = require("fs");
const g = JSON.parse(fs.readFileSync("goals.json", "utf8")); g.goals[0].notes = "from b";
fs.writeFileSync("goals.json", JSON.stringify(g, null, 2) + "\\n");
const t = JSON.parse(fs.readFileSync("tasks.json", "utf8")); t.tasks[0].notes = "from b too";
fs.writeFileSync("tasks.json", JSON.stringify(t, null, 2) + "\\n");' && git commit -qam race && git push -q
exit 0
`);
  chmodSync(hook, 0o755);
  run('task', 'done', 'leg');
  git(b, 'pull', '-q');
  const goals = read('b');
  const list = read('b', 'tasks.json');
  assert.equal(goals.goals[0].notes, 'from b');
  assert.equal(goals.goals[0].progress, 0); // completing a task does not touch goals
  assert.equal(list.tasks[0].notes, 'from b too');
  assert.equal(list.tasks[0].status, 'done');
  assert.match(git(b, 'log', '-2', '--format=%s'), /^tasks: done “Leg day”\nrace\n$/);
});

test('a race that creates tasks.json on both sides keeps both tasks', () => {
  const { dir, run, read } = setup({ 'goals.json': GOALS });
  const b = join(dir, 'b');
  const hook = join(dir, 'a', '.git', 'hooks', 'pre-push');
  writeFileSync(hook, `#!/bin/sh
[ -f "${dir}/fired" ] && exit 0
touch "${dir}/fired"
cd "${b}" && COMPASS_CONFIG="${dir}/config-b.json" node "${new URL('../cli/compass.mjs', import.meta.url).pathname}" task add "From b" --domain sport >/dev/null
exit 0
`);
  chmodSync(hook, 0o755);
  writeFileSync(join(dir, 'config-b.json'), JSON.stringify({ repo: b }));
  run('task', 'add', 'From a', '--domain', 'sport');
  git(b, 'pull', '-q');
  assert.deepEqual(read('b', 'tasks.json').tasks.map((/** @type {any} */ t) => t.title).sort(), ['From a', 'From b']);
});

test('today does not wait for a slow pull: it warns and uses the local copy', () => {
  const { dir, run, runAll } = setupWithDomains();
  run('task', 'add', 'Offline task', '--domain', 'sport', '--due', 'today');
  const a = join(dir, 'a');
  // A remote that never answers.
  git(a, 'remote', 'set-url', 'origin', 'ssh://example.invalid/data.git');
  git(a, 'config', 'core.sshCommand', "sh -c 'sleep 30' x");
  const start = Date.now();
  const res = runAll('today', '--timeout', '1');
  const elapsed = Date.now() - start;
  assert.equal(res.status, 0);
  assert.ok(elapsed < 10000, `took ${elapsed} ms`);
  assert.match(res.stderr, /^warning: could not pull \(no answer in 1 s\); using the local copy$/m);
  assert.match(res.stdout, /Offline task/);
});

test('domains: list, add and edit (domains.json is created on the first write)', () => {
  const { dir, run, runAll, read } = setup({ 'goals.json': { ...GOALS, goals: [{ id: 'g1', kind: 'goal', title: 'Run', category: 'Sport', horizon: 'week', target: 1, progress: 0 }] } });
  assert.match(run('domains'), /No domains registered/);
  run('domain', 'add', 'studies', '--name', 'Studies', '--path', join(dir, 'work', 'studies'));
  assert.match(runAll('domain', 'add', 'studies/course-a/x').stderr, /parent “studies\/course-a” does not exist/);
  run('domain', 'add', 'studies/course-a', '--name', 'Course A');
  run('domain', 'edit', 'studies/course-a', '--add-path', join(dir, 'work', 'a'), '--color', 'teal');
  const doc = read('a', 'domains.json');
  assert.deepEqual(doc.domains, [
    { id: 'studies', name: 'Studies', paths: [join(dir, 'work', 'studies')] },
    { id: 'studies/course-a', name: 'Course A', parent: 'studies', paths: [join(dir, 'work', 'a')], color: 'teal' },
  ]);
  const out = run('domains');
  assert.match(out, /^studies — Studies · \S+$/m);
  assert.match(out, /^ {2}studies\/course-a — Course A · \S+ · teal$/m);
  assert.match(out, /^Not registered \(used by goals, tasks or habits\): Sport$/m);
  assert.match(git(join(dir, 'a'), 'log', '-1', '--format=%s'), /^domains: edited “studies\/course-a”, paths “studies\/course-a”$/m);
});

test('domain add and edit take several paths', () => {
  const { dir, run, read } = setup({ 'goals.json': GOALS });
  const [p1, p2, p3] = ['one', 'two', 'three'].map((x) => join(dir, 'work', x));
  run('domain', 'add', 'studies', '--path', p1, '--path', p2, '--path', p1);
  assert.deepEqual(read('a', 'domains.json').domains[0].paths, [p1, p2]);
  run('domain', 'edit', 'studies', '--add-path', p3, '--remove-path', p1, '--remove-path', p2);
  assert.deepEqual(read('a', 'domains.json').domains[0].paths, [p3]);
});

test('task location: add, show, edit and clear', () => {
  const { run, read } = setupWithDomains();
  run('task', 'add', 'Return books', '--domain', 'sport', '--location', 'library');
  assert.equal(read('a', 'tasks.json').tasks[0].location, 'library');
  assert.match(run('task', 'show', 'books'), /@ library/);
  run('task', 'edit', 'books', '--location', 'town hall');
  assert.equal(read('a', 'tasks.json').tasks[0].location, 'town hall');
  run('task', 'edit', 'books', '--location', 'none');
  assert.equal(read('a', 'tasks.json').tasks[0].location, null);
});

test('task delete needs --yes and removes the task, closed ones too', () => {
  const { run, runAll, read } = setupWithDomains();
  run('task', 'add', 'Old errand', '--domain', 'sport');
  run('task', 'done', 'errand');
  const refused = runAll('task', 'delete', 'errand');
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /for good.*--yes/);
  assert.equal(read('a', 'tasks.json').tasks.length, 1);
  run('task', 'delete', 'errand', '--yes');
  assert.deepEqual(read('a', 'tasks.json').tasks, []);
});

test('closed tasks older than 30 days move to the archive of their year on the next write', () => {
  const old = { id: 't_old', title: 'Old exam', domain: 'sport', status: 'done', doneAt: '2025-03-01T10:00:00.000Z', createdAt: '2025-02-01T10:00:00.000Z' };
  const recent = { id: 't_new', title: 'Recent run', domain: 'sport', status: 'done', doneAt: new Date().toISOString(), createdAt: new Date().toISOString() };
  const { run, read } = setupWithDomains({ 'tasks.json': { version: 1, timeZone: 'UTC', tasks: [old, recent] } });
  const out = run('task', 'add', 'Next one', '--domain', 'sport');
  assert.match(out, /archived 1 closed task/);
  assert.deepEqual(read('a', 'tasks.json').tasks.map((/** @type {any} */ t) => t.id).sort(), ['t_new', read('a', 'tasks.json').tasks.find((/** @type {any} */ t) => t.title === 'Next one').id].sort());
  assert.deepEqual(read('a', 'tasks-2025.json').tasks.map((/** @type {any} */ t) => t.id), ['t_old']);
  assert.match(run('tasks', '--archived'), /Old exam/);
  assert.doesNotMatch(run('tasks', '--all'), /Old exam/);
});
