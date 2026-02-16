package web

import (
	"context"
	"database/sql"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"io/fs"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/mgomes/pli/internal/db"
	"github.com/mgomes/pli/internal/player"
)

const (
	cacheNamespaceAPI     = "api"
	cacheKeyRecentlyAdded = "recently_added"
)

//go:embed templates/index.html static/*
var uiFS embed.FS

type Server struct {
	queries  *db.Queries
	player   *player.Manager
	template *template.Template
	staticFS http.Handler
}

type indexData struct {
	Title string
}

type configEntry struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

type recentlyAddedItem struct {
	Type     string `json:"type"`
	ID       int64  `json:"id"`
	Headline string `json:"headline"`
	Subline  string `json:"subline"`
	AddedAt  string `json:"added_at"`
}

type movieItem struct {
	ID      int64  `json:"id"`
	Title   string `json:"title"`
	Year    int64  `json:"year"`
	Watched bool   `json:"watched"`
	AddedAt string `json:"added_at"`
}

type tvShowItem struct {
	ID            int64  `json:"id"`
	Title         string `json:"title"`
	WatchedCount  int64  `json:"watched_count"`
	TotalEpisodes int64  `json:"total_episodes"`
	NextUp        string `json:"next_up"`
}

type tvSeasonItem struct {
	ID            int64  `json:"id"`
	SeasonNumber  int64  `json:"season_number"`
	Title         string `json:"title"`
	WatchedCount  int64  `json:"watched_count"`
	TotalEpisodes int64  `json:"total_episodes"`
}

type tvEpisodeItem struct {
	ID            int64  `json:"id"`
	SeasonNumber  int64  `json:"season_number"`
	EpisodeNumber int64  `json:"episode_number"`
	Title         string `json:"title"`
	Watched       bool   `json:"watched"`
	IsNextUp      bool   `json:"is_next_up"`
	AddedAt       string `json:"added_at"`
}

func NewServer(queries *db.Queries, playerMgr *player.Manager) (*Server, error) {
	tmpl, err := template.ParseFS(uiFS, "templates/index.html")
	if err != nil {
		return nil, fmt.Errorf("parse template: %w", err)
	}

	staticSub, err := fs.Sub(uiFS, "static")
	if err != nil {
		return nil, fmt.Errorf("load static assets: %w", err)
	}

	return &Server{
		queries:  queries,
		player:   playerMgr,
		template: tmpl,
		staticFS: http.FileServer(http.FS(staticSub)),
	}, nil
}

func (s *Server) HTTPServer(addr string) *http.Server {
	return &http.Server{
		Addr:    addr,
		Handler: s.router(),
	}
}

func (s *Server) router() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(30 * time.Second))

	r.Get("/", s.handleIndex)
	r.Get("/healthz", s.handleHealth)

	r.Route("/api", func(r chi.Router) {
		r.Get("/config", s.handleConfig)
		r.Get("/recently-added", s.handleRecentlyAdded)
		r.Get("/movies", s.handleMovies)
		r.Get("/tv/shows", s.handleTVShows)
		r.Get("/tv/shows/{showID}/seasons", s.handleTVSeasons)
		r.Get("/tv/seasons/{seasonID}/episodes", s.handleTVEpisodes)
		r.Post("/play", s.handlePlay)
		r.Get("/playback", s.handlePlayback)
	})

	r.Handle("/static/*", http.StripPrefix("/static/", s.staticFS))

	return r
}

func (s *Server) handleIndex(w http.ResponseWriter, r *http.Request) {
	if err := s.template.ExecuteTemplate(w, "index.html", indexData{Title: "pli"}); err != nil {
		http.Error(w, "failed to render page", http.StatusInternalServerError)
	}
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleConfig(w http.ResponseWriter, r *http.Request) {
	rows, err := s.queries.ListConfigs(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load config")
		return
	}

	configs := make([]configEntry, 0, len(rows))
	for _, row := range rows {
		configs = append(configs, configEntry{Key: row.Key, Value: row.Value})
	}

	writeJSON(w, http.StatusOK, map[string]any{"configs": configs})
}

func (s *Server) handleRecentlyAdded(w http.ResponseWriter, r *http.Request) {
	now := time.Now().UTC()
	_ = s.queries.DeleteExpiredCacheItems(r.Context(), sql.NullString{String: now.Format(time.RFC3339), Valid: true})

	if payload, ok := s.getCachedPayload(r.Context(), cacheNamespaceAPI, cacheKeyRecentlyAdded); ok {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Cache", "HIT")
		_, _ = w.Write(payload)
		return
	}

	rows, err := s.queries.ListRecentlyAdded(r.Context(), 12)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load recently added")
		return
	}

	items := make([]recentlyAddedItem, 0, len(rows))
	for _, row := range rows {
		item := recentlyAddedItem{
			Type:     row.ItemType,
			ID:       row.ItemID,
			Headline: row.Headline,
			Subline:  nullString(row.Subline),
			AddedAt:  row.AddedAt,
		}
		items = append(items, item)
	}

	response := map[string]any{"items": items}
	encoded, err := json.Marshal(response)
	if err == nil {
		s.setCachedPayload(r.Context(), cacheNamespaceAPI, cacheKeyRecentlyAdded, encoded, now.Add(45*time.Second))
	}

	w.Header().Set("X-Cache", "MISS")
	writeJSON(w, http.StatusOK, response)
}

