# Progress — compass

## Current status
- Version 2.11 (phase 4: books and journal). The app is a dashboard: Home (one card per area), Today (overdue, today and
  the next 7 days, "No date" folded per area), Areas (one page per area with a sub-area filter and one block per
  module), Goals, Habits and Books tabs, a Journal page (from Today and More), and the "+" sheets (Task · Goal · Habit · Book). Code split into
  `app/core/`, `app/modules/` (tasks, goals, habits, books) and `app/views/`.
- Data: tasks closed more than 30 days ago move to `tasks-YYYY.json`; the app reads with ETags. Goals do not repeat
  and keep one progress number; tasks do not link to goals. Habits (`habits.json`) have no streaks.
- Area pages: tasks, goals and habits always; other modules (books) only in the areas that have items of theirs.
- Books (`books.json`): status (want/reading/read/dropped) that sets the start and finish dates, rating, notes, quotes,
  Open Library search and cover id; no page count; the area is optional (none = general reading). CLI
  `compass book…`; app: Books tab, a block on the page of areas with books, and a Books card on Home.
- Journal (`journal.json`): one text per day plus notes with the time; sealed with the user's encryption password
  (`lib/crypt.js`: AES-256-GCM, PBKDF2-SHA256; WebCrypto in the app, node:crypto in `cli/crypt.mjs`, same format).
  The app keeps the password per device (More → Encryption password) and shows the journal at the end of Today and
  on its page; the CLI takes it from $COMPASS_PASSPHRASE or the keyring (secret-tool). Commit messages name only days.
- Tests: `node --test tests/*.test.mjs` (68). CLI `domain delete` removes an empty domain.
- Next: phase 6 summaries of Fitness and University (what to show: to decide).
- Rest of phase 3: offline editing (local queue; offline is read-only today), managing areas from the app (create,
  rename, reorder). Deferred: day close and Focus in the app (the CLI still supports focus).
- Later phases: 5 trading and finance (client-side encrypted data) · 6 summaries of other areas.
