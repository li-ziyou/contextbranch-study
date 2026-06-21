# Starter User Evaluation — Replication Package

This is the replication package for the user evaluation conducted as part of our
study. It contains the complete set of starter applications given to
participants, so that the evaluation can be reproduced independently.

Each participant was provided with one or more minimal "starter" web
applications and asked to extend them into more polished, functional versions.
The apps are intentionally bare so that participants have room to make their own
design and implementation decisions.

## Contents

This package includes two independent starter projects:

- `movie-watchlist-2/` — **MyWatchlist**, a minimal movie & TV watchlist board.
  Renders three columns (Want to Watch, Watching, Watched) and places each title
  in the column matching its status, shown as a simple poster card.
- `music-library/` — **MyMusic**, a minimal music library app. Renders a list of
  songs and an empty "Your Playlists" area.

Both projects share the same structure:

- `src/data.js` — the mock data library plus helper definitions.
- `src/app.js`  — the app logic and rendering (the main entry point for changes).
- `src/app.css` — the styles.
- `index.html`  — the page shell.
- `README.md`   — per-project starter instructions and suggested task ideas.

The `music-library/dist/` directory contains a prebuilt version of that app.

## Requirements

- [Node.js](https://nodejs.org/) (a recent LTS version is recommended)
- npm (bundled with Node.js)

Each project uses [Vite](https://vitejs.dev/) as its build/dev tooling; there are
no other runtime dependencies.

## Running a project

From inside either project directory (`movie-watchlist-2/` or `music-library/`):

```bash
npm install
npm run dev
```

## Notes for replication

- The two projects are fully self-contained and can be run independently of one
  another.
- Participants were not required to complete every suggested task; the per-project
  README lists optional ideas, and each participant decided what to build.