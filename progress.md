# Progress — compass

## Current status
- Version 1.9 (phase 2): tasks (`lib/tasks.js`), domains (`lib/domains.js`) and the Today view (`lib/today.js`) in
  `lib/`; the CLI handles tasks, domains and a full `compass today`. The app is unchanged (tasks UI = phase 3).
- Next: phase 3, the tasks UI in the app (Today grouped by domain with Focus on top, day close asking for each
  open task: tomorrow / another day / drop), reusing `lib/today.js` and `lib/tasks.js`. Later: move closed tasks
  to yearly files (e.g. `tasks/2026.json`) before `tasks.json` grows near the 1 MB limit of the contents API.

## Sessions (most recent first)
- 2026-10-23 · v1.9, phase 2: `lib/domains.js` (registry `{id, name, parent?, paths?, color?}`, hierarchical ids,
  folder → domain by longest path, scope = domain + subdomains + dated items of parents; goal categories = domain
  id or name), `lib/tasks.js` (tasks with domain, due, notes, subtasks, repeat, focus ≤ 3, goal link, ongoing;
  next occurrence on close; ops `tasks:`), `lib/today.js`, `goals.summary`, date helpers in `period.js`. CLI: `tasks`,
  `task add|done|undo|drop|edit|move|focus|unfocus|sub|show`, `domains`, `domain add|edit`, `today --domain|--cwd
  --timeout` (pull = fetch with a timeout + local rebase). `repo.mjs` writes several files in one commit with the
  same retry (task + linked goal) and creates missing files. Tests: 48 (`node --test tests/*.test.mjs`; the plain
  `tests/` form fails on Node 22), including a two-file race between clones and a pull timeout.
- 2026-10-23 · Privacy and English pass: generic examples in tests, README and placeholder; all comments, docs and tests in English.
- 2026-10-23 · v1.8: the repo is renamed `compass` (name, title, manifest and cache `compass-v5`; `localStorage` keys stay `goals.*` to keep existing settings). Next: tasks module.
- 2026-10-23 · v1.7: `js/` → `lib/` (period, goals —formerly store—, github) and `app/` (app.js, styles.css); `period.js` is no longer a CLI. New CLI `cli/compass.mjs` (`today`, `goals`, `goal add|inc|set|done|sub|edit|archive`, `period`) on a local git checkout, config in `~/.config/compass/config.json`; if the push conflicts it undoes its commit and re-applies the operations. `sw.js` v4. 25 tests (4 CLI ones with temporary git repos, including a race between two clones) + app checked in the browser.
- 2026-09-29 · v1.6: optional sub-goals (`subgoals: [{id, title, done: [period keys]}]`), edited in the form and ticked on the card; in habits they clear on period change. Standalone `addSub`/`editSub`/`toggleSub`/`removeSub` operations so changes from another device are not overwritten.
- 2026-09-29 · v1.5: optional `location` (📍 chip) and `notes` fields in the goal form.
- 2026-09-29 · v1.4: the horizon is when a goal expires. One-off goals (`repeat:false`, `period`) move to Past with ✓/✗ and % completion when they expire; Repeat checkbox for habits; Active/Past/Archived selector.
- 2026-09-28 · v1.3: commit prefix `goals:`; default data file `goals.json`.
- 2026-09-28 · v1.2: UI, errors, README and commit bodies in English; default file `goals.json`.
- 2026-09-28 · v1.1: no default data (user, repo, categories, time zone); time zone stored in the data file; category management; creates the file if missing; README for other users.
- 2026-09-28 · v1: views by horizon and category, filter, per-period targets, archive/delete, grouped saving (2 s), conflict resolution, read-only offline mode, PWA.
