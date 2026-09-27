import { playerURL } from './player.js';

let heroTimer;
let notificationTimer;
let navigationController;
let authController;
let episodeIndexController;

const state = {
  heroIndex: 0,
  section: "recently-added",
  config: [],
  recent: [],
  movies: [],
  selectedMovieId: null,
  movieSort: "title-asc",
  movieFilterGenre: "",
  movieFilterWatch: "all",
  movieFilterRuntime: "all",
  movieFilterRecent: false,
  shows: [],
  selectedShowId: null,
  selectedShowTitle: "",
  selectedShowSummary: "",
  selectedShowArtUrl: "",
  seasons: [],
  selectedSeasonId: null,
  episodes: [],
  seasonEpisodeCache: {},
  searchEpisodes: [],
  searchEpisodesLoaded: false,
  searchEpisodesLoading: null,
  highlightedEpisodeId: null,
  searchQuery: "",
  continueWatching: [],
};

const sectionMeta = {
  "recently-added": {
    title: "Recently Added",
    description: "Latest episodes and movies added to your Plex library.",
  },
  tv: {
    title: "TV Shows",
    description: "Browse shows, seasons, and episodes.",
  },
  movies: {
    title: "Movies",
    description: "Your movie collection at a glance.",
  },
  settings: {
    title: "Settings",
    description: "Configure your Plex server connection.",
  },
};

window.addEventListener("DOMContentLoaded", async () => {
  wireSectionNav();
  wireSearch();
  try { await loadConfig(); } catch (error) { notify(error.message); }
  window.addEventListener("popstate", () => {
    void navigateToRoute(parseRoute(window.location.pathname), { historyMode: "none" });
  });
  document.addEventListener("click", () => {
    document.querySelectorAll(".overflow-menu-dropdown.open").forEach((d) => d.classList.remove("open"));
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const active = document.activeElement;
      if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT")) return;
      e.preventDefault();
      const searchInput = document.getElementById("search-input");
      if (searchInput) searchInput.focus();
    }
  });
  await navigateToRoute(parseRoute(window.location.pathname), { historyMode: "none" });
});

function parseRoute(pathname) {
  const segments = pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  if (!segments.length || segments[0] === "recently-added") {
    return { section: "recently-added" };
  }

  if (segments[0] === "movies") {
    if (segments[1]) {
      return { section: "movies", movieId: decodeURIComponent(segments[1]) };
    }
    return { section: "movies" };
  }

  if (segments[0] === "tv") {
    if (segments[1] && segments[2] === "season" && segments[3]) {
      return {
        section: "tv",
        showId: decodeURIComponent(segments[1]),
        seasonId: decodeURIComponent(segments[3]),
      };
    }
    if (segments[1]) {
      return { section: "tv", showId: decodeURIComponent(segments[1]) };
    }
    return { section: "tv" };
  }

  if (segments[0] === "settings") {
    return { section: "settings" };
  }

  return { section: "recently-added" };
}

function routePath(route) {
  if (route.section === "movies") {
    if (route.movieId) {
      return `/movies/${encodeURIComponent(route.movieId)}`;
    }
    return "/movies";
  }

  if (route.section === "tv") {
    if (route.showId && route.seasonId) {
      return `/tv/${encodeURIComponent(route.showId)}/season/${encodeURIComponent(route.seasonId)}`;
    }
    if (route.showId) {
      return `/tv/${encodeURIComponent(route.showId)}`;
    }
    return "/tv";
  }

  if (route.section === "settings") {
    return "/settings";
  }

  return "/recently-added";
}

function setRoute(route, historyMode = "push") {
  const path = routePath(route);
  if (path === window.location.pathname) {
    return;
  }
  if (historyMode === "replace") {
    window.history.replaceState({}, "", path);
    return;
  }
  window.history.pushState({}, "", path);
}

async function navigateToRoute(route, options = {}) {
  authController?.abort();
  if (options.historyMode !== 'none') setRoute(route, options.historyMode);
  navigationController?.abort();
  navigationController = new AbortController();
  const controller = navigationController;
  clearInterval(heroTimer);
  document.body.classList.remove('detail-view', 'home-view');
  document.getElementById('library-count').textContent = '';
  document.getElementById('content').innerHTML = '<div class="empty-state" role="status">Opening your library…</div>';
  try {
    await navigateToRouteImpl(route, options);
    if (!controller.signal.aborted) document.title = (state.selectedMovieId && state.section === 'movies' ? state.movies.find(m => m.id === state.selectedMovieId)?.title : sectionMeta[state.section].title) + ' · pli';
  } catch (error) {
    if (error.name === 'AbortError') return;
    if (options.historyMode !== 'none') setRoute(route, options.historyMode);
    document.querySelector('.topbar').style.display = '';
    document.getElementById('content').innerHTML = '<div class="empty-state"><h2>Your cinema is waiting.</h2><p>' + escapeHtml(error.message) + '</p><div><button class="btn btn-primary" id="connect-plex">Open settings</button><button class="btn btn-secondary" id="retry-library">Try again</button></div></div>';
    document.getElementById('connect-plex').onclick = () => navigateToRoute({section:'settings'});
    document.getElementById('retry-library').onclick = () => navigateToRoute(route, {historyMode:'none'});
  }
}

async function navigateToRouteImpl(route, options = {}) {
  const { historyMode = "push" } = options;
  const section = route.section || "recently-added";

  document.querySelector(".topbar").style.display = "";
  state.section = section;
  state.selectedMovieId = null;
  document.getElementById("section-eyebrow").textContent = ({movies:"THE COLLECTION", tv:"TELEVISION", settings:"MAKE YOURSELF AT HOME"})[section] || "YOUR LIBRARY";
  state.searchQuery = "";
  const searchInput = document.getElementById("search-input");
  if (searchInput) searchInput.value = "";
  setActiveButton(section);
  setHeader(sectionMeta[section].title, sectionMeta[section].description);

  if (section === "recently-added") {
    await loadRecentlyAdded();
    renderRecentlyAdded();
    if (historyMode !== "none") {
      setRoute({ section: "recently-added" }, historyMode);
    }
  }

  if (section === "movies") {
    state.selectedMovieId = null;
    await loadMovies();
    if (route.movieId && state.movies.some((movie) => movie.id === route.movieId)) {
      await openMovieDetail(route.movieId, { historyMode: "none" });
    } else {
      renderMovies();
    }
    if (historyMode !== "none") {
      if (state.selectedMovieId) {
        setRoute({ section: "movies", movieId: state.selectedMovieId }, historyMode);
      } else {
        setRoute({ section: "movies" }, historyMode);
      }
    }
  }

  if (section === "tv") {
    await loadTVShows();
    if (state.shows.length) {
      if (route.showId && state.shows.some((show) => show.id === route.showId) && route.showId !== state.selectedShowId) {
        await selectShow(route.showId);
      }
      if (
        route.seasonId &&
        state.seasons.some((season) => season.id === route.seasonId) &&
        route.seasonId !== state.selectedSeasonId
      ) {
        await selectSeason(route.seasonId, false);
      }
    }
    renderTV();
    if (historyMode !== "none") {
      if (state.selectedShowId && state.selectedSeasonId) {
        setRoute({ section: "tv", showId: state.selectedShowId, seasonId: state.selectedSeasonId }, historyMode);
      } else if (state.selectedShowId) {
        setRoute({ section: "tv", showId: state.selectedShowId }, historyMode);
      } else {
        setRoute({ section: "tv" }, historyMode);
      }
    }
  }

  if (section === "settings") {
    renderSettings();
    if (historyMode !== "none") {
      setRoute({ section: "settings" }, historyMode);
    }
  }

  drawIcons();
}

function wireSectionNav() {
  document.querySelectorAll("[data-section]").forEach((button) => {
    button.addEventListener("click", async () => {
      const section = button.dataset.section;
      if (!section) return;
      if (section === state.section && !state.selectedMovieId && !state.selectedShowId) return;
      await navigateToRoute({ section }, { historyMode: "push" });
    });
  });
}

