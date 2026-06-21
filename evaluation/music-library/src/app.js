import { songs, formatDuration, genres } from "./data.js";

// ---------------------------------------------------------------------------
// This is a very basic starter. Right now it just renders the list of songs
// from data.js and shows an empty "Your Playlists" area.
//
// Note: the search bar and genre filter below are UI only — they are not
// wired up yet. Making them actually filter the list is one thing you could build.
//
// It is intentionally minimal — there is lots of room to build on top of it.
// Some directions you might take it (you decide what and how):
//   - turn each song row into a nicer card with the album art placeholder
//   - let users create / rename / delete playlists
//   - let users add songs to a playlist and remove them
//   - make the search / filter bar actually work (by title, artist, album, genre)
//   - add a "now playing" bar or highlight the selected track
//   - mark favourites, or sort the list
//
// The song data lives in src/data.js. Styles live in src/app.css.
// ---------------------------------------------------------------------------

// Simple in-memory app state. Add to this as you build new features.
const state = {
  songs: songs,
  playlists: [], // each playlist could be e.g. { id, name, songIds: [] }
};

function renderControls() {
  return `
    <div class="controls">
      <input
        type="search"
        class="search-input"
        placeholder="Search songs, artists, albums..."
      />
      <select class="genre-filter">
        <option value="">All genres</option>
        ${genres.map((g) => `<option value="${g}">${g}</option>`).join("")}
      </select>
    </div>
  `;
}

function renderSongList() {
  return `
    <ul class="song-list">
      ${state.songs
        .map(
          (song) => `
        <li class="song-row" data-song-id="${song.songId}">
          <span class="song-cover" style="background:${song.coverColor}"></span>
          <span class="song-main">
            <span class="song-name">${song.songName}</span>
            <span class="song-artist">${song.artistName}</span>
          </span>
          <span class="song-album">${song.albumName}</span>
          <span class="song-duration">${formatDuration(song.duration)}</span>
        </li>`
        )
        .join("")}
    </ul>
  `;
}

function renderPlaylists() {
  if (state.playlists.length === 0) {
    return `<p class="empty-note">No playlists yet. This area is yours to build.</p>`;
  }
  // Once you add playlists to state, render them here.
  return state.playlists.map((p) => `<div class="playlist">${p.name}</div>`).join("");
}

export function renderApp() {
  const app = document.querySelector("#app");
  app.innerHTML = `
    <div class="layout">
      <aside class="sidebar">
        <h1 class="logo">♪ MyMusic</h1>
        <h2 class="sidebar-heading">Your Playlists</h2>
        <div class="playlists">${renderPlaylists()}</div>
      </aside>

      <main class="content">
        <header class="content-header">
          <h2>All Songs</h2>
          <p class="subtitle">${state.songs.length} tracks in your library</p>
        </header>
        ${renderControls()}
        ${renderSongList()}
      </main>
    </div>
  `;

  // Example of wiring up an interaction. Clicking a song just logs it for now.
  app.querySelectorAll(".song-row").forEach((row) => {
    row.addEventListener("click", () => {
      const id = Number(row.dataset.songId);
      const song = state.songs.find((s) => s.songId === id);
      console.log("Clicked:", song.songName, "by", song.artistName);
    });
  });
}