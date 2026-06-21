# MyWatchlist — Starter

A minimal movie & TV watchlist board. Right now it renders three columns —
Want to Watch, Watching, Watched — and drops each title into the column
matching its status, shown as a simple poster card. Your task is to build it
into something more polished and functional.

## Getting started

```bash
npm install
npm run dev
```

Then open the printed local URL in your browser.

## Where things are

- `src/data.js`  — the mock title library (titleId, titleName, creatorName,
  runtime, collectionName, genre, year, type, status, posterColor) plus the
  column definitions and a helper.
- `src/app.js`   — the app logic and rendering. Start here.
- `src/app.css`  — the styles.
- `index.html`   — the page shell.

## Ideas (optional — you decide what to build)

- Let users move a title between columns (buttons, a dropdown, or drag & drop)
- Richer poster cards
- Add a new title, or remove one from the board
- Make the search / filter bar actually work (by name, creator, collection, genre)
- A per-column summary count, ratings, or sorting
- Highlight the selected card
