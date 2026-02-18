const state = {
  section: "recently-added",
  config: [],
  recent: [],
  movies: [],
  selectedMovieId: null,
  shows: [],
  selectedShowId: null,
  selectedShowTitle: "",
  selectedShowSummary: "",
  selectedShowArtUrl: "",
  seasons: [],
  selectedSeasonId: null,
  episodes: [],
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
  await loadConfig();
  window.addEventListener("popstate", () => {
    void navigateToRoute(parseRoute(window.location.pathname), { historyMode: "none" });
  });
  document.addEventListener("click", () => {
    document.querySelectorAll(".overflow-menu-dropdown.open").forEach((d) => d.classList.remove("open"));
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
  const response = await fetchJSON("/api/recently-added");
  state.recent = response.items ?? [];
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
  if (rerender) {
    renderTV();
    drawIcons();
  }
}

// ---- Renderers ----

function renderRecentlyAdded() {
  const content = document.getElementById("content");
  if (!state.recent.length) {
    content.innerHTML = `<div class="empty-state">No recent additions yet.</div>`;
    return;
  }

  content.innerHTML = `
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

function renderMovies() {
  const content = document.getElementById("content");
  if (!state.movies.length) {
    content.innerHTML = `<div class="empty-state">No movies found.</div>`;
    return;
  }

  content.innerHTML = `
    <div class="movie-grid">
      ${state.movies
        .map(
          (movie) => `
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
      `,
        )
        .join("")}
    </div>
  `;
  wirePlayButtons(content);
  content.querySelectorAll("[data-movie-id]").forEach((node) => {
    node.addEventListener("click", () => {
      const movieID = node.getAttribute("data-movie-id");
      if (!movieID) {
        return;
      }
      openMovieDetail(movieID);
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
          <div class="episode-list">
            ${state.episodes
              .map(
                (episode) => `
              <div class="episode-item-wrapper">
                <div class="episode-item" data-episode-toggle>
                  <span class="episode-num">E${String(episode.episode_number).padStart(2, "0")}</span>
                  ${progressRing(episode.view_offset, episode.duration)}
                  <span class="episode-title">${escapeHtml(episode.title)}</span>
                  <div class="episode-badges">
                    ${episode.is_next_up ? '<span class="badge next">Next Up</span>' : ""}
                    <span class="badge ${episode.watched ? "watched" : episode.view_offset ? "in-progress" : "unwatched"}">
                      ${episode.watched ? "Watched" : episode.view_offset ? "In Progress" : "Unwatched"}
                    </span>
                    <button class="play-btn" data-play-type="episode" data-play-id="${escapeHtml(episode.id)}" title="Play">
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

  wirePlayButtons(content);
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
  } catch (err) {
    console.error("play failed:", err.message);
  }
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

