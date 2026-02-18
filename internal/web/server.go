package web

import (
	"context"
	"database/sql"
	"embed"
	"encoding/json"
	"fmt"
	"html/template"
	"io"
	"io/fs"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"
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
	ID       string `json:"id"`
	Headline string `json:"headline"`
	Subline  string `json:"subline"`
	AddedAt  string `json:"added_at"`
	CoverURL string `json:"cover_url"`
}

type movieItem struct {
	ID              string   `json:"id"`
	Title           string   `json:"title"`
	Year            int64    `json:"year"`
	Watched         bool     `json:"watched"`
	ViewOffset      int64    `json:"view_offset,omitempty"`
	Duration        int64    `json:"duration,omitempty"`
	AddedAt         string   `json:"added_at"`
	CoverURL        string   `json:"cover_url"`
	ArtURL          string   `json:"art_url,omitempty"`
	Summary         string   `json:"summary,omitempty"`
	Rating          string   `json:"rating,omitempty"`
	AudienceRating  string   `json:"audience_rating,omitempty"`
	ContentRating   string   `json:"content_rating,omitempty"`
	Tagline         string   `json:"tagline,omitempty"`
	Studio          string   `json:"studio,omitempty"`
	Genres          []string `json:"genres,omitempty"`
	Directors       []string `json:"directors,omitempty"`
	Actors          []string `json:"actors,omitempty"`
	VideoResolution string   `json:"video_resolution,omitempty"`
	AudioCodec      string   `json:"audio_codec,omitempty"`
	AudioChannels   int      `json:"audio_channels,omitempty"`
}

type tvShowItem struct {
	ID            string `json:"id"`
	Title         string `json:"title"`
	Summary       string `json:"summary,omitempty"`
	WatchedCount  int64  `json:"watched_count"`
	TotalEpisodes int64  `json:"total_episodes"`
	NextUp        string `json:"next_up"`
	CoverURL      string `json:"cover_url"`
	ArtURL        string `json:"art_url,omitempty"`
}

type tvSeasonItem struct {
	ID            string `json:"id"`
	SeasonNumber  int64  `json:"season_number"`
	Title         string `json:"title"`
	WatchedCount  int64  `json:"watched_count"`
	TotalEpisodes int64  `json:"total_episodes"`
}

type tvEpisodeItem struct {
	ID            string `json:"id"`
	SeasonNumber  int64  `json:"season_number"`
	EpisodeNumber int64  `json:"episode_number"`
	Title         string `json:"title"`
	Summary       string `json:"summary,omitempty"`
	Watched       bool   `json:"watched"`
	ViewOffset    int64  `json:"view_offset,omitempty"`
	Duration      int64  `json:"duration,omitempty"`
	IsNextUp      bool   `json:"is_next_up"`
	AddedAt       string `json:"added_at"`
}

