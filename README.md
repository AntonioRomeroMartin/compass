# Compass

A static PWA to track **tasks**, **habits**, **goals** (by horizon: daily to yearly, or with a deadline), **sources** (books, videos, courses, articles, podcasts) and an encrypted **journal** across **domains** (areas such as work, sport or studies), plus a command line (`compass`) that works on the same data and prints a compact "today" view for scripts and agents. Anyone can use it with **their own private data**.

## How to use it

1. Create a **private** GitHub repo for your data, ideally named `compass-data` (the app suggests that name).
2. Create a *fine-grained* token in GitHub → Settings → Developer settings → Fine-grained tokens:
   - *Repository access*: **Only select repositories** → that repo.
   - *Permissions* → *Contents*: **Read and write**. Nothing else.
3. Open the app, tap ⚙ and paste the token. On GitHub Pages your username is taken from the site's address; the repo
   (`compass-data`) and the branch (`main`) are filled in. The data files (`goals.json`, `tasks.json`…) live at the
   repo's root; if `goals.json` doesn't exist, the app creates an empty one.
4. Create your categories (“Categories” button) and your goals. On a phone you can install it as an app.

## Privacy

- The site has no server: your browser talks only to `api.github.com` (strict CSP, no third-party scripts), plus
  Open Library for books: `openlibrary.org` when you search for one, and its cover images (served from
  `covers.openlibrary.org` and `archive.org`). Open Library sees those searches and which covers are shown.
- The token and a copy of your data are stored only in your browser's local storage.
- The **journal**, **trades** and **finance** files are encrypted in the browser (AES-256-GCM, key from your encryption password with PBKDF2-SHA256)
  before they are saved: the repo holds only the sealed files, and their commit messages name only days or counts. The password
  is remembered on each device where you type it, and the device keeps an open copy (like the rest of the data).
  **If the password is lost, they cannot be recovered.**
- This repo contains code only: no categories, goals or anyone's data.

## Data format

Each kind of data has its own JSON file in the data repo (`goals.json`, `tasks.json`, `habits.json`, `sources.json`, `journal.json`, `trades.json`, `finance.json`, `domains.json`), saved with
2-space indentation so diffs stay readable. Commits that change data start with the file's prefix (`goals:`,
`tasks:`, `domains:`).

### Goals (`goals.json`)

```json
{
  "version": 1,
  "timeZone": "Area/City",
  "categories": ["…"],
  "goals": [{ "id": "…", "kind": "goal", "title": "…", "category": "…",
              "horizon": "day|week|month|quarter|year|deadline", "target": 3, "unit": "…",
              "deadline": null, "period": "2026-W40",
              "progress": 2, "createdAt": "…", "repo": null, "archived": false,
              "subgoals": [{ "id": "…", "title": "…", "done": false }] }]
}
```

Period keys (`YYYY-MM-DD`, `YYYY-Www` ISO week, `YYYY-MM`, `YYYY-Qn`, `YYYY`) are computed in the file's `timeZone`.

- **Goals** belong to one period: the horizon is when the goal expires. A weekly goal created now belongs to the current week (`period`), and when the week ends it moves to **Past** as completed or missed. Goals do not repeat.
- **Progress** is one number (`progress`); without a `target`, any progress means done.
- **Sub-goals** (optional): steps towards a goal, ticked off on its card.
- **With deadline**: no `period`; it moves to Past the day after `deadline`.

### Domains (`domains.json`)

```json
{
  "version": 1,
  "domains": [
    { "id": "studies", "name": "Studies", "paths": ["~/projects/studies"], "color": "#3366aa" },
    { "id": "studies/course-a", "name": "Course A", "parent": "studies", "paths": ["~/projects/studies/course-a"] },
    { "id": "sport", "name": "Sport" }
  ]
}
```

- `id` is hierarchical: `studies/course-a` is a subdomain of `studies` (`parent` is derived from the id when it is
  missing). `paths` (folders where that domain's work happens, absolute or starting with `~`) and `color` are optional.
- **Domains and goal categories are one list**: a goal's `category` is the id or the name of a domain
  (`Sport` and `sport` both match the `sport` domain). Categories that are not registered keep working as
  plain labels, and `compass domains` lists them so they can be registered. Nothing needs migrating.
- **Blocks of an area's page:** tasks, goals and habits show in every area, even empty. Sources (and events, trades,
  finance) show only in the areas that have some (a domain and its subdomains).
