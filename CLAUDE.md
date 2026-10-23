# compass — goals app and personal dashboard (PWA)

**Public** repo: code only. Never add personal data, real categories or goals, tokens, local paths
or names of private repos (not even in tests, examples or docs). Examples must be generic and must not mirror
anyone's real categories. Everything in this repo is written in English: code, comments, docs, commits.
Each user's data lives in their own private repo.

## Rules
- File and folder names ALWAYS in English.
- HTML + JS with no build step, with `// @ts-check` and JSDoc types. No third-party scripts or resources
  (the CSP in `index.html` only allows `'self'` and `https://api.github.com`).
- Structure: `lib/` (logic shared by app and CLI: `period.js`, `goals.js`, `tasks.js`, `domains.js`, `today.js`,
  `github.js`), `app/` (PWA; `index.html` and `sw.js` at the root), `cli/` (`compass.mjs` + `repo.mjs`: git on a local
  checkout, same operations as the app). Periods and civil dates are computed in the `timeZone` of the data file.
- One module per kind of data, each with its own file in the data repo and the same shape: `normalize`, `applyOps`
  (operations re-applied on the latest version), `serialize`, `commitMessage`, plus `summary` for the Today view (goals, tasks).
- JSON schema: see the types in `lib/goals.js` (`Goal`, `GoalsDoc`), `lib/tasks.js` (`Task`, `TasksDoc`) and
  `lib/domains.js` (`Domain`, `DomainsDoc`). Goal categories and domains are one list (category = domain id or name).
- Data commits use the prefix of the file they change (`goals:`, `tasks:`, `domains:`); code commits, `compass:`.
- New logic goes in `lib/` and is used by both sides; never duplicated between app and CLI.
- Before pushing: `node --test tests/*.test.mjs`. If the `SHELL` list in `sw.js` changes, bump `VERSION`.

## Saving progress
As you go, without waiting for the end (the session may close without notice): after each important
change, update `progress.md` (date, what was done, next step) and commit and push to the working branch
(`main` is protected: everything goes in through a PR).
