# Compass

A static PWA to track goals by horizon (daily, weekly, monthly, quarterly, yearly and with a deadline) and by category. Anyone can use it with **their own private data**.

## How to use it

1. Create a **private** GitHub repo for your data (or use one you already have).
2. Create a *fine-grained* token in GitHub → Settings → Developer settings → Fine-grained tokens:
   - *Repository access*: **Only select repositories** → that repo.
   - *Permissions* → *Contents*: **Read and write**. Nothing else.
3. Open the app, tap ⚙ and enter the token, your username, the repo, the file (default `goals.json`) and the branch. If the file doesn't exist, the app creates an empty one.
4. Create your categories (“Categories” button) and your goals. On a phone you can install it as an app.

## Privacy

- The site has no server: your browser talks only to `api.github.com` (strict CSP, no third-party scripts).
- The token and a copy of your data are stored only in your browser's local storage.
- This repo contains code only: no categories, goals or anyone's data.

## Data format

```json
{
  "version": 1,
  "timeZone": "Area/City",
  "categories": ["…"],
  "goals": [{ "id": "…", "kind": "goal", "title": "…", "category": "…",
              "horizon": "day|week|month|quarter|year|deadline", "target": 3, "unit": "…",
              "deadline": null, "repeat": false, "period": "2026-W40",
              "progress": { "2026-W40": 2 }, "createdAt": "…", "repo": null, "archived": false,
              "subgoals": [{ "id": "…", "title": "…", "done": ["2026-W40"] }] }]
}
```

Period keys (`YYYY-MM-DD`, `YYYY-Www` ISO week, `YYYY-MM`, `YYYY-Qn`, `YYYY`, `once`) are computed in the file's `timeZone`.

- **One-off goals** (`repeat: false`, the default): the horizon is when the goal expires. A weekly goal created now belongs to the current week (`period`), and when the week ends it moves to **Past** as completed or missed.
- **Habits** (`repeat: true`): the goal renews every period and progress starts again from 0; history is kept per period.
- **Sub-goals** (optional): steps towards a goal, ticked off on its card. `done` lists the period keys in which each one was completed, so a habit's sub-goals start unticked every period.
- **With deadline**: accumulates under `once` and moves to Past the day after `deadline`.

## Command line (optional)

`cli/compass.mjs` reads and changes the same data from a local git checkout of your data repo, with the same
operations as the app (it pulls before reading, commits and pushes after writing, and reapplies its change if the
remote moved meanwhile). Needs Node 20+.

```bash
ln -s "$PWD/cli/compass.mjs" ~/.local/bin/compass
mkdir -p ~/.config/compass
echo '{ "repo": "/path/to/your/data-repo", "goals": "goals.json" }' > ~/.config/compass/config.json
compass today                 # goals for today and this week, deadlines within 7 days
compass goal inc "workout" 1      # a goal by id or part of its title
compass help
```

## Development

Plain HTML + JS, no build step, with `// @ts-check` and JSDoc types.

- `lib/`: shared logic (period keys, data model and operations, GitHub API), used by the app and the CLI.
- `app/`: the PWA (`index.html` and `sw.js` stay at the root).
- `cli/`: the command line.

```bash
python3 -m http.server 8000   # open http://localhost:8000
node --test tests/            # logic and CLI tests
```
