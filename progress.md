# Progress — compass

## Current status
- Version 2.1 (phase 3 in progress): the app is a dashboard with Home (one card per area), Today (overdue, today
  and the next 7 days, "No date" folded per area), Areas (one page per area with a sub-area filter and separate
  Tasks and Goals blocks) and a quick task sheet; split into `app/core/`, `app/modules/` (tasks, goals) and
  `app/views/`. Tasks closed more than 30 days ago move to `tasks-YYYY.json`; the app reads with ETags.
  Goals no longer repeat: habits will be a module of their own. 49 tests.
- Next (rest of phase 3): offline editing (local queue; offline is read-only today), managing areas from the app
  (create, rename, reorder), choosing modules per area in `domains.json`; CLI: `domain add` keeps only the last
  `--path`, and `task add/edit --location`. Deferred: day close and Focus in the app (the CLI still supports focus).
- Habits: a module of their own (to design), not repeating goals.
- Later phases: 4 journal and books · 5 trading and finance (client-side encrypted data) · 6 summaries of other areas.

## Sessions (most recent first)
- 2026-10-26 · v2.1: goals no longer repeat (habits will be a module of their own). Every goal belongs to one period
  (or has a deadline) and moves to Past when it ends; `normalize` drops `repeat` and gives an old repeating goal
  the period in which it was created. The goal form loses the Repeat checkbox (horizons read Today, This week…);
  the CLI loses `goal add --repeat`. Home cards no longer show tasks done in the last 7 days. The habit streaks
  added earlier the same day were reverted.
- 2026-10-23 · v2.0, phase 3 (app): app shell with tabs on the phone (Home · Today · Areas · + · Goals, More behind a
  gear) and a sidebar on wide screens (foldable areas tree, New at the bottom); Home cards per area (open, overdue,
  today, done in 7 days, next 3, goal bars); Today over the next 7 days instead of the rest of the ISO week; area
  pages with separate Tasks and Goals blocks (goal categories are the areas); task sheet (title, area and date chips,
  repeat, notes, subtasks, goal link under "More options"); light/dark switch; refresh every minute; module
  architecture (`areaSections`, `homeCard`, registry in `app/modules/index.js`). CLI: `task delete <task> --yes`;
  yearly archive of closed tasks (`compass tasks --archived`). App: conditional reads (ETag, 304 = nothing
  downloaded); a new device suggests the site's owner and default data path. `sw.js` v8.
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
