# Progress — compass

## Current status
- Version 1.8: code in `lib/` + `app/` and the `compass` CLI.

## Sessions (most recent first)
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