func NewServer(queries *db.Queries) (*Server, error) {
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
	r.Get("/recently-added", s.handleIndex)
	r.Get("/movies", s.handleIndex)
	r.Get("/movies/*", s.handleIndex)
	r.Get("/tv", s.handleIndex)
	r.Get("/tv/*", s.handleIndex)
	r.Get("/settings", s.handleIndex)
	r.Get("/healthz", s.handleHealth)

	r.Route("/api", func(r chi.Router) {
		r.Get("/config", s.handleConfig)
		r.Put("/config", s.handleUpdateConfig)
		r.Get("/recently-added", s.handleRecentlyAdded)
		r.Get("/movies", s.handleMovies)
		r.Get("/tv/shows", s.handleTVShows)
		r.Get("/tv/shows/{showID}/seasons", s.handleTVSeasons)
		r.Get("/tv/seasons/{seasonID}/episodes", s.handleTVEpisodes)
		r.Get("/plex/image", s.handlePlexImage)
		r.Post("/plex/test", s.handlePlexTest)
		r.Post("/plex/auth/start", s.handlePlexAuthStart)
		r.Get("/plex/auth/poll/{pinID}", s.handlePlexAuthPoll)
		r.Post("/play", s.handlePlay)
		r.Post("/timeline", s.handleTimeline)
		r.Post("/watched", s.handleWatched)
		r.Get("/sessions", s.handleSessions)
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

var configAllowlist = map[string]bool{
	"plex.base_url":  true,
	"plex.token":     true,
	"plex.client_id": true,
	"player.default": true,
}

func (s *Server) handleUpdateConfig(w http.ResponseWriter, r *http.Request) {
	var req configEntry
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if !configAllowlist[req.Key] {
		writeError(w, http.StatusBadRequest, "unknown config key")
		return
	}

	if err := s.queries.UpsertConfig(r.Context(), db.UpsertConfigParams{
		Key:       req.Key,
		Value:     req.Value,
		UpdatedAt: time.Now().UTC().Format(time.RFC3339),
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save config")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handlePlexTest(w http.ResponseWriter, r *http.Request) {
	var req struct {
		BaseURL string `json:"base_url"`
		Token   string `json:"token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.BaseURL == "" {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": "base URL is required"})
		return
	}

	client := &player.PlexClient{BaseURL: req.BaseURL, Token: req.Token}
	serverName, err := client.TestConnection(r.Context())
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "server_name": serverName})
}

func (s *Server) handlePlexAuthStart(w http.ResponseWriter, r *http.Request) {
	cfg, err := s.queries.GetConfig(r.Context(), "plex.client_id")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read client ID")
		return
	}

	auth := &player.PlexAuth{ClientID: cfg.Value, Product: "pli"}
	pin, err := auth.CreatePin(r.Context())
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"pin_id":   pin.ID,
		"code":     pin.Code,
		"auth_url": pin.AuthURL,
	})
}

func (s *Server) handlePlexAuthPoll(w http.ResponseWriter, r *http.Request) {
	pinID, err := parseIDParam(r, "pinID")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid pin ID")
		return
	}

	code := r.URL.Query().Get("code")
	if code == "" {
		writeError(w, http.StatusBadRequest, "code is required")
		return
	}

	cfg, err := s.queries.GetConfig(r.Context(), "plex.client_id")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read client ID")
		return
	}

	auth := &player.PlexAuth{ClientID: cfg.Value, Product: "pli"}
	token, err := auth.CheckPin(r.Context(), pinID, code)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	if token == "" {
		writeJSON(w, http.StatusOK, map[string]any{"done": false})
		return
	}

	if err := s.queries.UpsertConfig(r.Context(), db.UpsertConfigParams{
		Key:       "plex.token",
		Value:     token,
		UpdatedAt: time.Now().UTC().Format(time.RFC3339),
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save token")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"done": true})
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

	plexClient, err := s.plexClient(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load plex configuration")
		return
	}

	rows, err := plexClient.FetchRecentlyAdded(r.Context(), 24)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	items := make([]recentlyAddedItem, 0, len(rows))
	for _, row := range rows {
		item := recentlyAddedItem{
			Type:     row.Kind,
			ID:       row.ID,
			Headline: row.Headline,
			Subline:  row.Subline,
			AddedAt:  row.AddedAt,
			CoverURL: s.plexImageURL(row.CoverPath),
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
	plexClient, err := s.plexClient(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load plex configuration")
		return
	}

	rows, err := plexClient.FetchMovies(r.Context())
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	movies := make([]movieItem, 0, len(rows))
	for _, row := range rows {
		movies = append(movies, movieItem{
			ID:              row.ID,
			Title:           row.Title,
			Year:            row.Year,
			Watched:         row.Watched,
			ViewOffset:      row.ViewOffset,
			Duration:        row.Duration,
			AddedAt:         row.AddedAt,
			CoverURL:        s.plexImageURL(row.CoverPath),
			ArtURL:          s.plexImageURL(row.ArtPath),
			Summary:         row.Summary,
			Rating:          row.Rating,
			AudienceRating:  row.AudienceRating,
			ContentRating:   row.ContentRating,
			Tagline:         row.Tagline,
			Studio:          row.Studio,
			Genres:          row.Genres,
			Directors:       row.Directors,
			Actors:          row.Actors,
			VideoResolution: row.VideoResolution,
			AudioCodec:      row.AudioCodec,
			AudioChannels:   row.AudioChannels,
		})
	}

	writeJSON(w, http.StatusOK, map[string]any{"movies": movies})
}

func (s *Server) handleTVShows(w http.ResponseWriter, r *http.Request) {
	plexClient, err := s.plexClient(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load plex configuration")
		return
	}

	rows, err := plexClient.FetchTVShows(r.Context())
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	shows := make([]tvShowItem, 0, len(rows))
	for _, row := range rows {
		shows = append(shows, tvShowItem{
			ID:            row.ID,
			Title:         row.Title,
			Summary:       row.Summary,
			WatchedCount:  row.WatchedCount,
			TotalEpisodes: row.TotalEpisodes,
			NextUp:        row.NextUp,
			CoverURL:      s.plexImageURL(row.CoverPath),
			ArtURL:        s.plexImageURL(row.ArtPath),
		})
	}

	writeJSON(w, http.StatusOK, map[string]any{"shows": shows})
}

func (s *Server) handleTVSeasons(w http.ResponseWriter, r *http.Request) {
	showID := strings.TrimSpace(chi.URLParam(r, "showID"))
	if showID == "" {
		writeError(w, http.StatusBadRequest, "invalid show id")
		return
	}

	plexClient, err := s.plexClient(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load plex configuration")
		return
	}

	rows, err := plexClient.FetchSeasons(r.Context(), showID)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	show := &player.PlexShow{
		ID:    showID,
		Title: "TV Show",
	}
	if fetched, err := plexClient.FetchShow(r.Context(), showID); err == nil && fetched != nil {
		show = fetched
	} else if len(rows) > 0 {
		// Keep the endpoint functional even if metadata lookup is inconsistent.
		show.Title = rows[0].Title
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

	nextUp := ""
	if show.TotalEpisodes > show.WatchedCount {
		nextEpisode, err := plexClient.FetchNextUpEpisode(r.Context(), showID)
		if err == nil && nextEpisode != nil {
			nextUp = fmt.Sprintf("S%02dE%02d · %s", nextEpisode.SeasonNumber, nextEpisode.EpisodeNumber, nextEpisode.Title)
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"show": map[string]any{
			"id":        show.ID,
			"title":     show.Title,
			"summary":   show.Summary,
			"next_up":   nextUp,
			"cover_url": s.plexImageURL(show.CoverPath),
			"art_url":   s.plexImageURL(show.ArtPath),
		},
		"seasons": seasons,
	})
}

func (s *Server) handleTVEpisodes(w http.ResponseWriter, r *http.Request) {
	seasonID := strings.TrimSpace(chi.URLParam(r, "seasonID"))
	if seasonID == "" {
		writeError(w, http.StatusBadRequest, "invalid season id")
		return
	}

	plexClient, err := s.plexClient(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load plex configuration")
		return
	}

	rows, err := plexClient.FetchEpisodes(r.Context(), seasonID)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	showID := strings.TrimSpace(r.URL.Query().Get("show_id"))
	if showID == "" && len(rows) > 0 {
		showID = rows[0].ShowID
	}

	nextUpID := ""
	if showID != "" {
		nextEpisode, err := plexClient.FetchNextUpEpisode(r.Context(), showID)
		if err == nil && nextEpisode != nil {
			nextUpID = nextEpisode.ID
		}
	}

	episodes := make([]tvEpisodeItem, 0, len(rows))
	for _, row := range rows {
		episodes = append(episodes, tvEpisodeItem{
			ID:            row.ID,
			SeasonNumber:  row.SeasonNumber,
			EpisodeNumber: row.EpisodeNumber,
			Title:         row.Title,
			Summary:       row.Summary,
			Watched:       row.Watched,
			ViewOffset:    row.ViewOffset,
			Duration:      row.Duration,
			IsNextUp:      nextUpID != "" && row.ID == nextUpID,
			AddedAt:       row.AddedAt,
		})
	}

	seasonNumber := int64(0)
	seasonTitle := ""
	if len(rows) > 0 {
		seasonNumber = rows[0].SeasonNumber
		seasonTitle = fmt.Sprintf("Season %d", seasonNumber)
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"season": map[string]any{
			"id":            seasonID,
			"show_id":       showID,
			"season_number": seasonNumber,
			"title":         seasonTitle,
		},
		"episodes": episodes,
	})
}

func (s *Server) handlePlexImage(w http.ResponseWriter, r *http.Request) {
	coverPath := strings.TrimSpace(r.URL.Query().Get("path"))
	if coverPath == "" {
		writeError(w, http.StatusBadRequest, "path is required")
		return
	}
	if !strings.HasPrefix(coverPath, "/") || strings.Contains(coverPath, "://") {
		writeError(w, http.StatusBadRequest, "invalid path")
		return
	}

	plexClient, err := s.plexClient(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load plex configuration")
		return
	}

	targetURL := strings.TrimRight(plexClient.BaseURL, "/") + coverPath
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, targetURL, nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to build plex image request")
		return
	}
	if plexClient.Token != "" {
		req.Header.Set("X-Plex-Token", plexClient.Token)
	}
	req.Header.Set("Accept", "image/*")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		writeError(w, http.StatusBadGateway, "failed to fetch image from plex")
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		writeError(w, http.StatusBadGateway, "plex image request failed")
		return
	}

	if contentType := resp.Header.Get("Content-Type"); contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
	w.Header().Set("Cache-Control", "private, max-age=300")
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
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

	plexClient, err := s.plexClient(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load plex configuration")
		return
	}

	meta, err := plexClient.FetchMetadata(r.Context(), req.ID)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	streamURL := plexClient.StreamURL(meta.PartKey)
	writeJSON(w, http.StatusOK, map[string]any{
		"stream_url":     streamURL,
		"rating_key":     req.ID,
		"duration_ms":    meta.Duration,
		"view_offset_ms": meta.ViewOffset,
	})
}

func (s *Server) handleTimeline(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RatingKey  string `json:"rating_key"`
		TimeMs     int64  `json:"time_ms"`
		DurationMs int64  `json:"duration_ms"`
		State      string `json:"state"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.RatingKey == "" || req.State == "" {
		writeError(w, http.StatusBadRequest, "rating_key and state are required")
		return
	}

	plexClient, err := s.plexClient(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load plex configuration")
		return
	}

	if err := plexClient.ReportTimeline(r.Context(), req.RatingKey, req.TimeMs, req.DurationMs, req.State); err != nil {
		log.Printf("timeline report error for %s: %v", req.RatingKey, err)
		writeError(w, http.StatusBadGateway, "timeline report failed")
		return
	}

	if req.DurationMs > 0 && req.TimeMs > 0 && float64(req.TimeMs)/float64(req.DurationMs) >= 0.9 {
		if err := plexClient.Scrobble(r.Context(), req.RatingKey); err != nil {
			log.Printf("scrobble error for %s: %v", req.RatingKey, err)
		}
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleWatched(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RatingKey string `json:"rating_key"`
		Watched   bool   `json:"watched"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.RatingKey == "" {
		writeError(w, http.StatusBadRequest, "rating_key is required")
		return
	}

	plexClient, err := s.plexClient(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load plex configuration")
		return
	}

	if req.Watched {
		err = plexClient.Scrobble(r.Context(), req.RatingKey)
	} else {
		err = plexClient.Unscrobble(r.Context(), req.RatingKey)
		if err == nil {
			// Also clear the resume position so playback starts from the beginning.
			_ = plexClient.ClearProgress(r.Context(), req.RatingKey)
		}
	}
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleSessions(w http.ResponseWriter, r *http.Request) {
	plexClient, err := s.plexClient(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load plex configuration")
		return
	}

	sessions, err := plexClient.FetchSessions(r.Context())
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	type sessionItem struct {
		Title      string `json:"title"`
		RatingKey  string `json:"rating_key"`
		SessionKey string `json:"session_key"`
	}

	items := make([]sessionItem, 0, len(sessions))
	for _, s := range sessions {
		items = append(items, sessionItem{
			Title:      s.Title,
			RatingKey:  s.RatingKey,
			SessionKey: s.SessionKey,
		})
	}

	writeJSON(w, http.StatusOK, map[string]any{"sessions": items})
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

func (s *Server) plexClient(ctx context.Context) (*player.PlexClient, error) {
	baseURL, err := s.configValue(ctx, "plex.base_url")
	if err != nil {
		return nil, err
	}
	token, err := s.configValue(ctx, "plex.token")
	if err != nil {
		return nil, err
	}

	baseURL = strings.TrimSpace(baseURL)
	if baseURL == "" {
		baseURL = "http://127.0.0.1:32400"
	}

	return &player.PlexClient{
		BaseURL: baseURL,
		Token:   strings.TrimSpace(token),
	}, nil
}

func (s *Server) configValue(ctx context.Context, key string) (string, error) {
	row, err := s.queries.GetConfig(ctx, key)
	if err != nil {
		return "", err
	}
	return row.Value, nil
}

func (s *Server) plexImageURL(coverPath string) string {
	coverPath = strings.TrimSpace(coverPath)
	if coverPath == "" {
		return ""
	}
	return "/api/plex/image?path=" + url.QueryEscape(coverPath)
}

func parseIDParam(r *http.Request, name string) (int64, error) {
	value := chi.URLParam(r, name)
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil || parsed <= 0 {
		return 0, fmt.Errorf("invalid %s", name)
	}
	return parsed, nil
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
