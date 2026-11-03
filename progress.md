# Progress — compass

## Current status
- Version 2.12 (phase 3 done: areas edited in the app, offline editing). The app is a dashboard: Home (one card per area), Today (overdue, today and
  the next 7 days, "No date" folded per area), Areas (one page per area with a sub-area filter and one block per
  module), Goals, Habits and Books tabs, a Journal page (from Today and More), and the "+" sheets (Task · Goal · Habit · Book). Code split into
  `app/core/`, `app/modules/` (tasks, goals, habits, books, journal, trades) and `app/views/`.
- Data: tasks closed more than 30 days ago move to `tasks-YYYY.json`; the app reads with ETags. Goals do not repeat
  and keep one progress number; tasks do not link to goals. Habits (`habits.json`) have no streaks.
- Area pages: tasks, goals and habits always; other modules (books, trades) only in the areas that have items of theirs.
- Books (`books.json`): status (want/reading/read/dropped) that sets the start and finish dates, rating, notes, quotes,
  Open Library search and cover id; no page count; the area is optional (none = general reading). CLI
  `compass book…`; app: Books tab, a block on the page of areas with books, and a Books card on Home.
- Journal (`journal.json`): one text per day plus notes; sealed with the user's encryption password
  (`lib/crypt.js`: AES-256-GCM, PBKDF2-SHA256; WebCrypto in the app, node:crypto in `cli/crypt.mjs`, same format).
  The app keeps the password per device (More → Encryption password) and shows the journal at the end of Today and
  on its page; the CLI takes it from $COMPASS_PASSPHRASE or the keyring (secret-tool). Commit messages name only days.
- Areas: Edit on the Areas list adds areas and sub-areas, renames them (the id stays), reorders them by dragging ⠿
  (`move` op; CLI `domain move`) and deletes an empty one (`domains.usage`, shared with CLI `domain delete`).
- Offline: everything can be edited on the copy saved on the device; changes wait there and are uploaded when back
  online (the header shows only a crossed-out cloud while offline).
- Events (`events.json`): exams, deadlines, trips (all day or with times, a last day, place, notes); tasks can point
  to the event they prepare (`task.event`) and move with it. A domain names the calendar its events are copied to
  (`--calendar`, `--calendar-color`; inherited). The sync is a plan (`compass calendar sync [--remote]`: push, pull of
  changes made in the calendar, conflicts) carried out by whoever has a calendar connector, then `calendar done`.
  App: events in Today, area pages (Events block) and Home cards, and a sheet to add or edit them.
- Trades (`trades.json`, sealed like the journal; `lib/trades.js`): what the exchange knows (market, symbol, side,
  size, prices and times, leverage, fees, funding, net PnL) plus what the trader adds (initial stop, setup, timeframe,
  target, emotion 1-5, discipline errors from lists that grow, notes). Risk, R and planned against achieved R:R; the
  panel (closed trades of a month / 3 months / year / all: figures, R curve, cuts by setup, market, side, timeframe and
  discipline; PnL in USD); risk limits in R (day, week, losses in a row) with the "no more trading today" banner on Home
  and in Trades, and the "Over a limit" error added by itself. A trade without a stop shows "no stop" and counts in PnL,
  not in R. App: Trades block on its area's page (limits edited there), the trade's sheet, figures on the area's Home
  card. CLI `compass trades|trade` (`cli/trades.mjs`; `trade add` stands in for the import). Commit messages only count.
- Local preview with sample data: `node tools/demo.mjs DIR`, then `python3 tools/serve.py 8767 --demo DIR` and open
  `/?demo` (a stand-in for GitHub's API on the same server; never touches a real data repo).
- `compass today --cwd PATH`: the folder's domain in full (tasks late/today/7 days, then Later and No date, every
  active goal); its sub-domains with their own paths, agenda only (not its parents); from the root folder
  (`compass domains root PATH`, `root` in domains.json), every other domain's agenda too.
- Tests: `node --test tests/*.test.mjs` (85), also run by GitHub on every PR.
- Next: phase 5, the exchanges' import (read-only API keys) and finance (budget, net worth, savings). Deferred: day close and Focus in the app (the CLI
  still supports focus), phase 6 summaries of Fitness and University.
