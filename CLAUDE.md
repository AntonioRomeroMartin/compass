# compass — goals app and personal dashboard (PWA)

**Public** repo: code only. Never add personal data, real categories or goals, tokens, local paths
or names of private repos (not even in tests, examples or docs). Examples must be generic and must not mirror
anyone's real categories. Everything in this repo is written in English: code, comments, docs, commits.
Each user's data lives in their own private repo.

## Rules
- File and folder names ALWAYS in English.
- HTML + JS with no build step, with `// @ts-check` and JSDoc types. No third-party scripts or resources
  (the CSP in `index.html` only allows `'self'` and `https://api.github.com`).
- Structure: `lib/` (logic shared by app and CLI: `period.js`, `goals.js`, `github.js`), `app/` (PWA; `index.html`
  and `sw.js` at the root), `cli/` (`compass.mjs` + `repo.mjs`: git on a local checkout, same operations as the app).
  Periods are computed in the `timeZone` of the data file.
- JSON schema: see `lib/goals.js` (types `Goal` and `GoalsDoc`). Data commits use the prefix `goals:`; code commits, `compass:`.
- New logic goes in `lib/` and is used by both sides; never duplicated between app and CLI.
- Before pushing: `node --test tests/`. If the `SHELL` list in `sw.js` changes, bump `VERSION`.

## Saving progress
As you go, without waiting for the end (the session may close without notice): after each important
change, update `progress.md` (date, what was done, next step) and commit and push to `main`.
