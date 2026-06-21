import { titles, statuses, formatRuntime, genres } from "./data.js";

// ---------------------------------------------------------------------------
// This is a very basic starter. Right now it renders a board with three
// columns — Want to Watch, Watching, Watched — and drops each title into the
// column matching its `status`. Each title shows as a simple poster card.
//
// Note: the search bar and genre filter in the toolbar are UI only — they are
// not wired up yet. Making them actually filter the board is one thing you could build.
//
// It is intentionally minimal — there is lots of room to build on top of it.
// Some directions you might take it (you decide what and how):
//   - let users move a title between columns (buttons, a dropdown, or drag & drop)
//   - turn each card into something richer using the poster placeholder
//   - add a new title, or remove one from the board
//   - make the search / filter bar actually work (by name, creator, collection, genre)
//   - show a summary count per column, or rate / sort titles
//   - highlight the selected card
//
// The title data lives in src/data.js. Styles live in src/app.css.
// ---------------------------------------------------------------------------

// Simple in-memory app state. Add to this as you build new features.
const state = {
  titles: titles,
};

function renderToolbar() {
  return `
    <div class="toolbar">
      <h1 class="logo">▶ MyWatchlist</h1>
      <div class="controls">
        <input
          type="search"
          class="search-input"
          placeholder="Search titles, creators, collections..."
        />
      </div>
    </div>
  `;
}

function renderCard(title) {
  return `
    <article class="card" data-title-id="${title.titleId}">
      <div class="card-poster" style="background:${title.posterColor}">
        <span class="card-type">${title.type}</span>
      </div>
      <div class="card-body">
        <h3 class="card-title">${title.titleName}</h3>
        <p class="card-creator">${title.creatorName}</p>
        <p class="card-meta">${title.genre} · ${formatRuntime(title.runtime)} · ${title.year}</p>
      </div>
    </article>
  `;
}

function renderColumn(status) {
  const columnTitles = state.titles.filter((t) => t.status === status.key);
  return `
    <section class="column" data-status="${status.key}">
      <header class="column-header">
        <h2>${status.label}</h2>
        <span class="column-count">${columnTitles.length}</span>
      </header>
      <div class="column-cards">
        ${columnTitles.map(renderCard).join("")}
      </div>
    </section>
  `;
}

export function renderApp() {
  const app = document.querySelector("#app");
  app.innerHTML = `
    <div class="board-layout">
      ${renderToolbar()}
      <div class="board">
        ${statuses.map(renderColumn).join("")}
      </div>
    </div>
  `;

  // Example of wiring up an interaction. Clicking a card just logs it for now.
  app.querySelectorAll(".card").forEach((card) => {
    card.addEventListener("click", () => {
      const id = Number(card.dataset.titleId);
      const title = state.titles.find((t) => t.titleId === id);
      console.log("Clicked:", title.titleName, "—", title.status);
    });
  });
}
