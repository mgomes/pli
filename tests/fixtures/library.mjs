// [bg, bg2, accent, ink, variant] — stand-in art palettes; real Plex posters replace these.
const V = ["bloom", "stack", "sun", "frame"];
const art = (bg, bg2, accent, ink, v) => ({ bg, bg2, accent, ink, variant: V[v] });

export const movies = [
  { id: "m1", title: "Aftersun", year: 2022, rating: "9.5", audience: "8.1", duration: 102, genres: ["Drama"], status: "watched", director: "Charlotte Wells", cast: ["Paul Mescal", "Frankie Corio", "Celia Rowlson-Hall"], logline: "A father and daughter share a sunlit holiday in Turkey that she will spend years trying to understand.", art: art("#0e3a4a", "#06161d", "#f2c9a0", "#f6efe6", 0) },
  { id: "m2", title: "Anatomy of a Fall", year: 2023, rating: "9.6", audience: "8.7", duration: 152, genres: ["Drama", "Thriller"], status: "unwatched", director: "Justine Triet", cast: ["Sandra Hüller", "Swann Arlaud", "Milo Machado-Graner"], logline: "A writer is put on trial after her husband's death, and her son becomes the only witness.", art: art("#d9d6cf", "#aaa59b", "#b3261e", "#1b1a18", 3) },
  { id: "m3", title: "Arrival", year: 2016, rating: "9.4", audience: "8.2", duration: 116, genres: ["Sci-Fi", "Drama"], status: "in-progress", progress: 42, director: "Denis Villeneuve", cast: ["Amy Adams", "Jeremy Renner", "Forest Whitaker"], logline: "A linguist is recruited to talk to visitors who experience time differently than we do.", art: art("#4a5256", "#15191c", "#d9e0e3", "#eef1f2", 2) },
  { id: "m4", title: "Blade Runner 2049", year: 2017, rating: "8.8", audience: "8.1", duration: 164, genres: ["Sci-Fi"], status: "watched", director: "Denis Villeneuve", cast: ["Ryan Gosling", "Harrison Ford", "Ana de Armas"], logline: "A replicant blade runner uncovers a secret that could unravel what remains of society.", art: art("#c4561c", "#2e0e05", "#ffb36b", "#fff1e2", 0) },
  { id: "m5", title: "Challengers", year: 2024, rating: "8.9", audience: "7.4", duration: 131, genres: ["Drama", "Romance"], status: "unwatched", director: "Luca Guadagnino", cast: ["Zendaya", "Mike Faist", "Josh O'Connor"], logline: "A tennis prodigy turned coach engineers a match between her husband and her former love.", art: art("#2f6b3a", "#10281a", "#d8f05a", "#f4f7ea", 1) },
  { id: "m6", title: "Civil War", year: 2024, rating: "8.1", audience: "7.0", duration: 109, genres: ["Action", "Thriller"], status: "in-progress", progress: 18, director: "Alex Garland", cast: ["Kirsten Dunst", "Wagner Moura", "Cailee Spaeny"], logline: "Journalists race across a fractured America toward a capital under siege.", art: art("#1c1512", "#3a110c", "#d8321f", "#f5ece6", 1) },
  { id: "m7", title: "Dune: Part Two", year: 2024, rating: "9.2", audience: "9.5", duration: 166, genres: ["Sci-Fi", "Adventure"], status: "watched", director: "Denis Villeneuve", contentRating: "PG-13", tagline: "Long live the fighters.", cast: ["Timothée Chalamet", "Zendaya", "Rebecca Ferguson", "Javier Bardem", "Austin Butler", "Florence Pugh"], logline: "Paul Atreides unites with the Fremen on a path of revenge, and toward a future only he can see.", summary: "Paul Atreides unites with Chani and the Fremen while seeking revenge against the conspirators who destroyed his family. Facing a choice between the love of his life and the fate of the known universe, he endeavors to prevent a terrible future only he can foresee.", art: art("#d7823a", "#4a1c0b", "#ffe0a8", "#1f0d05", 2) },
  { id: "m8", title: "Everything Everywhere All at Once", year: 2022, rating: "9.4", audience: "8.9", duration: 139, genres: ["Sci-Fi", "Comedy"], status: "watched", director: "Daniels", cast: ["Michelle Yeoh", "Ke Huy Quan", "Stephanie Hsu"], logline: "A laundromat owner must connect with versions of herself across the multiverse.", art: art("#7a1f6b", "#1d0a2a", "#ffcf4d", "#fff3fb", 3) },
  { id: "m9", title: "Godzilla Minus One", year: 2023, rating: "9.8", audience: "9.8", duration: 125, genres: ["Action", "Drama"], status: "unwatched", director: "Takashi Yamazaki", cast: ["Ryunosuke Kamiki", "Minami Hamabe", "Yuki Yamada"], logline: "A disgraced pilot returns to a ruined Tokyo just as something rises from the sea.", art: art("#22384d", "#060a10", "#8fb6d8", "#e8f0f7", 0) },
  { id: "m10", title: "Heat", year: 1995, rating: "8.8", audience: "9.4", duration: 170, genres: ["Crime", "Thriller"], status: "watched", director: "Michael Mann", cast: ["Al Pacino", "Robert De Niro", "Val Kilmer"], logline: "A master thief and a relentless detective circle each other across Los Angeles.", art: art("#1c2a3b", "#080c12", "#6fa3c9", "#e6edf3", 1) },
  { id: "m11", title: "The Holdovers", year: 2023, rating: "9.7", audience: "9.2", duration: 133, genres: ["Comedy", "Drama"], status: "unwatched", director: "Alexander Payne", cast: ["Paul Giamatti", "Da'Vine Joy Randolph", "Dominic Sessa"], logline: "A curmudgeonly teacher is stuck minding a student over the Christmas break.", art: art("#5a3b25", "#21130a", "#e9c79a", "#f7ecdc", 3) },
  { id: "m12", title: "Interstellar", year: 2014, rating: "7.3", audience: "8.6", duration: 169, genres: ["Sci-Fi", "Adventure"], status: "watched", director: "Christopher Nolan", cast: ["Matthew McConaughey", "Anne Hathaway", "Jessica Chastain"], logline: "Explorers travel through a wormhole to find humanity a new home.", art: art("#121214", "#2a241a", "#e2b766", "#f1e9d8", 2) },
  { id: "m13", title: "Killers of the Flower Moon", year: 2023, rating: "9.3", audience: "8.4", duration: 206, genres: ["Crime", "Drama"], status: "in-progress", progress: 61, director: "Martin Scorsese", cast: ["Leonardo DiCaprio", "Lily Gladstone", "Robert De Niro"], logline: "In 1920s Oklahoma, members of the Osage Nation are murdered one by one for their oil.", art: art("#6e2f18", "#1c0a05", "#e39a55", "#f7e7d6", 0) },
  { id: "m14", title: "Nope", year: 2022, rating: "8.3", audience: "6.9", duration: 130, genres: ["Horror", "Sci-Fi"], status: "unwatched", director: "Jordan Peele", cast: ["Daniel Kaluuya", "Keke Palmer", "Steven Yeun"], logline: "Siblings on a California horse ranch spot something in the clouds that should not be there.", art: art("#e3a73a", "#5a300e", "#fff1c9", "#1a1208", 2) },
  { id: "m15", title: "Oppenheimer", year: 2023, rating: "9.3", audience: "9.1", duration: 180, genres: ["Drama", "History"], status: "watched", director: "Christopher Nolan", cast: ["Cillian Murphy", "Emily Blunt", "Robert Downey Jr."], logline: "The physicist who led the Manhattan Project reckons with what he has made.", art: art("#1a0e08", "#5c1d07", "#ff8a2a", "#fbeee2", 0) },
  { id: "m16", title: "Parasite", year: 2019, rating: "9.9", audience: "9.0", duration: 132, genres: ["Thriller", "Drama"], status: "watched", director: "Bong Joon Ho", cast: ["Song Kang-ho", "Lee Sun-kyun", "Cho Yeo-jeong"], logline: "A struggling family schemes its way into the lives of a wealthy household.", art: art("#2c3a2a", "#0c130c", "#e8e2cf", "#f0ede2", 3) },
  { id: "m17", title: "Past Lives", year: 2023, rating: "9.5", audience: "8.5", duration: 105, genres: ["Drama", "Romance"], status: "unwatched", director: "Celine Song", cast: ["Greta Lee", "Teo Yoo", "John Magaro"], logline: "Two childhood friends reunite in New York decades after one emigrated from Seoul.", art: art("#3a3f6b", "#b86f72", "#ffd7c2", "#fff6f0", 0) },
  { id: "m18", title: "Perfect Days", year: 2023, rating: "9.6", audience: "9.1", duration: 124, genres: ["Drama"], status: "unwatched", director: "Wim Wenders", cast: ["Kōji Yakusho", "Tokio Emoto", "Arisa Nakano"], logline: "A Tokyo toilet cleaner finds quiet grace in the rhythm of an ordinary life.", art: art("#3f6b3a", "#12230c", "#f3e7a5", "#f6f4e8", 2) },
  { id: "m19", title: "Poor Things", year: 2023, rating: "9.2", audience: "7.9", duration: 141, genres: ["Comedy", "Sci-Fi"], status: "watched", director: "Yorgos Lanthimos", cast: ["Emma Stone", "Mark Ruffalo", "Willem Dafoe"], logline: "A woman revived by an eccentric scientist sets out to see the world.", art: art("#b69bd6", "#46295f", "#f7d3e8", "#1b0f28", 3) },
  { id: "m20", title: "Sinners", year: 2025, rating: "9.7", audience: "9.6", duration: 137, genres: ["Horror", "Drama"], status: "unwatched", director: "Ryan Coogler", cast: ["Michael B. Jordan", "Hailee Steinfeld", "Delroy Lindo"], logline: "Twin brothers return to their Mississippi hometown and find something waiting in the dark.", art: art("#6b0d10", "#14030a", "#ffb24a", "#fbe9df", 1) },
  { id: "m21", title: "Tár", year: 2022, rating: "9.1", audience: "7.4", duration: 158, genres: ["Drama", "Music"], status: "unwatched", director: "Todd Field", cast: ["Cate Blanchett", "Nina Hoss", "Noémie Merlant"], logline: "A celebrated conductor's carefully managed life begins to come apart.", art: art("#cfcfcc", "#8a8a88", "#111111", "#0d0d0d", 1) },
  { id: "m22", title: "Whiplash", year: 2014, rating: "9.4", audience: "9.4", duration: 107, genres: ["Drama", "Music"], status: "watched", director: "Damien Chazelle", cast: ["Miles Teller", "J.K. Simmons", "Paul Reiser"], logline: "A young drummer is pushed to the edge by a ferocious conservatory instructor.", art: art("#0c0a08", "#3a2308", "#f2a93b", "#f6ecda", 1) },
  { id: "m23", title: "Zodiac", year: 2007, rating: "9.0", audience: "7.7", duration: 157, genres: ["Crime", "Mystery"], status: "in-progress", progress: 77, director: "David Fincher", cast: ["Jake Gyllenhaal", "Mark Ruffalo", "Robert Downey Jr."], logline: "A cartoonist becomes obsessed with the hunt for the Zodiac killer.", art: art("#4a4526", "#131108", "#e8d680", "#f1edd8", 3) },
];