function setActiveButton(section) {
  document.querySelectorAll("[data-section]").forEach((button) => {
    button.classList.toggle("active", button.dataset.section === section);
    if (button.dataset.section === section) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
}

function setHeader(title, description, { html = false } = {}) {
  document.getElementById("section-title").textContent = title;
  const desc = document.getElementById("section-description");
  if (html) {
    desc.innerHTML = description;
  } else {
    desc.textContent = description;
  }
}

async function loadConfig() {
  const response = await fetchJSON("/api/config");
  state.config = response.configs ?? [];
}

async function loadRecentlyAdded() {
  const [recentRes] = await Promise.all([
    fetchJSON("/api/recently-added"),
    loadContinueWatching(),
  ]);
  state.recent = recentRes.items ?? [];
}

async function loadContinueWatching() {
  const response = await fetchJSON("/api/continue-watching");
  state.continueWatching = response.items ?? [];
}

async function loadMovies() {
  const response = await fetchJSON("/api/movies");
  state.movies = response.movies ?? [];
  if (state.section === "movies") document.getElementById("library-count").textContent = `${state.movies.length} FILMS`;
}

async function loadTVShows() {
  const response = await fetchJSON("/api/tv/shows");
  state.shows = response.shows ?? [];
  if (state.section === "tv") document.getElementById("library-count").textContent = `${state.shows.length} SERIES`;

  if (!state.shows.length) {
    state.selectedShowId = null;
    state.selectedSeasonId = null;
    state.seasons = [];
    state.episodes = [];
    state.seasonEpisodeCache = {};
    state.selectedShowTitle = "";
    state.selectedShowSummary = "";
    state.selectedShowArtUrl = "";
    return;
  }

  if (!state.selectedShowId || !state.shows.some((show) => show.id === state.selectedShowId)) {
    state.selectedShowId = state.shows[0].id;
  }

  await selectShow(state.selectedShowId);
}

async function selectShow(showId) {
  state.selectedShowId = showId;
  const response = await fetchJSON(`/api/tv/shows/${encodeURIComponent(showId)}/seasons`);
  state.selectedShowTitle = response.show?.title ?? "";
  state.selectedShowSummary = response.show?.summary ?? "";
  state.selectedShowArtUrl = response.show?.art_url ?? "";
  state.seasons = response.seasons ?? [];

  if (!state.seasons.length) {
    state.selectedSeasonId = null;
    state.episodes = [];
    renderTV();
    return;
  }

  if (!state.selectedSeasonId || !state.seasons.some((season) => season.id === state.selectedSeasonId)) {
    state.selectedSeasonId = state.seasons[0].id;
  }

  await selectSeason(state.selectedSeasonId, false);
}

async function selectSeason(seasonId, rerender = true) {
  state.selectedSeasonId = seasonId;
  const showQuery = state.selectedShowId ? `?show_id=${encodeURIComponent(state.selectedShowId)}` : "";
  const response = await fetchJSON(`/api/tv/seasons/${encodeURIComponent(seasonId)}/episodes${showQuery}`);
  state.episodes = response.episodes ?? [];
  if (state.selectedShowId) {
    state.seasonEpisodeCache[seasonCacheKey(state.selectedShowId, seasonId)] = state.episodes;
  }
  if (rerender) {
    renderTV();
    drawIcons();
  }
}

function seasonCacheKey(showId, seasonId) {
  return `${showId}:${seasonId}`;
}

async function fetchSeasonEpisodes(showId, seasonId, signal) {
  signal?.throwIfAborted();
  const key = seasonCacheKey(showId, seasonId);
  if (state.seasonEpisodeCache[key]) {
    return state.seasonEpisodeCache[key];
  }
  const response = await fetchJSON(
    `/api/tv/seasons/${encodeURIComponent(seasonId)}/episodes?show_id=${encodeURIComponent(showId)}`,
    signal,
  );
  signal?.throwIfAborted();
  const episodes = response.episodes ?? [];
  state.seasonEpisodeCache[key] = episodes;
  return episodes;
}

// ---- Search ----

function wireSearch() {
  const input = document.getElementById('search-input');
  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const query = input.value.trim();
      if (query.length < 2) {
        if (state.searchQuery) await navigateToRoute(parseRoute(location.pathname), {historyMode:'none'});
        return;
      }
      state.searchQuery = query;
      clearInterval(heroTimer);
      document.body.classList.remove('home-view', 'detail-view');
      document.querySelector('.topbar').style.display = '';
      setHeader('Search', 'Films, series, and episodes from your library.');
      document.getElementById('section-eyebrow').textContent = 'FIND YOUR NEXT WATCH';
      try {
        await ensureSearchData();
        if (input.value.trim() !== query) return;
        renderSearchResults(performSearch(query));
        drawIcons();
        if (!state.searchEpisodesLoaded) {
          void buildEpisodeSearchIndex().then(() => {
            if (state.searchQuery !== query) return;
            renderSearchResults(performSearch(query));
            drawIcons();
          }).catch(error => { if (error.name !== 'AbortError') notify(error.message); });
        }
      } catch (error) { if (error.name !== 'AbortError') notify(error.message); }
    }, 200);
  });
}

async function ensureSearchData() {
  const promises = [];
  if (!state.movies.length) promises.push(loadMovies());
  if (!state.shows.length) promises.push(loadTVShows());
  if (promises.length) await Promise.all(promises);
}

async function buildEpisodeSearchIndex() {
  if (state.searchEpisodesLoaded) {
    return;
  }
  if (state.searchEpisodesLoading) {
    await state.searchEpisodesLoading;
    return;
  }

  const controller = new AbortController();
  episodeIndexController = controller;
  const shows = [...state.shows];
  const loading = (async () => {
    const episodes = [];
    const concurrency = 4;

    for (let i = 0; i < shows.length; i += concurrency) {
      controller.signal.throwIfAborted();
      const batch = shows.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map(async (show) => {
          const seasonsResponse = await fetchJSON(`/api/tv/shows/${encodeURIComponent(show.id)}/seasons`, controller.signal);
          const seasons = seasonsResponse.seasons ?? [];

          const showEpisodes = [];
          for (const season of seasons) {
            const seasonEpisodes = await fetchSeasonEpisodes(show.id, season.id, controller.signal);

            for (const episode of seasonEpisodes) {
              showEpisodes.push({
                id: episode.id,
                title: episode.title,
                summary: episode.summary ?? "",
                watched: Boolean(episode.watched),
                viewOffset: episode.view_offset || 0,
                duration: episode.duration || 0,
                showId: show.id,
                showTitle: show.title,
                seasonId: season.id,
                seasonNumber: season.season_number,
                episodeNumber: episode.episode_number,
              });
            }
          }
          return showEpisodes;
        }),
      );

      episodes.push(...batchResults.flat());
    }

    controller.signal.throwIfAborted();
    state.searchEpisodes = episodes;
    state.searchEpisodesLoaded = true;
  })();
  state.searchEpisodesLoading = loading;

  try {
    await loading;
  } finally {
    controller.abort();
    if (state.searchEpisodesLoading === loading) state.searchEpisodesLoading = null;
    if (episodeIndexController === controller) episodeIndexController = null;
  }
}