func (s *Server) handleMovies(w http.ResponseWriter, r *http.Request) {
	rows, err := s.queries.ListMovies(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load movies")
		return
	}

	movies := make([]movieItem, 0, len(rows))
	for _, row := range rows {
		movies = append(movies, movieItem{
			ID:      row.ID,
			Title:   row.Title,
			Year:    row.ReleaseYear,
			Watched: row.Watched == 1,
			AddedAt: row.AddedAt,
		})
	}

	writeJSON(w, http.StatusOK, map[string]any{"movies": movies})
}

func (s *Server) handleTVShows(w http.ResponseWriter, r *http.Request) {
	rows, err := s.queries.ListTVShows(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load tv shows")
		return
	}

	shows := make([]tvShowItem, 0, len(rows))
	for _, row := range rows {
		nextUp := ""
		if row.NextUpSeason > 0 && row.NextUpEpisode > 0 {
			nextUp = fmt.Sprintf("S%02dE%02d · %s", row.NextUpSeason, row.NextUpEpisode, row.NextUpTitle)
		}
		shows = append(shows, tvShowItem{
			ID:            row.ID,
			Title:         row.Title,
			WatchedCount:  row.WatchedCount,
			TotalEpisodes: row.TotalEpisodes,
			NextUp:        nextUp,
		})
	}

	writeJSON(w, http.StatusOK, map[string]any{"shows": shows})
}

func (s *Server) handleTVSeasons(w http.ResponseWriter, r *http.Request) {
	showID, err := parseIDParam(r, "showID")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid show id")
		return
	}

	show, err := s.queries.GetShow(r.Context(), showID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "show not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to load show")
		return
	}

	rows, err := s.queries.ListSeasonsByShow(r.Context(), showID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load seasons")
		return
	}

	seasons := make([]tvSeasonItem, 0, len(rows))
	for _, row := range rows {
		seasons = append(seasons, tvSeasonItem{
			ID:            row.ID,
			SeasonNumber:  row.SeasonNumber,
			Title:         row.Title,
			WatchedCount:  row.WatchedCount,
			TotalEpisodes: row.TotalEpisodes,
		})
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"show": map[string]any{
			"id":    show.ID,
			"title": show.Title,
		},
		"seasons": seasons,
	})
}

func (s *Server) handleTVEpisodes(w http.ResponseWriter, r *http.Request) {
	seasonID, err := parseIDParam(r, "seasonID")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid season id")
		return
	}

	season, err := s.queries.GetSeason(r.Context(), seasonID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "season not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to load season")
		return
	}

	rows, err := s.queries.ListEpisodesBySeason(r.Context(), seasonID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load episodes")
		return
	}

	episodes := make([]tvEpisodeItem, 0, len(rows))
	for _, row := range rows {
		episodes = append(episodes, tvEpisodeItem{
			ID:            row.ID,
			SeasonNumber:  row.SeasonNumber,
			EpisodeNumber: row.EpisodeNumber,
			Title:         row.Title,
			Watched:       row.Watched == 1,
			IsNextUp:      row.IsNextUp == 1,
			AddedAt:       row.AddedAt,
		})
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"season": map[string]any{
			"id":            season.ID,
			"show_id":       season.ShowID,
			"season_number": season.SeasonNumber,
			"title":         season.Title,
		},
		"episodes": episodes,
	})
}

func (s *Server) handlePlay(w http.ResponseWriter, r *http.Request) {
	var req player.PlayRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Type == "" || req.ID == "" {
		writeError(w, http.StatusBadRequest, "type and id are required")
		return
	}

	if err := s.player.Play(r.Context(), req); err != nil {
		if err.Error() == "a session is already active" {
			writeError(w, http.StatusConflict, err.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "playing"})
}

func (s *Server) handlePlayback(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.player.State())
}

func (s *Server) getCachedPayload(ctx context.Context, namespace, key string) ([]byte, bool) {
	cached, err := s.queries.GetCacheItem(ctx, db.GetCacheItemParams{Namespace: namespace, Key: key})
	if err != nil {
		return nil, false
	}
	if !cached.ExpiresAt.Valid {
		return nil, false
	}
	expiresAt, err := time.Parse(time.RFC3339, cached.ExpiresAt.String)
	if err != nil || time.Now().UTC().After(expiresAt) {
		return nil, false
	}
	return []byte(cached.Payload), true
}

func (s *Server) setCachedPayload(ctx context.Context, namespace, key string, payload []byte, expiresAt time.Time) {
	_ = s.queries.UpsertCacheItem(ctx, db.UpsertCacheItemParams{
		Namespace: namespace,
		Key:       key,
		Payload:   string(payload),
		ExpiresAt: sql.NullString{String: expiresAt.UTC().Format(time.RFC3339), Valid: true},
		UpdatedAt: time.Now().UTC().Format(time.RFC3339),
	})
}

func parseIDParam(r *http.Request, name string) (int64, error) {
	value := chi.URLParam(r, name)
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil || parsed <= 0 {
		return 0, fmt.Errorf("invalid %s", name)
	}
	return parsed, nil
}

func nullString(v sql.NullString) string {
	if !v.Valid {
		return ""
	}
	return v.String
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
