# Progress — compass

## Current status
- Version 2.10 (phase 4 started: books). The app is a dashboard: Home (one card per area), Today (overdue, today and
  the next 7 days, "No date" folded per area), Areas (one page per area with a sub-area filter and one block per
  module), Goals, Habits and Books tabs, and the "+" sheets (Task · Goal · Habit · Book). Code split into
  `app/core/`, `app/modules/` (tasks, goals, habits, books) and `app/views/`.
- Data: tasks closed more than 30 days ago move to `tasks-YYYY.json`; the app reads with ETags. Goals do not repeat
  and keep one progress number; tasks do not link to goals. Habits (`habits.json`) have no streaks.
- Modules per area: tasks, goals and habits belong to every area; others (books) only to the areas that list them in
  `domains.json` (`modules`, inherited by sub-areas).
- Books (`books.json`): status (want/reading/read/dropped) that sets the start and finish dates, rating, notes, quotes,
  Open Library search and cover id; no page count. CLI `compass book…`; app tab, area block and Home card.
- Tests: `node --test tests/*.test.mjs` (64).
- Next: books without an area (a general Books card on Home; being decided). Then the journal (phase 4).
- Rest of phase 3: offline editing (local queue; offline is read-only today), managing areas from the app (create,
  rename, reorder). Deferred: day close and Focus in the app (the CLI still supports focus).
- Later phases: 5 trading and finance (client-side encrypted data) · 6 summaries of other areas.
