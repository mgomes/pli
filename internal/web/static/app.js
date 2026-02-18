const state = {
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
  tvAutoplayEnabled: readStoredFlag("pli.tv.autoplay", true),
  autoplayMonitor: null,
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
  await loadConfig();
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
  const { historyMode = "push" } = options;
  const section = route.section || "recently-added";

  document.querySelector(".topbar").style.display = "";
  state.section = section;
  state.searchQuery = "";
  stopAutoplayMonitor();
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
      openMovieDetail(route.movieId, { historyMode: "none" });
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
  document.getElementById("sidebar").querySelectorAll(".nav-item[data-section]").forEach((button) => {
    button.addEventListener("click", async () => {
      const section = button.dataset.section;
      if (!section) return;
      if (section === state.section && !state.selectedMovieId && !state.selectedShowId) return;
      await navigateToRoute({ section }, { historyMode: "push" });
    });
  });
}

function setActiveButton(section) {
  document.getElementById("sidebar").querySelectorAll(".nav-item[data-section]").forEach((button) => {
    button.classList.toggle("active", button.dataset.section === section);
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
  try {
    const response = await fetchJSON("/api/continue-watching");
    state.continueWatching = response.items ?? [];
  } catch {
    state.continueWatching = [];
  }
}

async function loadMovies() {
  const response = await fetchJSON("/api/movies");
  state.movies = response.movies ?? [];
}

async function loadTVShows() {
  const response = await fetchJSON("/api/tv/shows");
  state.shows = response.shows ?? [];

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

async function fetchSeasonEpisodes(showId, seasonId) {
  const key = seasonCacheKey(showId, seasonId);
  if (state.seasonEpisodeCache[key]) {
    return state.seasonEpisodeCache[key];
  }
  const response = await fetchJSON(
    `/api/tv/seasons/${encodeURIComponent(seasonId)}/episodes?show_id=${encodeURIComponent(showId)}`,
  );
  const episodes = response.episodes ?? [];
  state.seasonEpisodeCache[key] = episodes;
  return episodes;
}

// ---- Search ----

function wireSearch() {
  const input = document.getElementById("search-input");
  if (!input) return;

  let debounceTimer;
  input.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      const query = input.value.trim();
      if (query.length < 2) {
        if (state.searchQuery) {
          state.searchQuery = "";
          await navigateToRoute({ section: state.section }, { historyMode: "replace" });
        }
        return;
      }
      state.searchQuery = query;
      await ensureSearchData();
      const results = performSearch(query);
      renderSearchResults(results);
      drawIcons();

      if (!state.searchEpisodesLoaded && !state.searchEpisodesLoading) {
        void buildEpisodeSearchIndex().then(() => {
          if (state.searchQuery !== query) return;
          renderSearchResults(performSearch(query));
          drawIcons();
        });
      }
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

  state.searchEpisodesLoading = (async () => {
    await ensureSearchData();
    const episodes = [];
    const concurrency = 4;

    for (let i = 0; i < state.shows.length; i += concurrency) {
      const batch = state.shows.slice(i, i + concurrency);
      const batchResults = await Promise.allSettled(
        batch.map(async (show) => {
          let seasons = [];
          try {
            const seasonsResponse = await fetchJSON(`/api/tv/shows/${encodeURIComponent(show.id)}/seasons`);
            seasons = seasonsResponse.seasons ?? [];
          } catch {
            return [];
          }

          const showEpisodes = [];
          for (const season of seasons) {
            let seasonEpisodes = [];
            try {
              seasonEpisodes = await fetchSeasonEpisodes(show.id, season.id);
            } catch {
              continue;
            }

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

      for (const result of batchResults) {
        if (result.status === "fulfilled" && result.value.length) {
          episodes.push(...result.value);
        }
      }
    }

    state.searchEpisodes = episodes;
    state.searchEpisodesLoaded = true;
  })();

  try {
    await state.searchEpisodesLoading;
  } finally {
    state.searchEpisodesLoading = null;
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
    (movie) => `${movie.title} ${movie.year || ""} ${(movie.genres || []).join(" ")}`,
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

  content.querySelectorAll("[data-search-show-id]").forEach((node) => {
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
  const content = document.getElementById("content");
  if (!state.recent.length && !state.continueWatching.length) {
    content.innerHTML = `<div class="empty-state">No recent additions yet.</div>`;
    return;
  }

  let cwHtml = "";
  if (state.continueWatching.length) {
    cwHtml = `
      <div class="section-label">Continue Watching</div>
      <div class="cw-row">
        ${state.continueWatching
          .map(
            (item) => `
          <div class="cw-card" data-resume-type="${escapeHtml(item.type)}" data-resume-id="${escapeHtml(item.id)}" title="Resume">
            <div class="cw-card-cover">
              ${renderCover(item.cover_url, item.title)}
              <button class="play-btn cover-play" data-play-type="${escapeHtml(item.type)}" data-play-id="${escapeHtml(item.id)}" title="Play">
                <i data-lucide="play"></i>
              </button>
              ${progressBar(item.view_offset, item.duration)}
            </div>
            <div class="cw-card-title">${escapeHtml(item.title)}</div>
            ${item.subtitle ? `<div class="cw-card-sub">${escapeHtml(item.subtitle)}</div>` : ""}
          </div>
        `,
          )
          .join("")}
      </div>
    `;
  }

  content.innerHTML = `
    ${cwHtml}
    ${state.recent.length ? `<div class="section-label">Recently Added</div>` : ""}
    <div class="media-grid">
      ${state.recent
        .map(
          (item) => `
        <article
          class="media-card ${item.type === "movie" ? "clickable" : ""}"
          ${item.type === "movie" ? `data-open-movie-id="${escapeHtml(item.id)}"` : ""}
        >
          <div class="media-card-cover">
            ${renderCover(item.cover_url, item.headline)}
          </div>
          <div class="media-card-accent ${escapeHtml(item.type)}"></div>
          <div class="media-card-body">
            <div class="media-card-info">
              <div class="media-card-title">${escapeHtml(item.headline)}</div>
              ${item.subline ? `<div class="media-card-sub">${escapeHtml(item.subline)}</div>` : ""}
            </div>
            <div style="display:flex;align-items:center;gap:0.5rem">
              <button class="play-btn" data-play-type="${escapeHtml(item.type)}" data-play-id="${escapeHtml(item.id)}" title="Play">
                <i data-lucide="play"></i>
              </button>
              <span class="badge ${escapeHtml(item.type)}">${escapeHtml(item.type)}</span>
            </div>
          </div>
        </article>
      `,
        )
        .join("")}
    </div>
  `;
  wirePlayButtons(content);
  content.querySelectorAll("[data-resume-id]").forEach((card) => {
    card.addEventListener("click", (e) => {
      if (e.target.closest(".play-btn")) return;
      const type = card.getAttribute("data-resume-type");
      const id = card.getAttribute("data-resume-id");
      if (type && id) {
        void playItem(type, id);
      }
    });
  });
  content.querySelectorAll("[data-open-movie-id]").forEach((node) => {
    node.addEventListener("click", () => {
      const movieID = node.getAttribute("data-open-movie-id");
      if (!movieID) {
        return;
      }
      void navigateToRoute({ section: "movies", movieId: movieID }, { historyMode: "push" });
    });
  });
}

function movieCardHtml(movie) {
  return `
    <article class="movie-card" data-movie-id="${escapeHtml(movie.id)}">
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
        <select class="toolbar-select" id="movie-sort">
          <option value="title-asc"${state.movieSort === "title-asc" ? " selected" : ""}>Title A–Z</option>
          <option value="title-desc"${state.movieSort === "title-desc" ? " selected" : ""}>Title Z–A</option>
          <option value="year-desc"${state.movieSort === "year-desc" ? " selected" : ""}>Newest</option>
          <option value="year-asc"${state.movieSort === "year-asc" ? " selected" : ""}>Oldest</option>
          <option value="rating-desc"${state.movieSort === "rating-desc" ? " selected" : ""}>Top Rated</option>
          <option value="added-desc"${state.movieSort === "added-desc" ? " selected" : ""}>Recently Added</option>
        </select>
        <select class="toolbar-select" id="movie-genre">
          <option value="">All Genres</option>
          ${genres.map((g) => `<option value="${escapeHtml(g)}"${state.movieFilterGenre === g ? " selected" : ""}>${escapeHtml(g)}</option>`).join("")}
        </select>
        <select class="toolbar-select" id="movie-runtime">
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
        return `<button class="az-letter ${active ? "" : "disabled"}" ${active ? `data-az-jump="${l}"` : ""}>${l}</button>`;
      })
      .join("");

    for (const letter of allLetters) {
      const movies = groups.get(letter);
      if (!movies) continue;
      gridHtml += `<div class="movie-grid-letter" id="az-${letter}">${letter}</div>`;
      gridHtml += movies.map(movieCardHtml).join("");
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
          </div>
        </div>
      </div>
      <div class="movie-detail-layout">
        <div class="movie-detail-cover">
            ${renderCover(movie.cover_url, movie.title)}
            ${progressBar(movie.view_offset, movie.duration)}
          </div>
        <div class="movie-detail-body">
          <h2 class="movie-detail-title">${escapeHtml(movie.title)}</h2>
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
              <span class="movie-play-label">Play Movie</span>
            </button>
          </div>
        </div>
      </div>
    </article>
  `;

  document.getElementById("movie-detail-back").addEventListener("click", () => {
    state.selectedMovieId = null;
    document.querySelector(".topbar").style.display = "";
    setHeader(sectionMeta.movies.title, sectionMeta.movies.description);
    renderMovies();
    setRoute({ section: "movies" }, "push");
    drawIcons();
  });

  wirePlayButtons(content);
  wireOverflowMenus(content, () => openMovieDetail(movie.id, { historyMode: "replace" }));
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
              const pct = show.total_episodes > 0 ? Math.round((show.watched_count / show.total_episodes) * 100) : 0;
              const isComplete = pct === 100;
              return `
              <div class="show-item ${show.id === state.selectedShowId ? "active" : ""}" data-show-id="${escapeHtml(show.id)}">
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
          <div class="section-label">${escapeHtml(state.selectedShowTitle || "Seasons")}</div>
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
          <label class="switch-control">
            <input type="checkbox" id="tv-autoplay-toggle"${state.tvAutoplayEnabled ? " checked" : ""} />
            <span>Autoplay Up Next</span>
          </label>
          <div class="episode-list">
            ${state.episodes
              .map(
                (episode) => `
              <div class="episode-item-wrapper ${state.highlightedEpisodeId === episode.id ? "episode-highlight" : ""}" data-episode-id="${escapeHtml(episode.id)}">
                <div class="episode-item" data-episode-toggle>
                  <span class="episode-num">E${String(episode.episode_number).padStart(2, "0")}</span>
                  ${progressRing(episode.view_offset, episode.duration)}
                  <span class="episode-title">${escapeHtml(episode.title)}</span>
                  <div class="episode-badges">
                    ${episode.is_next_up ? '<span class="badge next">Next Up</span>' : ""}
                    <span class="badge ${episode.watched ? "watched" : episode.view_offset ? "in-progress" : "unwatched"}">
                      ${episode.watched ? "Watched" : episode.view_offset ? "In Progress" : "Unwatched"}
                    </span>
                    <button
                      class="play-btn"
                      data-episode-play-id="${escapeHtml(episode.id)}"
                      data-episode-play-show-id="${escapeHtml(state.selectedShowId)}"
                      data-episode-play-season-id="${escapeHtml(state.selectedSeasonId)}"
                      title="Play"
                    >
                      <i data-lucide="play"></i>
                    </button>
                    <div class="overflow-menu">
                      <button class="overflow-menu-trigger" aria-label="More options">
                        <i data-lucide="ellipsis-vertical"></i>
                      </button>
                      <div class="overflow-menu-dropdown">
                        <button class="overflow-menu-item" data-toggle-watched data-rating-key="${escapeHtml(episode.id)}" data-mark-watched="${episode.watched || episode.view_offset ? "false" : "true"}">
                          <i data-lucide="${episode.watched || episode.view_offset ? "eye-off" : "eye"}"></i>
                          ${episode.watched || episode.view_offset ? "Mark Unwatched" : "Mark Watched"}
                        </button>
                      </div>
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

  const autoplayToggle = content.querySelector("#tv-autoplay-toggle");
  if (autoplayToggle) {
    autoplayToggle.addEventListener("change", () => {
      setTVAutoplayEnabled(autoplayToggle.checked);
    });
  }

  wirePlayButtons(content);
  wireEpisodePlayButtons(content);
  wireOverflowMenus(content, async () => {
    await selectSeason(state.selectedSeasonId);
    renderTV();
    drawIcons();
  });

  content.querySelectorAll("[data-episode-toggle]").forEach((row) => {
    row.addEventListener("click", (e) => {
      if (e.target.closest(".play-btn, .overflow-menu")) return;
      const wrapper = row.closest(".episode-item-wrapper");
      if (wrapper) wrapper.classList.toggle("expanded");
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
              ? `<span class="auth-status"><span class="auth-status-dot"></span>Authenticated</span>
                 <button class="btn btn-secondary" id="plex-auth-btn">Re-authenticate</button>`
              : `<button class="btn btn-primary" id="plex-auth-btn">Sign in with Plex</button>`
          }
        </div>
        <span class="form-help">Authenticate with your Plex account to connect your library.</span>
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
      statusEl.textContent = "Settings saved.";
    } catch (err) {
      statusEl.className = "settings-status error";
      statusEl.textContent = err.message;
    }
  });

  document.getElementById("settings-test").addEventListener("click", async () => {
    const statusEl = document.getElementById("settings-status");
    const baseUrl = document.getElementById("plex-url").value.trim();
    const token = getConfig("plex.token");

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
  const statusEl = document.getElementById("settings-status");
  statusEl.className = "settings-status";
  statusEl.textContent = "Starting Plex authentication...";

  let pin;
  try {
    pin = await postJSON("/api/plex/auth/start", {});
  } catch (err) {
    statusEl.className = "settings-status error";
    statusEl.textContent = err.message;
    return;
  }

  const popup = window.open(pin.auth_url, "plexAuth", "width=800,height=700");

  statusEl.className = "settings-status";
  statusEl.textContent = "Waiting for Plex authentication...";

  const pollInterval = setInterval(async () => {
    try {
      const result = await fetchJSON(`/api/plex/auth/poll/${pin.pin_id}?code=${encodeURIComponent(pin.code)}`);
      if (result.done) {
        clearInterval(pollInterval);
        if (popup && !popup.closed) popup.close();
        await loadConfig();
        statusEl.className = "settings-status success";
        statusEl.textContent = "Authenticated successfully.";
        renderSettings();
        drawIcons();
      }
    } catch {
      // Ignore transient errors and keep polling.
    }
  }, 3000);

  // Stop polling after 5 minutes.
  setTimeout(() => {
    clearInterval(pollInterval);
    if (statusEl.textContent === "Waiting for Plex authentication...") {
      statusEl.className = "settings-status error";
      statusEl.textContent = "Authentication timed out.";
    }
  }, 5 * 60 * 1000);
}

// ---- Utilities ----

async function fetchJSON(path) {
  const response = await fetch(path, { headers: { Accept: "application/json" } });
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
  if (!url) {
    return `<div class="cover-fallback"><i data-lucide="image-off"></i></div>`;
  }
  return `<img class="cover-image" src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" loading="lazy" />`;
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

function readStoredFlag(key, fallback = false) {
  try {
    const value = localStorage.getItem(key);
    if (value === null) return fallback;
    return value === "1";
  } catch {
    return fallback;
  }
}

function setTVAutoplayEnabled(enabled) {
  state.tvAutoplayEnabled = Boolean(enabled);
  try {
    localStorage.setItem("pli.tv.autoplay", state.tvAutoplayEnabled ? "1" : "0");
  } catch {
    // Ignore localStorage errors (private mode, permissions).
  }
  if (!state.tvAutoplayEnabled) {
    stopAutoplayMonitor();
  }
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

async function playItem(type, id) {
  try {
    const result = await postJSON("/api/play", { type, id: String(id) });
    if (result.stream_url) {
      const streamUrl = new URL(result.stream_url);
      if (result.rating_key) {
        streamUrl.searchParams.set("X-Pli-Rating-Key", result.rating_key);
      }
      if (result.duration_ms) {
        streamUrl.searchParams.set("X-Pli-Duration", String(result.duration_ms));
      }
      streamUrl.searchParams.set("X-Pli-Start", String(result.view_offset_ms || 0));
      streamUrl.searchParams.set("X-Pli-Callback", window.location.origin + "/api/timeline");
      streamUrl.searchParams.set("X-Pli-Session", String(Date.now()));
      window.location.href = "iina://weblink?url=" + encodeURIComponent(streamUrl.toString());
    }
    return result;
  } catch (err) {
    console.error("play failed:", err.message);
    return null;
  }
}

function stopAutoplayMonitor() {
  if (!state.autoplayMonitor) return;
  if (state.autoplayMonitor.startTimerId) clearTimeout(state.autoplayMonitor.startTimerId);
  if (state.autoplayMonitor.pollTimerId) clearInterval(state.autoplayMonitor.pollTimerId);
  state.autoplayMonitor = null;
}

async function playEpisodeWithAutoplay(episodeId, showId, seasonId) {
  const result = await playItem("episode", episodeId);
  if (!result || !state.tvAutoplayEnabled) {
    stopAutoplayMonitor();
    return;
  }

  const nextEpisode = await resolveNextEpisode(showId, seasonId, episodeId);
  if (!nextEpisode) {
    stopAutoplayMonitor();
    return;
  }

  const durationMs = Number(result.duration_ms || 0);
  const startOffsetMs = Number(result.view_offset_ms || 0);
  const remainingMs = Math.max(0, durationMs - startOffsetMs);
  const startedAt = Date.now();
  const expectedEndMs = startedAt + (remainingMs || 30 * 60 * 1000);

  stopAutoplayMonitor();
  const monitor = {
    currentEpisodeId: String(episodeId),
    nextEpisodeId: String(nextEpisode.id),
    nextShowId: String(nextEpisode.showId),
    nextSeasonId: String(nextEpisode.seasonId),
    expectedEndMs,
    seenCurrentSession: false,
    polling: false,
    startTimerId: null,
    pollTimerId: null,
  };

  const startPollingDelay = Math.max(8000, Math.min(60000, Math.round((remainingMs || 0) * 0.6)));
  monitor.startTimerId = setTimeout(() => {
    void pollAutoplayMonitor(monitor);
    monitor.pollTimerId = setInterval(() => {
      void pollAutoplayMonitor(monitor);
    }, 6000);
  }, startPollingDelay);

  state.autoplayMonitor = monitor;
}

async function pollAutoplayMonitor(monitor) {
  if (!state.autoplayMonitor || state.autoplayMonitor !== monitor || monitor.polling) {
    return;
  }

  monitor.polling = true;
  try {
    const payload = await fetchJSON("/api/sessions");
    const sessions = payload.sessions ?? [];
    const hasCurrent = sessions.some((session) => String(session.rating_key) === monitor.currentEpisodeId);
    if (hasCurrent) {
      monitor.seenCurrentSession = true;
      return;
    }

    const now = Date.now();
    const hasReachedEnd = now >= monitor.expectedEndMs - 5000;
    const graceElapsed = now >= monitor.expectedEndMs + 30000;
    if (!hasReachedEnd && !graceElapsed) return;
    if (!monitor.seenCurrentSession && !graceElapsed) return;

    stopAutoplayMonitor();
    if (!state.tvAutoplayEnabled) return;
    await playEpisodeWithAutoplay(monitor.nextEpisodeId, monitor.nextShowId, monitor.nextSeasonId);
  } catch (err) {
    console.error("autoplay monitor failed:", err.message);
  } finally {
    monitor.polling = false;
  }
}

async function resolveNextEpisode(showId, seasonId, episodeId) {
  let seasonEpisodes = await fetchSeasonEpisodes(showId, seasonId);
  let idx = seasonEpisodes.findIndex((episode) => String(episode.id) === String(episodeId));
  if (idx >= 0 && idx < seasonEpisodes.length - 1) {
    return {
      id: seasonEpisodes[idx + 1].id,
      showId,
      seasonId,
    };
  }

  let seasons;
  if (state.selectedShowId === showId && state.seasons.length) {
    seasons = state.seasons;
  } else {
    try {
      const response = await fetchJSON(`/api/tv/shows/${encodeURIComponent(showId)}/seasons`);
      seasons = response.seasons ?? [];
    } catch {
      return null;
    }
  }

  const orderedSeasons = [...seasons].sort((a, b) => a.season_number - b.season_number);
  const seasonIndex = orderedSeasons.findIndex((season) => String(season.id) === String(seasonId));
  if (seasonIndex === -1) {
    return null;
  }

  for (let i = seasonIndex + 1; i < orderedSeasons.length; i += 1) {
    seasonEpisodes = await fetchSeasonEpisodes(showId, orderedSeasons[i].id);
    if (seasonEpisodes.length) {
      return {
        id: seasonEpisodes[0].id,
        showId,
        seasonId: orderedSeasons[i].id,
      };
    }
  }
  return null;
}

function wireEpisodePlayButtons(container) {
  container.querySelectorAll("[data-episode-play-id]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const episodeId = btn.getAttribute("data-episode-play-id");
      const showId = btn.getAttribute("data-episode-play-show-id");
      const seasonId = btn.getAttribute("data-episode-play-season-id");
      if (episodeId && showId && seasonId) {
        void playEpisodeWithAutoplay(episodeId, showId, seasonId);
      }
    });
  });
}

function wireOverflowMenus(container, onUpdate) {
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
          if (onUpdate) await onUpdate();
        } catch (err) {
          console.error("toggle watched failed:", err.message);
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
