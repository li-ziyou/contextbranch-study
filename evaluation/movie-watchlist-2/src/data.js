// Mock movie & TV library.
// Each title has: titleId, titleName, creatorName (director/showrunner),
// runtime (minutes), collectionName (franchise/series), genre, year, type,
// status ("want" | "watching" | "watched"), and a posterColor (placeholder
// for poster art).
// Feel free to use this data however you like — render it, filter it, sort it,
// move titles between statuses, etc.

export const titles = [
  { titleId: 1,  titleName: "Edge of Tomorrow",     creatorName: "Ava Cole",        runtime: 113, collectionName: "Standalone",     genre: "Sci-Fi",   year: 2021, type: "Movie", status: "want",     posterColor: "#7c3aed" },
  { titleId: 2,  titleName: "Quiet Coast",          creatorName: "The Maple Unit",  runtime: 98,  collectionName: "Coastlines",     genre: "Drama",    year: 2020, type: "Movie", status: "want",     posterColor: "#f59e0b" },
  { titleId: 3,  titleName: "Paper Streets",        creatorName: "Lo Hartley",      runtime: 102, collectionName: "Coastlines",     genre: "Drama",    year: 2020, type: "Movie", status: "want",     posterColor: "#10b981" },
  { titleId: 4,  titleName: "Static Field",         creatorName: "Ava Cole",        runtime: 127, collectionName: "Standalone",     genre: "Sci-Fi",   year: 2021, type: "Movie", status: "want",     posterColor: "#6366f1" },
  { titleId: 5,  titleName: "Riverbank",            creatorName: "Hollow Pictures",  runtime: 89,  collectionName: "Field Notes",    genre: "Indie",    year: 2019, type: "Movie", status: "want",     posterColor: "#84cc16" },
  { titleId: 6,  titleName: "Concrete Nights",      creatorName: "Block Studio",    runtime: 45,  collectionName: "Uptown",         genre: "Crime",    year: 2022, type: "TV",    status: "want",     posterColor: "#ef4444" },
  { titleId: 7,  titleName: "Velvet Skies",         creatorName: "Aria Wynn",       runtime: 52,  collectionName: "Nocturne",       genre: "Romance",  year: 2023, type: "TV",    status: "want",     posterColor: "#ec4899" },
  { titleId: 8,  titleName: "Pulse",                creatorName: "Circuit Films",   runtime: 41,  collectionName: "Voltage",        genre: "Thriller", year: 2022, type: "TV",    status: "watching", posterColor: "#06b6d4" },
  { titleId: 9,  titleName: "Slow Burn",            creatorName: "Aria Wynn",       runtime: 58,  collectionName: "Nocturne",       genre: "Romance",  year: 2023, type: "TV",    status: "watching", posterColor: "#d946ef" },
  { titleId: 10, titleName: "Highway Lines",        creatorName: "Dust Road Co.",   runtime: 134, collectionName: "Mileage",        genre: "Action",   year: 2018, type: "Movie", status: "watching", posterColor: "#f97316" },
  { titleId: 11, titleName: "Glass House",          creatorName: "Hollow Pictures",  runtime: 96,  collectionName: "Field Notes",    genre: "Indie",    year: 2019, type: "Movie", status: "watching", posterColor: "#22c55e" },
  { titleId: 12, titleName: "Afterglow",            creatorName: "Ava Cole",        runtime: 119, collectionName: "Standalone",     genre: "Sci-Fi",   year: 2021, type: "Movie", status: "watching", posterColor: "#8b5cf6" },
  { titleId: 13, titleName: "Cross Town",           creatorName: "Block Studio",    runtime: 48,  collectionName: "Uptown",         genre: "Crime",    year: 2022, type: "TV",    status: "watched",  posterColor: "#dc2626" },
  { titleId: 14, titleName: "Tidewater",            creatorName: "The Maple Unit",  runtime: 105, collectionName: "Coastlines",     genre: "Drama",    year: 2020, type: "Movie", status: "watched",  posterColor: "#14b8a6" },
  { titleId: 15, titleName: "Overdrive",            creatorName: "Circuit Films",   runtime: 44,  collectionName: "Voltage",        genre: "Thriller", year: 2022, type: "TV",    status: "watched",  posterColor: "#0ea5e9" },
  { titleId: 16, titleName: "Embers",               creatorName: "Dust Road Co.",   runtime: 141, collectionName: "Mileage",        genre: "Action",   year: 2018, type: "Movie", status: "watched",  posterColor: "#fb923c" },
  { titleId: 17, titleName: "Lantern",              creatorName: "Aria Wynn",       runtime: 50,  collectionName: "Nocturne",       genre: "Romance",  year: 2023, type: "TV",    status: "watched",  posterColor: "#e879f9" },
  { titleId: 18, titleName: "Northbound",           creatorName: "Lo Hartley",      runtime: 108, collectionName: "Coastlines",     genre: "Drama",    year: 2020, type: "Movie", status: "watched",  posterColor: "#34d399" },
  { titleId: 19, titleName: "Signal Lost",          creatorName: "Circuit Films",   runtime: 46,  collectionName: "Voltage",        genre: "Thriller", year: 2022, type: "TV",    status: "watched",  posterColor: "#38bdf8" },
  { titleId: 20, titleName: "Wildfire",             creatorName: "Dust Road Co.",   runtime: 138, collectionName: "Mileage",        genre: "Action",   year: 2018, type: "Movie", status: "watched",  posterColor: "#f87171" },
];

// The three board columns, in display order.
export const statuses = [
  { key: "want",     label: "Want to Watch" },
  { key: "watching", label: "Watching" },
  { key: "watched",  label: "Watched" },
];

// A couple of helpers you are welcome to use (or ignore).
export function formatRuntime(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export const genres = [...new Set(titles.map((t) => t.genre))];