export const shows = [
  { id: "s1", title: "Severance", years: "2022—", network: "Apple TV+", seasons: 2, watched: 14, total: 19, logline: "Mark leads a team of office workers whose memories have been surgically divided between their work and personal lives. When a mysterious colleague appears outside of work, it begins a journey to the truth about their jobs.", art: art("#1e4b5c", "#07141a", "#bfe3ea", "#eef7f9", 3) },
  { id: "s2", title: "The Bear", years: "2022—", network: "FX", seasons: 3, watched: 28, total: 28, logline: "A fine-dining chef comes home to run his late brother's Chicago sandwich shop.", art: art("#1d3b5a", "#09131e", "#f2f2f2", "#f6f6f4", 1) },
  { id: "s3", title: "Shōgun", years: "2024", network: "FX", seasons: 1, watched: 3, total: 10, logline: "In feudal Japan, a stranded English pilot is drawn into a lord's fight for power.", art: art("#5c1a12", "#120504", "#e0b36a", "#f6ead8", 2) },
  { id: "s4", title: "Slow Horses", years: "2022—", network: "Apple TV+", seasons: 4, watched: 12, total: 24, logline: "A team of MI5 rejects keep stumbling into the cases nobody wanted them on.", art: art("#4a4a3a", "#16160e", "#d9c77a", "#efeee4", 1) },
  { id: "s5", title: "Andor", years: "2022–25", network: "Disney+", seasons: 2, watched: 20, total: 24, logline: "A thief becomes a rebel as an empire tightens its grip.", art: art("#27313d", "#090d12", "#e36d3a", "#e9edf2", 0) },
  { id: "s6", title: "Succession", years: "2018–23", network: "HBO", seasons: 4, watched: 39, total: 39, logline: "The children of a media titan scheme for control of the family empire.", art: art("#1f1f1f", "#3b3b3b", "#d9d9d9", "#f2f2f2", 3) },
  { id: "s7", title: "Silo", years: "2023—", network: "Apple TV+", seasons: 2, watched: 0, total: 20, logline: "Thousands live in a vast underground silo, and nobody may ask what lies outside.", art: art("#2b3a2a", "#0a0f09", "#c7d98a", "#eef3e2", 2) },
  { id: "s8", title: "Fargo", years: "2014—", network: "FX", seasons: 5, watched: 41, total: 51, logline: "Midwestern crime stories where ordinary people make terrible decisions.", art: art("#d8dde2", "#8f9ba5", "#9a1b1b", "#161a1e", 0) },
];

