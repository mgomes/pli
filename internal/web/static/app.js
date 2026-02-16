const state = {
  section: "recently-added",
  config: [],
  recent: [],
  movies: [],
  shows: [],
  selectedShowId: null,
  selectedShowTitle: "",
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
};

window.addEventListener("DOMContentLoaded", async () => {
  wireSectionNav();
  await loadConfig();
  await switchSection("recently-added");
  startPlaybackPolling();
});

function wireSectionNav() {
  const nav = document.getElementById("section-nav");
  nav.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", async () => {
      const section = button.dataset.section;
      if (!section || section === state.section) {
        return;
      }
      await switchSection(section);
    });
  });
}

async function switchSection(section) {
  state.section = section;
  setActiveButton(section);
  setHeader(sectionMeta[section].title, sectionMeta[section].description);

  if (section === "recently-added") {
    await loadRecentlyAdded();
    renderRecentlyAdded();
  }

  if (section === "movies") {
    await loadMovies();
    renderMovies();
  }

  if (section === "tv") {
    await loadTVShows();
    renderTV();
  }

  drawIcons();
}

function setActiveButton(section) {
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.section === section);
  });
}

function setHeader(title, description) {
  document.getElementById("section-title").textContent = title;
  document.getElementById("section-description").textContent = description;
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
    return;
  }

  if (!state.selectedShowId || !state.shows.some((show) => show.id === state.selectedShowId)) {
    state.selectedShowId = state.shows[0].id;
  }

  await selectShow(state.selectedShowId);
}

async function selectShow(showId) {
  state.selectedShowId = showId;
  const response = await fetchJSON(`/api/tv/shows/${showId}/seasons`);
  state.selectedShowTitle = response.show?.title ?? "";
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
  const response = await fetchJSON(`/api/tv/seasons/${seasonId}/episodes`);
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
        <article class="media-card">
          <div class="media-card-accent ${escapeHtml(item.type)}"></div>
          <div class="media-card-body">
            <div class="media-card-info">
              <div class="media-card-title">${escapeHtml(item.headline)}</div>
              ${item.subline ? `<div class="media-card-sub">${escapeHtml(item.subline)}</div>` : ""}
            </div>
            <div style="display:flex;align-items:center;gap:0.5rem">
              <button class="play-btn" data-play-type="${escapeHtml(item.type)}" data-play-id="${item.id}" title="Play">
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
        <article class="movie-card">
          <div class="movie-card-year">${movie.year}</div>
          <div class="movie-card-title">${escapeHtml(movie.title)}</div>
          <div class="movie-card-footer">
            <span class="badge ${movie.watched ? "watched" : "unwatched"}">
              ${movie.watched ? "Watched" : "Unwatched"}
            </span>
            <button class="play-btn" data-play-type="movie" data-play-id="${movie.id}" title="Play">
              <i data-lucide="play"></i>
            </button>
          </div>
        </article>
      `,
        )
        .join("")}
    </div>
  `;
  wirePlayButtons(content);
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
              <div class="show-item ${show.id === state.selectedShowId ? "active" : ""}" data-show-id="${show.id}">
                <div class="show-item-info">
                  <div class="show-item-title">${escapeHtml(show.title)}</div>
                  <div class="show-item-meta">
                    ${show.watched_count}/${show.total_episodes} episodes
                    ${show.next_up ? ` · Next: ${escapeHtml(show.next_up)}` : " · All caught up"}
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

      <section class="tv-right">
        <div>
          <div class="section-label">${escapeHtml(state.selectedShowTitle || "Seasons")}</div>
          <div class="season-tabs">
            ${state.seasons
              .map(
                (season) => `
              <button class="season-tab ${season.id === state.selectedSeasonId ? "active" : ""}" data-season-id="${season.id}">
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
              <div class="episode-item">
                <span class="episode-num">E${String(episode.episode_number).padStart(2, "0")}</span>
                <span class="episode-title">${escapeHtml(episode.title)}</span>
                <div class="episode-badges">
                  ${episode.is_next_up ? '<span class="badge next">Next Up</span>' : ""}
                  <span class="badge ${episode.watched ? "watched" : "unwatched"}">
                    ${episode.watched ? "Watched" : "Unwatched"}
                  </span>
                  <button class="play-btn" data-play-type="episode" data-play-id="${episode.id}" title="Play">
                    <i data-lucide="play"></i>
                  </button>
                </div>
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
      const showId = Number(node.getAttribute("data-show-id"));
      if (!showId || showId === state.selectedShowId) {
        return;
      }
      await selectShow(showId);
      renderTV();
      drawIcons();
    });
  });

  content.querySelectorAll("[data-season-id]").forEach((node) => {
    node.addEventListener("click", async () => {
      const seasonId = Number(node.getAttribute("data-season-id"));
      if (!seasonId || seasonId === state.selectedSeasonId) {
        return;
      }
      await selectSeason(seasonId);
    });
  });

  wirePlayButtons(content);
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

function drawIcons() {
  if (window.lucide && typeof window.lucide.createIcons === "function") {
    window.lucide.createIcons();
  }
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

async function playItem(type, id) {
  try {
    await postJSON("/api/play", { type, id: String(id) });
  } catch (err) {
    console.error("play failed:", err.message);
  }
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

let playbackTimer = null;

function startPlaybackPolling() {
  pollPlayback();
  playbackTimer = setInterval(pollPlayback, 5000);
}

async function pollPlayback() {
  try {
    const data = await fetchJSON("/api/playback");
    renderNowPlaying(data);
  } catch {
    // Ignore polling errors.
  }
}

function renderNowPlaying(data) {
  const el = document.getElementById("now-playing");
  if (!el) return;

  if (!data.active) {
    el.style.display = "none";
    return;
  }

  const pct = data.progress ? Math.round(data.progress * 100) : 0;
  const pos = formatTime(data.position_ms || 0);
  const dur = formatTime(data.duration_ms || 0);

  el.style.display = "flex";
  el.innerHTML = `
    <div class="now-playing-indicator"></div>
    <span class="now-playing-title">${escapeHtml(data.title || "Playing")}</span>
    <span class="now-playing-time">${pos} / ${dur}</span>
    <div class="now-playing-progress">
      <div class="now-playing-progress-fill" style="width:${pct}%"></div>
    </div>
  `;
}

function formatTime(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}