- A folder belongs to the domain with the **longest** path that contains it (`~/projects/studies/course-a/week-3`
  → `studies/course-a`; whole folder names only). `compass today` scoped to a domain shows it and its sub-domains in full,
  not its parents (see below).

### Tasks (`tasks.json`)

```json
{
  "version": 1,
  "timeZone": "Area/City",
  "tasks": [{ "id": "t_…", "title": "…", "domain": "studies/course-a", "due": "2026-10-30", "notes": null,
              "parent": "t_…",
              "repeat": { "type": "weekly", "days": [1, 4] }, "focus": false,
              "ongoing": "notes/draft.md", "status": "open", "createdAt": "…", "doneAt": null }]
}
```

- `domain` is required; `due` (`YYYY-MM-DD`, a civil day in the file's `timeZone`) is optional. There are no
  priorities or time estimates: **focus** (⭐) marks what matters now, at most 3 open tasks at a time.
- `status`: `open`, `done` or `dropped`; `doneAt` is when it was closed.
- `repeat`: `{"type": "days", "every": N}`, `{"type": "weekly", "days": [1…7]}` (ISO weekdays, 1 = Monday) or
  `{"type": "monthly", "day": 1…31}` (past the end of a short month it falls on its last day). Closing a repeating
  task creates the next occurrence as a new task (the closed one keeps its id in `next`). The next date counts
  from the due date, or from today when the task was late, so a late completion does not pile up overdue copies.
- `ongoing`: path of a text file with the state of work in progress; "today" lists these tasks even without a date.
- `sessions` (omitted when empty): the chat sessions working on the task,
  `[{ "id": "…", "title": "…", "parent": null, "addedAt": "…" }]`. `id` is whatever identifies the
  session in the assistant that runs it; `title` is a copy for display; `parent` is the chat that opened this one
  (`null`: opened from the task itself), which makes a tree ordered by `addedAt`. A chat about a part of a task is
  linked to that part, which is a task too, and its parent shows it under the part's title. A chat that works on
  several tasks is linked to each (`--move` takes it from the others). A closed task keeps its chats (reopening it
  finds them); those no open task has are the ones done with. Compass only stores the links (the CLI and the task sheet show them; the sheet is read-only): opening
  and closing the chats is up to the assistant. Only open tasks get chats, and `compass today` ends with the closed
  tasks that have chats no open task has, listing those chats, so the assistant can offer to delete them. Unlinking a chat moves its sub-chats up one level, and a repeating task's next occurrence starts
  with none.
- `parent` (omitted at the top): the task this one is part of. A subtask is a task like any other, with its own
  domain (by default its parent's), date, chats and subtasks, to any depth. A plain step (open parent, no date,
  same domain) is listed under its task; anything else gets a line of its own that names its task. Closing a task
  closes, with the same timestamp, the open tasks under it, and reopening it brings back exactly those (reopening
  one of them alone also works); deleting a task deletes what is under it. Progress (`n/m`) counts the parts that
  were not dropped. A repeating task's next occurrence gets a fresh copy of its parts, dates shifted along. A part
  only moves to the yearly archive with its task. Confirming first is up to the caller (the CLI asks for `--yes`
  to delete, the task sheet asks before closing more than one task).
- The older shape, a `subtasks` list inside each task, is still read: each subtask becomes a task with `parent`
  (one that pointed at another task with `task` makes that task the part), and the chats tied to a subtask move
  to it. The next write saves the new shape.
- When the CLI creates `tasks.json`, it copies the `timeZone` of `goals.json`.

### Habits (`habits.json`)

```json
{
  "version": 1,
  "timeZone": "Area/City",
  "habits": [{ "id": "h_…", "title": "…", "domain": "sport", "freq": { "type": "weekly", "times": 3 },
               "notes": null, "done": ["2026-10-26", "2026-10-28"], "createdAt": "…" }]
}
```

- Something done on some days, marked done or not done per day (`done`: the civil days, sorted). No streaks: each
  habit shows how this week (Monday to Sunday) is going.
- `freq`: `{"type": "daily"}` (of 7), `{"type": "weekly", "times": N}` (N days a week, any of them; it stops showing
  in Today once the week has N) or `{"type": "days", "days": [1…7]}` (those ISO weekdays; only they count).
- Any past day can be marked or unmarked from the habit's month calendar. `archived: true` retires it and keeps
  its history.

### Sources (`sources.json`)

```json
{
  "version": 1,
  "timeZone": "Area/City",
  "sources": [{ "id": "s_…", "kind": "video", "title": "…", "author": "…", "url": "https://…", "file": "talk.txt",
                "domain": null, "status": "doing",
                "notes": null, "quotes": [{ "id": "q_…", "text": "…", "page": 12 }],
                "started": "2026-10-20", "finished": null, "rating": null,
                "olid": null, "cover": null, "createdAt": "…" }]
}
```

- A source is anything to learn from: `kind` is `book`, `video`, `course`, `article` or `podcast`.
- `url` is its **location**: a link, or free text saying where to find it ("paper book, shelf"). Every source should
  have one. `file` is an optional **local copy**: a path inside the `knowledge/sources/` folder of its domain's
  folder (a PDF, a transcript), kept out of the data repo.
- `domain` is optional: a source without one shows only in the Sources tab and the Sources card on Home; one with
  a domain also shows on that area's page.
- `status` has three values, shown in the words of each kind (Reading, Watching, Listening…): `pending` → `doing` →
  `done`. `done` means finished or given up on. `null` (no status) means **material only**: something the assistant
  can read or watch that the user will not consume. Changing it sets the dates: `doing` sets `started` (if empty),
  `done` sets `finished`, `pending` and no status clear both.
- `notes` are your own thoughts; `quotes` are lines from it, each with an optional page. `rating`: 1-5.
- `olid` and `cover` (books) come from an Open Library search: only the cover's id is stored, the image is not.
- Earlier files are moved once with `compass sources migrate`: a `books.json` (`{ "books": [...] }`) becomes
  `sources.json`, and the earlier statuses (`want`, `dropped`, `skip`) become `pending`, `done` and none. Every source
  keeps its data and dates.

### Journal (`journal.json`, sealed)

Once opened with the password, the file is:

```json
{
  "version": 1,
  "timeZone": "Area/City",
  "days": [{ "date": "2026-10-28", "text": "…", "notes": [{ "id": "n_…", "text": "…" }] }]
}
```

In the repo it is stored sealed (`lib/crypt.js`):
`{ "version": 1, "sealed": "AES-256-GCM", "kdf": { "name": "PBKDF2-SHA256", "iterations": 600000, "salt": "…" }, "iv": "…", "data": "…" }`.
One entry per day (its text) plus short notes; days with nothing are not kept.

### Finance (`finance.json`, sealed)

Sealed like the journal. Once opened:

```json
{
  "version": 1,
  "timeZone": "Area/City",
  "domain": "money",
  "currency": "EUR",
  "categories": [{ "id": "groceries", "name": "Groceries", "limits": [{ "from": "2026-01", "amount": 250 }] }],
  "rules": [{ "id": "r_…", "match": "grocer", "category": "groceries" }],
  "accounts": [{ "id": "bank", "name": "Bank", "kind": "bank", "currency": "EUR", "balance": 1000, "rate": 1, "at": "…", "address": null }],
  "movements": [{ "id": "m_…", "extId": null, "account": "bank", "date": "2026-01-05", "amount": -20.5, "text": "Grocer", "category": null }],
  "months": [{ "month": "2025-12", "total": 1000, "byKind": { "bank": 1000 } }],
  "savings": [{ "goal": "g_…", "kind": "networth", "target": 5000, "base": null }]
}
```

A movement's category is its own, else the first rule whose `match` it contains, else uncategorized; `transfer`
(one's own accounts) stays out of the budget. A limit holds from its month on. Kinds: bank, cash, defi, debt
(subtracts), other. `months` gets last month's net worth on its own when a month is first opened. A goal with
`"source": "savings"` in `goals.json` takes its progress and target from `savings` (net worth reaches `target`, or
grows by it from `base`).

## Command line

`cli/compass.mjs` reads and changes the same data from a local git checkout of your data repo, with the same
operations as the app (it pulls before reading, commits and pushes after writing, and reapplies its change if the
remote moved meanwhile). A missing `tasks.json` or `domains.json`
is created on the first write. Needs Node 20+.

```bash
ln -s "$PWD/cli/compass.mjs" ~/.local/bin/compass
mkdir -p ~/.config/compass
echo '{ "repo": "/path/to/your/data-repo", "goals": "goals.json", "tasks": "tasks.json", "domains": "domains.json" }' \
  > ~/.config/compass/config.json
compass domain add studies --name Studies --path ~/projects/studies
compass task add "Problem set 3" --domain studies --due fri
compass task add "Water plants" --domain home --repeat "every 3 days"
printf '%s\n' '"Pay the fee" --due +3' '"Book a room" --domain home' \
  | compass task add --stdin --domain studies   # several tasks, one commit; options here apply to every line
compass task done "problem set"       # a task by id or part of its title
compass task link "report" SESSION --title "Draft" [--parent SESSION]   # record a chat on a task (one chat can be on several)
compass task add "Book flights" --parent "trip" --domain studies   # a part of a task (here in another domain)
compass task chats "report"           # its chats as a tree (--prune a,b forgets the ones listed; unlink does the same)
compass task brief "report"           # starter text for a new chat: title, notes, subtasks, date, chats
compass task move "water" +2          # or: tomorrow (default), mon…sun, YYYY-MM-DD, none
compass tasks --due week              # also: --domain D, --cwd PATH, --due today|overdue, --all
compass today --cwd "$PWD"            # what matters in the domain of this folder
compass habit add "Stretch" --domain sport --freq mon,wed,fri   # or: daily, 3/week
compass habit done stretch yesterday  # also: today (default), -N, YYYY-MM-DD
compass source add "A novel" --find  # --find: author and cover from Open Library; --domain D to file it in an area
compass source add "A talk" --kind video --url https://… --file talk.txt --domain work
compass source reading novel         # or: pending, doing, done, none (material only), and each kind's words (watched…)
compass sources --kind video --status done   # also: --domain D, --cwd PATH
compass source quote novel "A line worth keeping" --page 41
secret-tool store --label="compass encryption" service compass key encryption   # the journal's password, once
compass journal note "Called home"    # also: compass journal [DATE], days, search, write
compass money                         # budget of this month and net worth (also: categories, rule, account, saving)
compass help                          # every command (goals, sub-tasks, focus, edit…)
```

`compass today` is meant to be read at the start of a session (for example by an agent's start hook):

```text
Today · Fri 23 Oct · 2026-10-23 · 2026-W43 (Area/City)
Scope: Studies [studies] and its sub-domains in full (from --cwd)
Focus
  ⭐ [t_…] Exam registration — due 2026-10-24 (tomorrow) · studies
Studies [studies]
  · [t_…] Pay the fees — due 2026-10-21 (2 d late)
  · [g_…] Study sessions — 2/5 · week · studies
  Later
  · [t_…] Choose next term's courses — due 2026-12-10 (in 48 d)
  No date
  · [t_…] Thesis draft — ongoing notes/thesis.md
Studies › Course A [studies/course-a]
  · [t_…] Problem set 3 — due 2026-10-25 (in 2 d)
```

It shows the focus tasks, then by domain: tasks that are late, due today or in the next 7 days, goals of the day and
the week, and deadlines within 7 days. With a scope (`--cwd` or `--domain`), the domain and all its sub-domains are
shown in full, with the tasks dated later ("Later"), those without a date ("No date") and every active goal: the same
tasks as `compass tasks` with that scope. Its parents are left out (their own view shows it). A **root folder**
(`compass domains root PATH`, stored as `root` in `domains.json`) is the one whose session oversees everything: from
it, every domain is shown in full. Without a scope it shows everything, dated
only. Its `git pull` gives up after `--timeout` seconds (3 by default) and the view uses the local copy, with a
one-line warning.

## Development

Plain HTML + JS, no build step, with `// @ts-check` and JSDoc types.

- `lib/`: shared logic, used by the app and the CLI: period keys and civil dates (`period.js`), the data model and
  operations of each data file (`goals.js`, `tasks.js`, `domains.js`), the Today view (`today.js`) and the GitHub
  API (`github.js`).
- `app/`: the PWA (`index.html` and `sw.js` stay at the root): `core/` (sync and helpers), `modules/` (one folder
  per kind of data, each adding its part to an area's page and to Home), `views/` (Home, Today, Areas, settings).
- `cli/`: the command line.

```bash
python3 tools/serve.py 8000   # open http://localhost:8000 (no caching, so a reload shows every change)
node --test tests/*.test.mjs  # logic and CLI tests (the CLI ones use temporary git repos)
```
- Closed tasks stay in `tasks.json` for 30 days; the next CLI write moves older ones to the archive of the year they
  were closed (`tasks-2026.json`, same folder), so the file the app downloads stays small. `compass tasks --archived`
  lists them.
