// Mock song library.
// Each song has: songId, songName, artistName, duration (seconds),
// albumName, genre, year, and a coverColor (used as a placeholder for album art).
// Feel free to use this data however you like — render it, filter it, sort it, etc.

export const songs = [
  { songId: 1,  songName: "Midnight City",        artistName: "Neon Verse",     duration: 241, albumName: "Skyline",          genre: "Synthpop",    year: 2021, coverColor: "#7c3aed" },
  { songId: 2,  songName: "Golden Hour",          artistName: "The Maple Tide", duration: 198, albumName: "Coastlines",       genre: "Indie",       year: 2020, coverColor: "#f59e0b" },
  { songId: 3,  songName: "Paper Planes",         artistName: "Lo & Lake",      duration: 176, albumName: "Coastlines",       genre: "Indie",       year: 2020, coverColor: "#10b981" },
  { songId: 4,  songName: "Static Bloom",         artistName: "Neon Verse",     duration: 263, albumName: "Skyline",          genre: "Synthpop",    year: 2021, coverColor: "#6366f1" },
  { songId: 5,  songName: "Riverbank",            artistName: "Hollow Pines",   duration: 215, albumName: "Field Notes",      genre: "Folk",        year: 2019, coverColor: "#84cc16" },
  { songId: 6,  songName: "Concrete Dreams",      artistName: "Block Party",    duration: 188, albumName: "Uptown",           genre: "Hip-Hop",     year: 2022, coverColor: "#ef4444" },
  { songId: 7,  songName: "Velvet Skies",         artistName: "Aria Moon",      duration: 232, albumName: "Nocturne",         genre: "R&B",         year: 2023, coverColor: "#ec4899" },
  { songId: 8,  songName: "Pulse",                artistName: "Circuit",        duration: 204, albumName: "Voltage",          genre: "Electronic",  year: 2022, coverColor: "#06b6d4" },
  { songId: 9,  songName: "Slow Burn",            artistName: "Aria Moon",      duration: 251, albumName: "Nocturne",         genre: "R&B",         year: 2023, coverColor: "#d946ef" },
  { songId: 10, songName: "Highway Lines",        artistName: "Dust Road",      duration: 279, albumName: "Mileage",          genre: "Rock",        year: 2018, coverColor: "#f97316" },
  { songId: 11, songName: "Glass House",          artistName: "Hollow Pines",   duration: 197, albumName: "Field Notes",      genre: "Folk",        year: 2019, coverColor: "#22c55e" },
  { songId: 12, songName: "Afterglow",            artistName: "Neon Verse",     duration: 220, albumName: "Skyline",          genre: "Synthpop",    year: 2021, coverColor: "#8b5cf6" },
  { songId: 13, songName: "Cross Town",           artistName: "Block Party",    duration: 169, albumName: "Uptown",           genre: "Hip-Hop",     year: 2022, coverColor: "#dc2626" },
  { songId: 14, songName: "Tidewater",            artistName: "The Maple Tide", duration: 244, albumName: "Coastlines",       genre: "Indie",       year: 2020, coverColor: "#14b8a6" },
  { songId: 15, songName: "Overdrive",            artistName: "Circuit",        duration: 211, albumName: "Voltage",          genre: "Electronic",  year: 2022, coverColor: "#0ea5e9" },
  { songId: 16, songName: "Embers",               artistName: "Dust Road",      duration: 256, albumName: "Mileage",          genre: "Rock",        year: 2018, coverColor: "#fb923c" },
  { songId: 17, songName: "Lantern",              artistName: "Aria Moon",      duration: 189, albumName: "Nocturne",         genre: "R&B",         year: 2023, coverColor: "#e879f9" },
  { songId: 18, songName: "Northbound",           artistName: "Lo & Lake",      duration: 233, albumName: "Coastlines",       genre: "Indie",       year: 2020, coverColor: "#34d399" },
  { songId: 19, songName: "Signal Lost",          artistName: "Circuit",        duration: 225, albumName: "Voltage",          genre: "Electronic",  year: 2022, coverColor: "#38bdf8" },
  { songId: 20, songName: "Wildfire",             artistName: "Dust Road",      duration: 248, albumName: "Mileage",          genre: "Rock",        year: 2018, coverColor: "#f87171" },
];

// A couple of helpers you are welcome to use (or ignore).
export function formatDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export const genres = [...new Set(songs.map((s) => s.genre))];