export const severanceSeasons = [
  { id: "s1-1", number: 1, watched: 9, total: 9 },
  { id: "s1-2", number: 2, watched: 5, total: 10 },
];

export const severanceS2 = [
  { number: 1, title: "Hello, Ms. Cobel", duration: 62, status: "watched", summary: "Mark returns to work after five months away and finds the severed floor changed in ways nobody will explain." },
  { number: 2, title: "Goodbye, Mrs. Selvig", duration: 51, status: "watched", summary: "The team searches for answers about Ms. Casey while Helly takes a stand." },
  { number: 3, title: "Who Is Alive?", duration: 54, status: "watched", summary: "Dylan grapples with what he learned during the overtime contingency." },
  { number: 4, title: "Woe's Hollow", duration: 58, status: "watched", summary: "The macrodata refinement team is sent on an outdoor team-building retreat." },
  { number: 5, title: "Trojan's Horse", duration: 46, status: "in-progress", progress: 35, summary: "The team processes a loss. Mark tries to make up for lost time." },
  { number: 6, title: "Attila", duration: 47, status: "unwatched", summary: "Mark and Devon consult an expert. Dylan's outie makes a discovery." },
  { number: 7, title: "Chikhai Bardo", duration: 60, status: "unwatched", summary: "A look at Gemma's past reveals the depth of Lumon's ambitions." },
  { number: 8, title: "Sweet Vitriol", duration: 38, status: "unwatched", summary: "Harmony Cobel visits her hometown." },
  { number: 9, title: "The After Hours", duration: 49, status: "unwatched", summary: "Mark receives a warning as the innies plan their final move." },
  { number: 10, title: "Cold Harbor", duration: 76, status: "unwatched", summary: "Mark completes his most important file." },
];