function normalizeSearchText(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function fuzzyScore(haystack, normalizedQuery) {
  if (!normalizedQuery) return -1;
  const text = normalizeSearchText(haystack);
  if (!text) return -1;

  const index = text.indexOf(normalizedQuery);
  if (index >= 0) {
    return 1000 - index * 2 - (text.length - normalizedQuery.length);
  }

  let score = 0;
  let queryIndex = 0;
  let lastMatch = -1;
  for (let textIndex = 0; textIndex < text.length && queryIndex < normalizedQuery.length; textIndex += 1) {
    if (text[textIndex] !== normalizedQuery[queryIndex]) continue;
    score += lastMatch === textIndex - 1 ? 10 : 4;
    if (lastMatch >= 0) score -= Math.max(0, textIndex - lastMatch - 1);
    lastMatch = textIndex;
    queryIndex += 1;
  }

  if (queryIndex !== normalizedQuery.length) return -1;
  return score - Math.max(0, text.length - normalizedQuery.length);
}

function rankByFuzzy(items, query, buildText, limit = 20) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [];
  return items
    .map((item) => {
      const text = buildText(item);
      const score = fuzzyScore(text, normalizedQuery);
      return { item, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.item);
}

function performSearch(query) {
  const movies = rankByFuzzy(
    state.movies,
    query,
    (movie) => `${movie.title} ${movie.year || ""} ${(movie.genres || []).join(" ")} ${(movie.directors || []).join(" ")} ${(movie.actors || []).join(" ")}`,
    18,
  );
  const shows = rankByFuzzy(
    state.shows,
    query,
    (show) => `${show.title} ${show.next_up || ""} ${show.summary || ""}`,
    18,
  );
  const episodes = rankByFuzzy(
    state.searchEpisodes,
    query,
    (episode) =>
      `${episode.showTitle} ${episode.title} season ${episode.seasonNumber} episode ${episode.episodeNumber} ${episode.summary || ""}`,
    30,
  );

  return {
    movies,
    shows,
    episodes,
    episodesLoading: Boolean(state.searchEpisodesLoading) && !state.searchEpisodesLoaded,
  };
}

function renderSearchResults(results) {
  const content = document.getElementById("content");
  const { movies, shows, episodes, episodesLoading } = results;

  if (!movies.length && !shows.length && !episodes.length) {
    content.innerHTML = `<div class="empty-state">No results for "${escapeHtml(state.searchQuery)}"</div>`;
    return;
  }

  let html = "";

  if (shows.length) {
    html += `<div class="search-section-title">TV Shows (${shows.length})</div>`;
    html += `<div class="show-list">`;
    html += shows
      .map(
        (show) => `
        <div class="show-item" data-search-show-id="${escapeHtml(show.id)}">
          <div class="show-item-cover">
            ${renderCover(show.cover_url, show.title)}
          </div>
          <div class="show-item-info">
            <div class="show-item-title">${escapeHtml(show.title)}</div>
            <div class="show-item-meta">${show.watched_count}/${show.total_episodes} episodes</div>
          </div>
          <div class="show-item-chevron"><i data-lucide="chevron-right"></i></div>
        </div>
      `,
      )
      .join("");
    html += `</div>`;
  }

  if (episodesLoading) {
    html += `<div class="search-loading">Indexing episodes for global search...</div>`;
  }

  if (episodes.length) {
    html += `<div class="search-section-title">Episodes (${episodes.length})</div>`;
    html += `<div class="episode-search-list">`;
    html += episodes
      .map(
        (episode) => `
        <div class="episode-search-item" data-search-episode-id="${escapeHtml(episode.id)}" data-search-show-id="${escapeHtml(episode.showId)}" data-search-season-id="${escapeHtml(episode.seasonId)}">
          <div class="episode-search-main">
            <div class="episode-search-title">${escapeHtml(episode.showTitle)} · S${String(episode.seasonNumber).padStart(2, "0")}E${String(episode.episodeNumber).padStart(2, "0")}</div>
            <div class="episode-search-meta">${escapeHtml(episode.title)}</div>
          </div>
          <div class="episode-search-actions">
            <span class="badge ${episode.watched ? "watched" : episode.viewOffset ? "in-progress" : "unwatched"}">
              ${episode.watched ? "Watched" : episode.viewOffset ? "In Progress" : "Unwatched"}
            </span>
            <button class="play-btn" data-play-type="episode" data-play-id="${escapeHtml(episode.id)}" title="Play">
              <i data-lucide="play"></i>
            </button>
          </div>
        </div>
      `,
      )
      .join("");
    html += `</div>`;
  }

  if (movies.length) {
    html += `<div class="search-section-title">Movies (${movies.length})</div>`;
    html += `<div class="movie-grid">${movies.map(movieCardHtml).join("")}</div>`;
  }

  content.innerHTML = html;
  wirePlayButtons(content);

  content.querySelectorAll("[data-search-show-id]:not([data-search-episode-id])").forEach((node) => {
    node.addEventListener("click", () => {
      const showId = node.getAttribute("data-search-show-id");
      if (showId) {
        state.searchQuery = "";
        const searchInput = document.getElementById("search-input");
        if (searchInput) searchInput.value = "";
        void navigateToRoute({ section: "tv", showId }, { historyMode: "push" });
      }
    });
  });

  content.querySelectorAll("[data-search-episode-id]").forEach((node) => {
    node.addEventListener("click", (e) => {
      if (e.target.closest(".play-btn")) return;
      const episodeId = node.getAttribute("data-search-episode-id");
      const showId = node.getAttribute("data-search-show-id");
      const seasonId = node.getAttribute("data-search-season-id");
      if (!episodeId || !showId || !seasonId) {
        return;
      }
      state.searchQuery = "";
      state.highlightedEpisodeId = episodeId;
      const searchInput = document.getElementById("search-input");
      if (searchInput) searchInput.value = "";
      void navigateToRoute({ section: "tv", showId, seasonId }, { historyMode: "push" });
    });
  });

  content.querySelectorAll("[data-movie-id]").forEach((node) => {
    node.addEventListener("click", () => {
      const movieID = node.getAttribute("data-movie-id");
      if (movieID) {
        state.searchQuery = "";
        const searchInput = document.getElementById("search-input");
        if (searchInput) searchInput.value = "";
        openMovieDetail(movieID);
      }
    });
  });
}

// ---- Renderers ----

function renderRecentlyAdded() {
  const content = document.getElementById('content');
  document.body.classList.add('home-view');
  if (!state.recent.length && !state.continueWatching.length) {
    content.innerHTML = '<div class="empty-state"><h2>A little room for something great.</h2><p>New films and episodes will appear here when you add them to your Plex library.</p></div>';
    return;
  }
  const groups = new Map();
  for (const item of [...state.recent].sort((a, b) => new Date(b.added_at) - new Date(a.added_at))) {
    const date = new Date(item.added_at);
    const days = Math.floor((new Date().setHours(0,0,0,0) - new Date(date).setHours(0,0,0,0)) / 86400000);
    const label = Number.isNaN(date.getTime()) ? 'Recently added' : days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : days < 7 ? 'This week' : date.toLocaleDateString(undefined,{month:'long',day:'numeric'});
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(item);
  }
  const shelves = [...groups].map(([label, items]) => '<div class="shelf-group"><div class="shelf-date"><h3>'+escapeHtml(label)+'</h3><span class="mono">'+items.length+' ARRIVALS</span></div><div class="poster-grid">'+items.map(item => {
    const title = item.title || item.headline;
    return '<article class="poster-card" tabindex="0" role="button" aria-label="'+escapeHtml(title)+'" data-recent-id="'+escapeHtml(item.id)+'" data-recent-type="'+escapeHtml(item.type)+'"><div class="poster-cover">'+renderCover(item.cover_url,title)+'<div class="poster-overlay"><button class="play-btn" aria-label="Play '+escapeHtml(title)+'" data-play-type="'+escapeHtml(item.type)+'" data-play-id="'+escapeHtml(item.id)+'"><i data-lucide="play"></i></button><p>'+escapeHtml(item.summary || item.subline)+'</p></div></div><div class="poster-title">'+escapeHtml(title)+'</div><div class="poster-caption">'+escapeHtml(item.type === 'episode' ? item.headline.split(' ').at(-1)+' · '+item.subline : item.subline+' · '+(item.genres?.[0] || 'FILM'))+'</div></article>';
  }).join('')+'</div></div>').join('');
  const continuing = state.continueWatching.length ? '<section><div class="section-heading"><h2>Continue watching</h2><span class="mono">'+state.continueWatching.length+' IN PROGRESS</span></div><div class="cw-row">'+state.continueWatching.slice(0,6).map(item => {
    const pct = item.duration ? Math.min(100,Math.round(item.view_offset/item.duration*100)) : 0;
    const left = Math.max(0, Math.ceil((item.duration-item.view_offset)/60000));
    return '<article class="cw-card" tabindex="0" role="button" aria-label="Resume '+escapeHtml(item.title)+'" data-resume-id="'+escapeHtml(item.id)+'" data-resume-type="'+escapeHtml(item.type)+'"><div class="cw-card-cover">'+renderCover(item.art_url || item.cover_url,item.title)+'<button class="play-btn cover-play" aria-label="Resume '+escapeHtml(item.title)+'" data-play-type="'+escapeHtml(item.type)+'" data-play-id="'+escapeHtml(item.id)+'"><i data-lucide="play"></i></button>'+progressBar(item.view_offset,item.duration)+'</div><div class="cw-card-title">'+escapeHtml(item.title)+'</div><div class="cw-card-sub">'+escapeHtml(item.subtitle || '')+'</div><div class="cw-progress mono"><span>'+pct+'% WATCHED</span><span>'+left+' MIN LEFT</span></div></article>';
  }).join('')+'</div></section>' : '';
  content.innerHTML = '<section id="cinema-hero" class="cinema-hero" aria-label="Featured in your library"></section><div class="home-sections">'+continuing+(shelves ? '<section><div class="section-heading"><h2>Fresh on the shelf</h2><span class="mono">'+state.recent.length+' NEW ARRIVALS</span></div>'+shelves+'</section>' : '')+'</div>';
  state.heroIndex = 0;
  renderHero();
  content.querySelectorAll('[data-recent-id]').forEach(card => card.onclick = event => {
    if (event.target.closest('button')) return;
    if (card.dataset.recentType === 'movie') void navigateToRoute({section:'movies',movieId:card.dataset.recentId});
    else void playItem(card.dataset.recentType,card.dataset.recentId);
  });
  content.querySelectorAll('[data-resume-id]').forEach(card => card.onclick = event => {
    if (!event.target.closest('button')) void playItem(card.dataset.resumeType,card.dataset.resumeId);
  });
  wirePlayButtons(content);
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches && state.recent.length > 1) {
    heroTimer = setInterval(() => {
      const hero = document.getElementById('cinema-hero');
      if (!hero || document.hidden || hero.matches(':hover') || hero.contains(document.activeElement)) return;
      state.heroIndex = (state.heroIndex + 1) % Math.min(4,state.recent.length);
      renderHero();
    }, 10000);
  }
}

function renderHero() {
  const hero = document.getElementById('cinema-hero');
  if (!hero) return;
  const items = state.recent.length ? state.recent.slice(0,4) : state.continueWatching.slice(0,4);
  const item = items[state.heroIndex % items.length];
  const title = item.title || item.headline;
  const meta = [item.year, formatDuration(item.duration), ...(item.genres || []).slice(0,2), item.directors?.[0] ? 'Dir. '+item.directors[0] : ''].filter(Boolean).join(' / ');
  hero.innerHTML = '<div class="hero-art" style="--hue:'+posterHue(title)+'">'+(item.art_url ? '<img src="'+escapeHtml(item.art_url)+'" alt="">' : '')+'</div><div class="hero-wordmark" aria-hidden="true">'+escapeHtml(title)+'</div><div class="hero-shade"></div><div class="hero-inner"><div class="hero-copy"><div class="eyebrow">'+(item.type === 'episode' ? 'YOUR NEXT CHAPTER' : 'TONIGHT, SOMETHING GREAT')+'</div><h1>'+escapeHtml(title)+'</h1><div class="hero-meta">'+escapeHtml(meta || item.subline || item.subtitle || 'From your Plex library')+'</div><p class="hero-summary">'+escapeHtml(item.summary || (item.type === 'episode' ? item.subline || item.subtitle : 'Settle in. Your next great watch is right here.'))+'</p><div class="hero-actions"><button class="btn btn-primary" data-play-type="'+escapeHtml(item.type)+'" data-play-id="'+escapeHtml(item.id)+'"><i data-lucide="play"></i>'+(item.view_offset ? 'Resume' : 'Play')+'</button>'+(item.type === 'movie' ? '<button class="btn btn-secondary" id="hero-details">More about this film</button>' : '')+'</div></div><div class="hero-controls"><span class="hero-number">'+String(state.heroIndex+1).padStart(2,'0')+' / '+String(items.length).padStart(2,'0')+'</span><button class="round-button" id="hero-prev" aria-label="Previous featured title"><i data-lucide="arrow-left"></i></button><button class="round-button" id="hero-next" aria-label="Next featured title"><i data-lucide="arrow-right"></i></button></div></div>';
  hero.querySelector('#hero-details')?.addEventListener('click', () => navigateToRoute({section:'movies',movieId:item.id}));
  for (const [id, step] of [['hero-prev',-1],['hero-next',1]]) hero.querySelector('#'+id).onclick = () => {
    state.heroIndex = (state.heroIndex + step + items.length) % items.length;
    renderHero();
    document.getElementById(id).focus({preventScroll:true});
  };
  wirePlayButtons(hero);
  drawIcons();
}

function posterHue(title) {
  return [...String(title)].reduce((sum, c) => (sum * 31 + c.charCodeAt(0)) % 360, 25);
}

function movieCardHtml(movie) {
  return `
    <article class="movie-card" tabindex="0" role="button" aria-label="${escapeHtml(movie.title)}" data-movie-id="${escapeHtml(movie.id)}">
      <div class="movie-card-cover">
        ${renderCover(movie.cover_url, movie.title)}
        <span class="badge cover-badge ${movie.watched ? "watched" : movie.view_offset ? "in-progress" : "unwatched"}">
          ${movie.watched ? "Watched" : movie.view_offset ? "In Progress" : "Unwatched"}
        </span>
        <button class="play-btn cover-play" data-play-type="movie" data-play-id="${escapeHtml(movie.id)}" title="Play">
          <i data-lucide="play"></i>
        </button>
        ${progressBar(movie.view_offset, movie.duration)}
      </div>
      <div class="movie-card-year">${movie.year}</div>
      <div class="movie-card-title">${escapeHtml(movie.title)}</div>
    </article>
  `;
}

function collectGenres(movies) {
  const set = new Set();
  for (const movie of movies) {
    if (movie.genres) {
      for (const g of movie.genres) set.add(g);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

function getFilteredSortedMovies() {
  let list = state.movies;

  if (state.movieFilterGenre) {
    list = list.filter((m) => m.genres && m.genres.includes(state.movieFilterGenre));
  }

  if (state.movieFilterRecent) {
    const releaseCutoffYear = new Date().getFullYear() - 1;
    list = list.filter((m) => Number(m.year || 0) >= releaseCutoffYear);
  }

  if (state.movieFilterRuntime !== "all") {
    list = list.filter((movie) => {
      const minutes = Number(movie.duration || 0) / 60000;
      if (!minutes) return false;
      if (state.movieFilterRuntime === "short") return minutes < 90;
      if (state.movieFilterRuntime === "feature") return minutes >= 90 && minutes <= 150;
      if (state.movieFilterRuntime === "long") return minutes > 150;
      return true;
    });
  }

  if (state.movieFilterWatch === "unwatched") {
    list = list.filter((m) => !m.watched && !m.view_offset);
  } else if (state.movieFilterWatch === "in-progress") {
    list = list.filter((m) => !m.watched && m.view_offset);
  } else if (state.movieFilterWatch === "watched") {
    list = list.filter((m) => m.watched);
  }

  const sorted = [...list];
  switch (state.movieSort) {
    case "title-desc":
      sorted.sort((a, b) => b.title.localeCompare(a.title));
      break;
    case "year-desc":
      sorted.sort((a, b) => b.year - a.year || a.title.localeCompare(b.title));
      break;
    case "year-asc":
      sorted.sort((a, b) => a.year - b.year || a.title.localeCompare(b.title));
      break;
    case "rating-desc":
      sorted.sort((a, b) => (parseFloat(b.audience_rating) || 0) - (parseFloat(a.audience_rating) || 0) || a.title.localeCompare(b.title));
      break;
    case "added-desc":
      sorted.sort((a, b) => (b.added_at || "").localeCompare(a.added_at || "") || a.title.localeCompare(b.title));
      break;
    default:
      sorted.sort((a, b) => a.title.localeCompare(b.title));
      break;
  }
  return sorted;
}

function renderMovies() {
  const content = document.getElementById("content");
  if (!state.movies.length) {
    content.innerHTML = `<div class="empty-state">No movies found.</div>`;
    return;
  }

  const genres = collectGenres(state.movies);
  const filtered = getFilteredSortedMovies();
  const useAZRail =
    state.movieSort === "title-asc" &&
    !state.movieFilterGenre &&
    state.movieFilterWatch === "all" &&
    state.movieFilterRuntime === "all" &&
    !state.movieFilterRecent;

  const watchOptions = [
    { value: "all", label: "All" },
    { value: "unwatched", label: "Unwatched Only" },
    { value: "in-progress", label: "In Progress" },
    { value: "watched", label: "Watched" },
  ];

  const toolbarHtml = `
    <div class="movie-toolbar">
      <div class="toolbar-left">
        <select class="toolbar-select" id="movie-sort" aria-label="Sort movies">
          <option value="title-asc"${state.movieSort === "title-asc" ? " selected" : ""}>Title A–Z</option>
          <option value="title-desc"${state.movieSort === "title-desc" ? " selected" : ""}>Title Z–A</option>
          <option value="year-desc"${state.movieSort === "year-desc" ? " selected" : ""}>Newest</option>
          <option value="year-asc"${state.movieSort === "year-asc" ? " selected" : ""}>Oldest</option>
          <option value="rating-desc"${state.movieSort === "rating-desc" ? " selected" : ""}>Top Rated</option>
          <option value="added-desc"${state.movieSort === "added-desc" ? " selected" : ""}>Recently Added</option>
        </select>
        <select class="toolbar-select" id="movie-genre" aria-label="Filter by genre">
          <option value="">All Genres</option>
          ${genres.map((g) => `<option value="${escapeHtml(g)}"${state.movieFilterGenre === g ? " selected" : ""}>${escapeHtml(g)}</option>`).join("")}
        </select>
        <select class="toolbar-select" id="movie-runtime" aria-label="Filter by runtime">
          <option value="all"${state.movieFilterRuntime === "all" ? " selected" : ""}>Any Runtime</option>
          <option value="short"${state.movieFilterRuntime === "short" ? " selected" : ""}>Under 90m</option>
          <option value="feature"${state.movieFilterRuntime === "feature" ? " selected" : ""}>90m to 150m</option>
          <option value="long"${state.movieFilterRuntime === "long" ? " selected" : ""}>Over 150m</option>
        </select>
      </div>
      <div class="filter-pills">
        <button class="filter-pill${state.movieFilterRecent ? " active" : ""}" id="movie-recent-filter">Recently Released</button>
        ${watchOptions.map((o) => `<button class="filter-pill${state.movieFilterWatch === o.value ? " active" : ""}" data-watch-filter="${o.value}">${o.label}</button>`).join("")}
      </div>
    </div>
  `;

  let gridHtml = "";
  if (useAZRail) {
    const groups = new Map();
    for (const movie of filtered) {
      const first = (movie.title || "").charAt(0).toUpperCase();
      const letter = /[A-Z]/.test(first) ? first : "#";
      if (!groups.has(letter)) groups.set(letter, []);
      groups.get(letter).push(movie);
    }

    const allLetters = "#ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
    const activeLetters = new Set(groups.keys());

    const railHtml = allLetters
      .map((l) => {
        const active = activeLetters.has(l);
        return `<button class="az-letter ${active ? "" : "disabled"}" ${active ? "" : "disabled"} aria-label="Jump to ${l}" ${active ? `data-az-jump="${l}"` : ""}>${l}</button>`;
      })
      .join("");

    for (const letter of allLetters) {
      const movies = groups.get(letter);
      if (!movies) continue;
      gridHtml += `<section class="movie-letter-group"><div class="movie-grid-letter" id="az-${letter}">${letter}</div><div class="poster-grid">${movies.map(movieCardHtml).join("")}</div></section>`;
    }

    content.innerHTML = `
      ${toolbarHtml}
      <div class="movie-index">
        <div class="movie-grid">${gridHtml}</div>
        <nav class="az-rail">${railHtml}</nav>
      </div>
    `;

    content.querySelectorAll("[data-az-jump]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const letter = btn.getAttribute("data-az-jump");
        const target = document.getElementById("az-" + letter);
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  } else {
    gridHtml = filtered.map(movieCardHtml).join("");

    content.innerHTML = `
      ${toolbarHtml}
      <div class="movie-count">${filtered.length} movie${filtered.length !== 1 ? "s" : ""}</div>
      <div class="movie-grid">${gridHtml}</div>
    `;
  }

  wirePlayButtons(content);
  wireMovieToolbar(content);

  content.querySelectorAll("[data-movie-id]").forEach((node) => {
    node.addEventListener("click", () => {
      const movieID = node.getAttribute("data-movie-id");
      if (!movieID) return;
      openMovieDetail(movieID);
    });
  });
}

function wireMovieToolbar(container) {
  const sortSelect = container.querySelector("#movie-sort");
  if (sortSelect) {
    sortSelect.addEventListener("change", () => {
      state.movieSort = sortSelect.value;
      renderMovies();
      drawIcons();
    });
  }

  const genreSelect = container.querySelector("#movie-genre");
  if (genreSelect) {
    genreSelect.addEventListener("change", () => {
      state.movieFilterGenre = genreSelect.value;
      renderMovies();
      drawIcons();
    });
  }

  const runtimeSelect = container.querySelector("#movie-runtime");
  if (runtimeSelect) {
    runtimeSelect.addEventListener("change", () => {
      state.movieFilterRuntime = runtimeSelect.value;
      renderMovies();
      drawIcons();
    });
  }

  const recentToggle = container.querySelector("#movie-recent-filter");
  if (recentToggle) {
    recentToggle.addEventListener("click", () => {
      state.movieFilterRecent = !state.movieFilterRecent;
      renderMovies();
      drawIcons();
    });
  }

  container.querySelectorAll("[data-watch-filter]").forEach((pill) => {
    pill.addEventListener("click", () => {
      state.movieFilterWatch = pill.getAttribute("data-watch-filter");
      renderMovies();
      drawIcons();
    });
  });
}

async function openMovieDetail(movieID, options = {}) {
  const { historyMode = "push" } = options;
  await loadMovies();
  const movie = state.movies.find((item) => item.id === movieID);
  if (!movie) {
    return;
  }
  state.selectedMovieId = movie.id;
  state.section = "movies";
  setActiveButton("movies");
  document.body.classList.remove("home-view");
  document.body.classList.add("detail-view");
  clearInterval(heroTimer);
  document.querySelector(".topbar").style.display = "none";
  renderMovieDetail(movie);
  if (historyMode !== "none") {
    setRoute({ section: "movies", movieId: movie.id }, historyMode);
  }
  drawIcons();
}

function formatDuration(ms) {
  if (!ms || ms <= 0) return "";
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function formatAudioChannels(n) {
  if (!n || n <= 0) return "";
  if (n === 1) return "Mono";
  if (n === 2) return "Stereo";
  return `${n - 1}.1`;
}

function renderMovieDetail(movie) {
  const content = document.getElementById("content");

  const metaParts = [];
  if (movie.year) metaParts.push(String(movie.year));
  if (movie.content_rating) metaParts.push(escapeHtml(movie.content_rating));
  if (movie.duration) metaParts.push(formatDuration(movie.duration));
  if (movie.studio) metaParts.push(escapeHtml(movie.studio));
  const metaLine = metaParts.join(' <span class="sep">&middot;</span> ');

  let ratingsHtml = "";
  if (movie.rating || movie.audience_rating) {
    const parts = [];
    if (movie.rating) {
      parts.push(`<div class="movie-detail-rating"><span class="movie-detail-rating-value">${escapeHtml(movie.rating)}</span><span class="movie-detail-rating-label">Critic</span></div>`);
    }
    if (movie.audience_rating) {
      parts.push(`<div class="movie-detail-rating"><span class="movie-detail-rating-value">${escapeHtml(movie.audience_rating)}</span><span class="movie-detail-rating-label">Audience</span></div>`);
    }
    ratingsHtml = `<div class="movie-detail-ratings">${parts.join("")}</div>`;
  }

  let genresHtml = "";
  if (movie.genres && movie.genres.length) {
    genresHtml = `<div class="movie-detail-genres">${movie.genres.map((g) => `<span class="movie-detail-genre">${escapeHtml(g)}</span>`).join("")}</div>`;
  }

  let summaryHtml = "";
  if (movie.summary) {
    summaryHtml = `<p class="movie-detail-summary">${escapeHtml(movie.summary)}</p>`;
  }

  let creditsHtml = "";
  const creditLines = [];
  if (movie.directors && movie.directors.length) {
    creditLines.push(`<div><span class="credit-label">Director </span><span class="credit-value">${movie.directors.map(escapeHtml).join(", ")}</span></div>`);
  }
  if (movie.actors && movie.actors.length) {
    creditLines.push(`<div><span class="credit-label">Cast </span><span class="credit-value">${movie.actors.map(escapeHtml).join(", ")}</span></div>`);
  }
  if (creditLines.length) {
    creditsHtml = `<div class="movie-detail-credits">${creditLines.join("")}</div>`;
  }

  let mediaBadgesHtml = "";
  const badges = [];
  if (movie.video_resolution) badges.push(movie.video_resolution.toUpperCase());
  if (movie.audio_codec) badges.push(movie.audio_codec.toUpperCase());
  const channels = formatAudioChannels(movie.audio_channels);
  if (channels) badges.push(channels);
  if (badges.length) {
    mediaBadgesHtml = `<div class="movie-detail-media-info">${badges.map((b) => `<span class="movie-detail-media-badge">${escapeHtml(b)}</span>`).join("")}</div>`;
  }

  const isWatchedOrProgress = movie.watched || movie.view_offset;
  content.innerHTML = `
    <article class="movie-detail-card"${movie.art_url ? ` style="--bg-art: url(${escapeHtml(movie.art_url)})"` : ""}>
      <div class="movie-detail-backdrop"></div>
      <div class="movie-detail-topbar">
        <button class="btn btn-secondary movie-detail-back" id="movie-detail-back">
          <i data-lucide="arrow-left"></i>
          Back to Movies
        </button>
        <div class="overflow-menu">
          <button class="overflow-menu-trigger" aria-label="More options">
            <i data-lucide="ellipsis-vertical"></i>
          </button>
          <div class="overflow-menu-dropdown">
            <button class="overflow-menu-item" data-toggle-watched data-rating-key="${escapeHtml(movie.id)}" data-mark-watched="${isWatchedOrProgress ? "false" : "true"}">
              <i data-lucide="${isWatchedOrProgress ? "eye-off" : "eye"}"></i>
              ${isWatchedOrProgress ? "Mark Unwatched" : "Mark Watched"}
            </button>
            <button class="overflow-menu-item danger" data-delete-media data-media-type="movie" data-rating-key="${escapeHtml(movie.id)}" data-media-title="${escapeHtml(movie.title)}">
              <i data-lucide="trash-2"></i>
              Delete Movie
            </button>
          </div>
        </div>
      </div>
      <div class="movie-detail-layout">
        <div class="movie-detail-cover">
            ${renderCover(movie.cover_url, movie.title)}
            ${progressBar(movie.view_offset, movie.duration)}
          </div>
        <div class="movie-detail-body">
          <div class="eyebrow">${movie.directors?.length ? `A ${escapeHtml(movie.directors[0])} film` : "FROM YOUR COLLECTION"}</div><h1 class="movie-detail-title">${escapeHtml(movie.title)}</h1>
          ${movie.tagline ? `<p class="movie-detail-tagline">${escapeHtml(movie.tagline)}</p>` : ""}
          <div class="movie-detail-meta-line">
            ${metaLine}
            ${metaLine ? '<span class="sep">&middot;</span>' : ""}
            <span class="badge ${movie.watched ? "watched" : movie.view_offset ? "in-progress" : "unwatched"}">
              ${movie.watched ? "Watched" : movie.view_offset ? "In Progress" : "Unwatched"}
            </span>
          </div>
          ${ratingsHtml}
          ${genresHtml}
          ${summaryHtml}
          ${creditsHtml}
          ${mediaBadgesHtml}
          <div class="movie-detail-actions">
            <button class="movie-play-btn" data-play-type="movie" data-play-id="${escapeHtml(movie.id)}">
              <span class="movie-play-icon"><i data-lucide="play"></i></span>
              <span class="movie-play-label">${movie.view_offset && !movie.watched ? "Resume Movie" : "Play Movie"}</span>
            </button>
          </div>
        </div>
      </div>
    </article>
  `;

  document.getElementById("movie-detail-back").addEventListener("click", () => {
    state.selectedMovieId = null;
    document.body.classList.remove("detail-view");
    document.querySelector(".topbar").style.display = "";
    setHeader(sectionMeta.movies.title, sectionMeta.movies.description);
    renderMovies();
    setRoute({ section: "movies" }, "push");
    drawIcons();
  });

  wirePlayButtons(content);
  wireOverflowMenus(content, {
    onUpdate: () => openMovieDetail(movie.id, { historyMode: "replace" }),
    onDelete: async () => {
      state.selectedMovieId = null;
      await loadMovies();
      document.querySelector(".topbar").style.display = "";
      setHeader(sectionMeta.movies.title, sectionMeta.movies.description);
      renderMovies();
      setRoute({ section: "movies" }, "replace");
      drawIcons();
    },
  });
}

function renderTV() {
  const content = document.getElementById("content");

  if (!state.shows.length) {
    content.innerHTML = `<div class="empty-state">No TV shows found.</div>`;
    return;
  }

  const currentSeason = state.seasons.find((s) => s.id === state.selectedSeasonId);

  content.innerHTML = `
    <div class="tv-layout">
      <section>
        <div class="section-label">Shows</div>
        <div class="show-list">
          ${state.shows
            .map((show) => {
              const pct = show.total_episodes > 0 ? Math.min(100, Math.round((show.watched_count / show.total_episodes) * 100)) : 0;
              const isComplete = pct === 100;
              return `
              <div tabindex="0" role="button" aria-label="${escapeHtml(show.title)}" class="show-item ${show.id === state.selectedShowId ? "active" : ""}" data-show-id="${escapeHtml(show.id)}">
                <div class="show-item-cover">
                  ${renderCover(show.cover_url, show.title)}
                </div>
                <div class="show-item-info">
                  <div class="show-item-title">${escapeHtml(show.title)}</div>
                  <div class="show-item-meta">
                    ${show.watched_count}/${show.total_episodes} episodes
                    ${show.next_up ? ` · ${escapeHtml(show.next_up)}` : " · All caught up"}
                  </div>
                  <div class="progress-bar">
                    <div class="progress-fill ${isComplete ? "complete" : ""}" style="width:${pct}%"></div>
                  </div>
                </div>
                <div class="show-item-chevron"><i data-lucide="chevron-right"></i></div>
              </div>
            `;
            })
            .join("")}
        </div>
      </section>

      <section class="tv-right"${state.selectedShowArtUrl ? ` style="--bg-art: url(${escapeHtml(state.selectedShowArtUrl)})"` : ""}>
        <div class="tv-right-backdrop"></div>
        <div>
          <div class="tv-show-header">
            <div class="section-label">${escapeHtml(state.selectedShowTitle || "Seasons")}</div>
            <div class="overflow-menu">
              <button class="overflow-menu-trigger" aria-label="More options">
                <i data-lucide="ellipsis-vertical"></i>
              </button>
              <div class="overflow-menu-dropdown">
                <button class="overflow-menu-item danger" data-delete-media data-media-type="show" data-rating-key="${escapeHtml(state.selectedShowId)}" data-media-title="${escapeHtml(state.selectedShowTitle || "")}">
                  <i data-lucide="trash-2"></i>
                  Delete Show
                </button>
              </div>
            </div>
          </div>
          ${state.selectedShowSummary ? `<p class="tv-show-summary">${escapeHtml(state.selectedShowSummary)}</p>` : ""}
          <div class="season-tabs">
            ${state.seasons
              .map(
                (season) => `
              <button class="season-tab ${season.id === state.selectedSeasonId ? "active" : ""}" data-season-id="${escapeHtml(season.id)}">
                S${season.season_number}
                <span style="opacity:0.5;margin-left:2px">${season.watched_count}/${season.total_episodes}</span>
              </button>
            `,
              )
              .join("")}
          </div>
        </div>

        <div>
          <div class="section-label">
            Episodes${currentSeason ? ` · Season ${currentSeason.season_number}` : ""}
          </div>
          <div class="episode-list">
            ${state.episodes
              .map(
                (episode) => `
              <div class="episode-item-wrapper ${state.highlightedEpisodeId === episode.id ? "episode-highlight" : ""}" data-episode-id="${escapeHtml(episode.id)}">
                <div class="episode-still" style="--hue:${posterHue(state.selectedShowTitle)}">
                  ${episode.cover_url ? renderCover(episode.cover_url, episode.title) : ''}
                  <span class="episode-num">${String(episode.episode_number).padStart(2, '0')}</span>
                  ${episode.is_next_up ? '<span class="badge next">NEXT UP</span>' : episode.watched ? '<span class="badge watched">WATCHED</span>' : ''}
                  <button class="play-btn" data-episode-play-id="${escapeHtml(episode.id)}" aria-label="Play ${escapeHtml(episode.title)}"><i data-lucide="play"></i></button>
                  ${progressBar(episode.view_offset, episode.duration)}
                </div>
                <div class="episode-item" data-episode-toggle tabindex="0" role="button" aria-expanded="false">
                  <span class="episode-title">${escapeHtml(episode.title)}</span>
                  <span class="mono">${formatDuration(episode.duration)}</span>
                  <div class="overflow-menu">
                    <button class="overflow-menu-trigger" aria-label="Options for ${escapeHtml(episode.title)}"><i data-lucide="ellipsis-vertical"></i></button>
                    <div class="overflow-menu-dropdown">
                      <button class="overflow-menu-item" data-toggle-watched data-rating-key="${escapeHtml(episode.id)}" data-mark-watched="${episode.watched || episode.view_offset ? 'false' : 'true'}">
                        <i data-lucide="${episode.watched || episode.view_offset ? 'eye-off' : 'eye'}"></i>${episode.watched || episode.view_offset ? 'Mark Unwatched' : 'Mark Watched'}
                      </button>
                    </div>
                  </div>
                </div>
                ${episode.summary ? `<div class="episode-summary">${escapeHtml(episode.summary)}</div>` : ""}
              </div>
            `,
              )
              .join("")}
          </div>
        </div>
      </section>
    </div>
  `;

  content.querySelectorAll("[data-show-id]").forEach((node) => {
    node.addEventListener("click", async () => {
      const showId = node.getAttribute("data-show-id");
      if (!showId || showId === state.selectedShowId) {
        return;
      }
      await selectShow(showId);
      renderTV();
      drawIcons();
      if (state.selectedShowId && state.selectedSeasonId) {
        setRoute({ section: "tv", showId: state.selectedShowId, seasonId: state.selectedSeasonId }, "push");
      } else if (state.selectedShowId) {
        setRoute({ section: "tv", showId: state.selectedShowId }, "push");
      }
    });
  });

  content.querySelectorAll("[data-season-id]").forEach((node) => {
    node.addEventListener("click", async () => {
      const seasonId = node.getAttribute("data-season-id");
      if (!seasonId || seasonId === state.selectedSeasonId) {
        return;
      }
      await selectSeason(seasonId);
      if (state.selectedShowId && state.selectedSeasonId) {
        setRoute({ section: "tv", showId: state.selectedShowId, seasonId: state.selectedSeasonId }, "push");
      }
    });
  });

  wirePlayButtons(content);
  wireEpisodePlayButtons(content);
  wireOverflowMenus(content, {
    onUpdate: async () => {
      await selectSeason(state.selectedSeasonId);
      renderTV();
      drawIcons();
    },
    onDelete: async ({ mediaType }) => {
      if (mediaType !== "show") {
        return;
      }
      state.seasonEpisodeCache = {};
      await loadTVShows();
      renderTV();
      drawIcons();
      if (state.selectedShowId && state.selectedSeasonId) {
        setRoute({ section: "tv", showId: state.selectedShowId, seasonId: state.selectedSeasonId }, "replace");
      } else if (state.selectedShowId) {
        setRoute({ section: "tv", showId: state.selectedShowId }, "replace");
      } else {
        setRoute({ section: "tv" }, "replace");
      }
    },
  });

  content.querySelectorAll("[data-episode-toggle]").forEach((row) => {
    row.addEventListener("click", (e) => {
      if (e.target.closest(".play-btn, .overflow-menu")) return;
      const wrapper = row.closest(".episode-item-wrapper");
      if (wrapper) { wrapper.classList.toggle("expanded"); row.setAttribute("aria-expanded", String(wrapper.classList.contains("expanded"))); }
    });
  });

  if (state.highlightedEpisodeId) {
    const target = Array.from(content.querySelectorAll("[data-episode-id]")).find(
      (node) => node.getAttribute("data-episode-id") === state.highlightedEpisodeId,
    );
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    state.highlightedEpisodeId = null;
  }
}

function renderSettings() {
  const content = document.getElementById("content");
  const getConfig = (key) => state.config.find((c) => c.key === key)?.value ?? "";

  const hasToken = getConfig("plex.token") !== "";

  content.innerHTML = `
    <div class="settings-form">
      <div class="form-group">
        <label class="form-label" for="plex-url">Plex Server URL</label>
        <input class="form-input" id="plex-url" type="url" placeholder="http://192.168.1.100:32400" value="${escapeHtml(getConfig("plex.base_url"))}" />
        <span class="form-help">The address of your Plex Media Server, including port.</span>
      </div>

      <div class="form-group">
        <label class="form-label">Plex Account</label>
        <div class="auth-actions">
          ${
            hasToken
              ? `<span class="auth-status"><span class="auth-status-dot"></span>Token saved</span>
                 <button class="btn btn-secondary" id="plex-auth-btn">Re-authenticate</button>`
              : `<button class="btn btn-primary" id="plex-auth-btn">Sign in with Plex</button>`
          }
        </div>
        <span class="form-help">Authenticate with your Plex account to connect your library.</span>
      </div>

      <div class="form-group">
        <label class="form-label" for="plex-token">Plex token</label>
        <input class="form-input" id="plex-token" type="password" autocomplete="off" value="${escapeHtml(getConfig('plex.token'))}" />
        <span class="form-help">Sign in above, or enter an existing server token.</span>
      </div>
      <div class="form-group">
        <label class="form-label" for="player-default">Open videos with</label>
        <select class="form-input" id="player-default"><option value="iina" ${getConfig('player.default') === 'iina' ? 'selected' : ''}>IINA</option><option value="vlc" ${getConfig('player.default') === 'vlc' ? 'selected' : ''}>VLC</option></select>
      </div>
      <div class="form-actions">
        <button class="btn btn-primary" id="settings-save">Save</button>
        <button class="btn btn-secondary" id="settings-test">Test Connection</button>
      </div>

      <div id="settings-status"></div>
    </div>
  `;

  document.getElementById("plex-auth-btn").addEventListener("click", startPlexAuth);

  document.getElementById("settings-save").addEventListener("click", async () => {
    const statusEl = document.getElementById("settings-status");
    const baseUrl = document.getElementById("plex-url").value.trim();

    const updates = [];
    for (const [key, id] of [['plex.token','plex-token'], ['player.default','player-default']]) {
      const value = document.getElementById(id).value.trim();
      if (value !== getConfig(key)) updates.push({key,value});
    }
    if (baseUrl !== getConfig("plex.base_url")) {
      updates.push({ key: "plex.base_url", value: baseUrl });
    }

    if (!updates.length) {
      statusEl.className = "settings-status";
      statusEl.textContent = "No changes to save.";
      return;
    }

    try {
      for (const entry of updates) {
        await putJSON("/api/config", entry);
      }
      await loadConfig();
      statusEl.className = "settings-status success";
      clearLibraryData();
      statusEl.textContent = "Settings saved.";
    } catch (err) {
      statusEl.className = "settings-status error";
      statusEl.textContent = err.message;
    }
  });

  document.getElementById("settings-test").addEventListener("click", async () => {
    const statusEl = document.getElementById("settings-status");
    const baseUrl = document.getElementById("plex-url").value.trim();
    const token = document.getElementById("plex-token").value.trim();

    statusEl.className = "settings-status";
    statusEl.textContent = "Testing connection...";

    try {
      const result = await postJSON("/api/plex/test", { base_url: baseUrl, token });
      if (result.ok) {
        statusEl.className = "settings-status success";
        statusEl.textContent = `Connected to "${result.server_name}"`;
      } else {
        statusEl.className = "settings-status error";
        statusEl.textContent = result.error;
      }
    } catch (err) {
      statusEl.className = "settings-status error";
      statusEl.textContent = err.message;
    }
  });
}

async function startPlexAuth() {
  authController?.abort();
  const controller = new AbortController();
  authController = controller;
  const statusEl = document.getElementById("settings-status");
  const button = document.getElementById("plex-auth-btn");
  button.disabled = true;
  statusEl.className = "settings-status";
  statusEl.textContent = "Starting Plex authentication...";

  const popup = window.open("about:blank", "plexAuth", "width=800,height=700");
  let pollTimer;
  const timeout = setTimeout(() => {
    statusEl.className = "settings-status error";
    statusEl.textContent = "Authentication timed out. Please try again.";
    controller.abort();
  }, 5 * 60 * 1000);
  controller.signal.addEventListener('abort', () => {
    clearTimeout(pollTimer);
    clearTimeout(timeout);
    button.disabled = false;
    if (popup && !popup.closed) popup.close();
  });
  let pin;
  try {
    pin = await postJSON("/api/plex/auth/start", {});
    if (controller.signal.aborted) return;
  } catch (err) {
    if (controller.signal.aborted) return;
    statusEl.className = "settings-status error";
    statusEl.textContent = err.message;
    controller.abort();
    return;
  }

  if (popup) popup.location.href = pin.auth_url;
  statusEl.className = "settings-status";
  statusEl.innerHTML = `Waiting for Plex authentication… <a href="${escapeHtml(pin.auth_url)}" target="_blank" rel="noopener">Open Plex sign-in</a>`;

  const poll = async () => {
    try {
      const response = await fetch(`/api/plex/auth/poll/${pin.pin_id}?code=${encodeURIComponent(pin.code)}`, { signal: controller.signal });
      if (!response.ok) throw new Error('Plex authentication is not ready');
      const result = await response.json();
      if (result.done) {
        const draftUrl = document.getElementById('plex-url').value;
        const draftPlayer = document.getElementById('player-default').value;
        await loadConfig();
        if (controller.signal.aborted) return;
        clearLibraryData();
        controller.abort();
        renderSettings();
        document.getElementById('plex-url').value = draftUrl;
        document.getElementById('player-default').value = draftPlayer;
        const success = document.getElementById('settings-status');
        success.className = 'settings-status success';
        success.textContent = 'Authenticated successfully. Save any server address changes, then test the connection.';
        drawIcons();
        return;
      }
    } catch {
      // Ignore transient errors and keep polling.
    }
    if (!controller.signal.aborted) pollTimer = setTimeout(poll, 3000);
  };
  pollTimer = setTimeout(poll, 3000);
}

// ---- Utilities ----

async function fetchJSON(path, signal = navigationController?.signal) {
  const response = await fetch(path, { headers: { Accept: "application/json" }, signal });
  if (!response.ok) {
    const payload = await safeJSON(response);
    throw new Error(payload?.error || `Request failed: ${response.status}`);
  }
  return response.json();
}

async function safeJSON(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function renderCover(url, alt) {
  if (!url) return '<div class="cover-fallback" style="--hue:'+posterHue(alt)+'"><span class="poster-imprint">THE PLI COLLECTION</span><span class="poster-type">'+escapeHtml(alt)+'</span><span class="poster-bottom">A WORLD WORTH WATCHING</span></div>';
  return '<img class="cover-image" src="'+escapeHtml(url)+'" alt="'+escapeHtml(alt)+'" loading="lazy">';
}

function drawIcons() {
  if (window.lucide && typeof window.lucide.createIcons === "function") {
    window.lucide.createIcons();
  }
}

function progressBar(viewOffset, duration) {
  if (!viewOffset || !duration || duration <= 0) return "";
  const pct = Math.min(100, Math.round((viewOffset / duration) * 100));
  if (pct <= 0) return "";
  return `<div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>`;
}

function progressRing(viewOffset, duration) {
  if (!viewOffset || !duration || duration <= 0) return "";
  const pct = Math.min(1, viewOffset / duration);
  if (pct <= 0) return "";
  const r = 6;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - pct);
  return `<svg class="progress-ring" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="${r}" fill="none" stroke="hsl(0 0% 100% / 0.1)" stroke-width="2"/><circle cx="8" cy="8" r="${r}" fill="none" stroke="hsl(var(--primary))" stroke-width="2" stroke-dasharray="${circ}" stroke-dashoffset="${offset}" stroke-linecap="round" transform="rotate(-90 8 8)"/></svg>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// ---- Playback ----

async function postJSON(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = await safeJSON(response);
    throw new Error(payload?.error || `Request failed: ${response.status}`);
  }
  return response.json();
}

async function putJSON(path, body) {
  const response = await fetch(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = await safeJSON(response);
    throw new Error(payload?.error || `Request failed: ${response.status}`);
  }
  return response.json();
}

async function deleteJSON(path) {
  const response = await fetch(path, {
    method: "DELETE",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    const payload = await safeJSON(response);
    throw new Error(payload?.error || `Request failed: ${response.status}`);
  }
  return response.json();
}

async function playItem(type, id) {
  try {
    const result = await postJSON("/api/play", { type, id: String(id) });
    if (result.stream_url) {
      const player = state.config.find(c => c.key === "player.default")?.value || "iina";
      window.location.href = playerURL(result, player, window.location.origin);
      notify(`Opening in ${player === "vlc" ? "VLC" : "IINA"}…`);
    }
    return result;
  } catch (err) {
    notify(err.message);
    return null;
  }
}

function wireEpisodePlayButtons(container) {
  container.querySelectorAll("[data-episode-play-id]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const episodeId = btn.getAttribute("data-episode-play-id");
      if (episodeId) {
        void playItem("episode", episodeId);
      }
    });
  });
}

function wireOverflowMenus(container, handlers = {}) {
  const onUpdate = typeof handlers === "function" ? handlers : handlers.onUpdate;
  const onDelete = typeof handlers === "function" ? null : handlers.onDelete;

  container.querySelectorAll(".overflow-menu").forEach((menu) => {
    const trigger = menu.querySelector(".overflow-menu-trigger");
    const dropdown = menu.querySelector(".overflow-menu-dropdown");
    if (!trigger || !dropdown) return;

    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      // Close any other open menus
      document.querySelectorAll(".overflow-menu-dropdown.open").forEach((d) => {
        if (d !== dropdown) d.classList.remove("open");
      });
      dropdown.classList.toggle("open");
    });

    menu.querySelectorAll("[data-toggle-watched]").forEach((item) => {
      item.addEventListener("click", async (e) => {
        e.stopPropagation();
        const ratingKey = item.getAttribute("data-rating-key");
        const markWatched = item.getAttribute("data-mark-watched") === "true";
        dropdown.classList.remove("open");
        try {
          await postJSON("/api/watched", { rating_key: ratingKey, watched: markWatched });
          state.searchEpisodesLoaded = false;
          state.seasonEpisodeCache = {};
          if (onUpdate) await onUpdate();
        } catch (err) {
          notify(err.message);
        }
      });
    });

    menu.querySelectorAll("[data-delete-media]").forEach((item) => {
      item.addEventListener("click", async (e) => {
        e.stopPropagation();
        const ratingKey = item.getAttribute("data-rating-key");
        const mediaType = item.getAttribute("data-media-type") || "item";
        const mediaTitle = item.getAttribute("data-media-title");
        dropdown.classList.remove("open");
        if (!ratingKey) {
          return;
        }

        const label = mediaType === "movie" ? "movie" : mediaType === "show" ? "TV show" : "item";
        const titleLabel = mediaTitle ? ` "${mediaTitle}"` : "";
        const confirmed = window.confirm(
          `Delete this ${label}${titleLabel} from your Plex library?\n\nThis cannot be undone.`,
        );
        if (!confirmed) {
          return;
        }

        try {
          await deleteJSON(`/api/media/${encodeURIComponent(ratingKey)}`);
          if (onDelete) {
            await onDelete({ mediaType, ratingKey });
          } else if (onUpdate) {
            await onUpdate();
          }
        } catch (err) {
          notify(err.message);
        }
      });
    });
  });

}

function wirePlayButtons(container) {
  container.querySelectorAll("[data-play-id]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const type = btn.getAttribute("data-play-type");
      const id = btn.getAttribute("data-play-id");
      if (type && id) {
        playItem(type, id);
      }
    });
  });
}

function notify(message) {
  const notification = document.getElementById('notification');
  notification.textContent = message;
  notification.hidden = false;
  clearTimeout(notificationTimer);
  notificationTimer = setTimeout(() => { notification.hidden = true; }, 5500);
}

function clearLibraryData() {
  episodeIndexController?.abort();
  episodeIndexController = null;
  state.searchEpisodesLoading = null;
  state.movies = [];
  state.shows = [];
  state.seasonEpisodeCache = {};
  state.searchEpisodes = [];
  state.searchEpisodesLoaded = false;
  state.selectedShowId = null;
  state.selectedSeasonId = null;
}

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    document.querySelectorAll('.overflow-menu-dropdown.open').forEach(menu => menu.classList.remove('open'));
    if (document.activeElement?.id === 'search-input') {
      document.activeElement.value = '';
      document.activeElement.dispatchEvent(new Event('input'));
    }
  }
  if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[role="button"][tabindex="0"]')) {
    event.preventDefault();
    event.target.click();
  }
});

document.addEventListener('error', event => {
  if (event.target.matches?.('img.cover-image')) {
    const title = event.target.alt;
    event.target.outerHTML = renderCover('', title);
  }
}, true);
