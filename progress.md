# Progress — compass

## Current status
- The app is a dashboard: Home (one card per area), Today (overdue, today and
  the next 7 days, "No date" folded per area), Areas (one page per area with a sub-area filter and one block per
  module), Goals, Habits and Sources tabs, a Journal page (from Today and More), and the "+" sheets (Task · Goal · Habit · Source). Code split into
  `app/core/`, `app/modules/` (tasks, goals, habits, sources, journal, trades, finance) and `app/views/`.
- Goals, tasks, habits, sources, journal and finance: format and rules in README → «Data format» (journal, trades and
  finance sealed with the user's encryption password). The app reads with ETags.
- Sealed files: the app keeps the password per device (More → Encryption password); the CLI takes it from
  $COMPASS_PASSPHRASE or the keyring (secret-tool). Finance: `compass money add` stands in for the bank's import; no
  movements by hand in the app.
- Area pages: tasks, goals and habits always; other modules (events, sources, trades, finance) only in the areas that have items of theirs.
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
- Chats linked to tasks (`task.sessions`; `link`/`unlink`/`relink` ops): CLI `task link|unlink|chats|brief`, a
  read-only tree in the task sheet. Linked subtasks (`subtask.task`, `linkSub` op, CLI `task sub --task|--domain|--link`):
  that task holds the state (the subtask copies it in `applyOps`) and the chats; dropping a task drops the tasks
  its subtasks are, and reopening it brings them back.
- Tests: `node --test tests/*.test.mjs`, also run by GitHub on every PR.
- Next: phase 5, the exchanges' import (read-only API keys; it also brings trading balances to net worth) and the
  bank's download (Enable Banking). Deferred: day close and Focus in the app (the CLI
  still supports focus), phase 6 summaries of Fitness and University.