export const heroIds = ["m7", "m20", "m18", "m9"];

export const recent = [
  { kind: "movie", id: "m20", added: "Today" },
  { kind: "episode", show: "s1", code: "S2 · E5", title: "Trojan's Horse", added: "Today" },
  { kind: "movie", id: "m7", added: "Today" },
  { kind: "episode", show: "s5", code: "S2 · E9", title: "Welcome to the Rebellion", added: "Today" },
  { kind: "movie", id: "m9", added: "Today" },
  { kind: "movie", id: "m5", added: "Yesterday" },
  { kind: "episode", show: "s3", code: "S1 · E4", title: "The Eightfold Fence", added: "Yesterday" },
  { kind: "movie", id: "m6", added: "Yesterday" },
  { kind: "movie", id: "m19", added: "Yesterday" },
  { kind: "movie", id: "m18", added: "This week" },
  { kind: "movie", id: "m17", added: "This week" },
  { kind: "episode", show: "s4", code: "S3 · E1", title: "Strange Games", added: "This week" },
  { kind: "movie", id: "m2", added: "This week" },
  { kind: "episode", show: "s7", code: "S1 · E1", title: "Freedom Day", added: "This week" },
  { kind: "movie", id: "m11", added: "This week" },
];

export const continueWatching = [
  { kind: "episode", show: "s1", code: "S2 · E5", title: "Trojan's Horse", progress: 35, left: "30 min left", glow: "78% 30%" },
  { kind: "movie", id: "m13", progress: 61, left: "1h 20m left", glow: "30% 45%" },
  { kind: "movie", id: "m23", progress: 77, left: "36 min left", glow: "65% 60%" },
  { kind: "movie", id: "m3", progress: 42, left: "1h 7m left", glow: "50% 25%" },
];
