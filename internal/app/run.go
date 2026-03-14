package app

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"time"

	"github.com/google/uuid"
	"github.com/mgomes/pli/internal/db"
	"github.com/mgomes/pli/internal/web"
	_ "modernc.org/sqlite"
)

const sqliteSchema = `
CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS cache_items (
  namespace TEXT NOT NULL,
  key TEXT NOT NULL,
  payload TEXT NOT NULL,
  expires_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  PRIMARY KEY (namespace, key)
);

CREATE TABLE IF NOT EXISTS shows (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  added_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS seasons (
  id INTEGER PRIMARY KEY,
  show_id INTEGER NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  season_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  UNIQUE (show_id, season_number)
);

CREATE TABLE IF NOT EXISTS episodes (
  id INTEGER PRIMARY KEY,
  show_id INTEGER NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  episode_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  watched INTEGER NOT NULL DEFAULT 0,
  added_at TEXT NOT NULL,
  UNIQUE (season_id, episode_number)
);

CREATE TABLE IF NOT EXISTS movies (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  release_year INTEGER NOT NULL,
  watched INTEGER NOT NULL DEFAULT 0,
  added_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_episodes_show_watch ON episodes(show_id, watched);
CREATE INDEX IF NOT EXISTS idx_episodes_added_at ON episodes(added_at DESC);
CREATE INDEX IF NOT EXISTS idx_movies_added_at ON movies(added_at DESC);
`

func Run(ctx context.Context, addr, dbPath string) error {
	database, queries, err := openDatabase(ctx, dbPath)
	if err != nil {
		return err
	}
	defer database.Close()

	imageCacheDir := filepath.Join(filepath.Dir(dbPath), "cache", "images")
	if err := os.MkdirAll(imageCacheDir, 0o755); err != nil {
		return fmt.Errorf("create image cache directory: %w", err)
	}

	server, err := web.NewServer(queries, imageCacheDir)
	if err != nil {
		return err
	}

	httpServer := server.HTTPServer(addr)

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := httpServer.Shutdown(shutdownCtx); err != nil {
			log.Printf("server shutdown error: %v", err)
		}
	}()

	logStartupAddress(addr)
	err = httpServer.ListenAndServe()
	if err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}

	return nil
}

func logStartupAddress(addr string) {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		log.Printf("pli web app listening on %s", addr)
		return
	}

	if host == "" || host == "0.0.0.0" || host == "::" {
		log.Printf("pli web app listening on http://0.0.0.0:%s (all interfaces)", port)
		log.Printf("local access: http://localhost:%s", port)
		return
	}

	log.Printf("pli web app listening on http://%s:%s", host, port)
}

func openDatabase(ctx context.Context, dbPath string) (*sql.DB, *db.Queries, error) {
	if err := os.MkdirAll(filepath.Dir(dbPath), 0o755); err != nil {
		return nil, nil, fmt.Errorf("create database directory: %w", err)
	}

	database, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, nil, fmt.Errorf("open sqlite database: %w", err)
	}
	database.SetMaxOpenConns(1)

	if _, err := database.ExecContext(ctx, "PRAGMA foreign_keys = ON;"); err != nil {
		database.Close()
		return nil, nil, fmt.Errorf("enable foreign keys: %w", err)
	}

	if _, err := database.ExecContext(ctx, sqliteSchema); err != nil {
		database.Close()
		return nil, nil, fmt.Errorf("apply database schema: %w", err)
	}

	queries := db.New(database)
	if err := ensureDefaultConfig(ctx, queries); err != nil {
		database.Close()
		return nil, nil, fmt.Errorf("initialize config: %w", err)
	}

	if err := seedDemoData(ctx, queries); err != nil {
		database.Close()
		return nil, nil, fmt.Errorf("seed demo data: %w", err)
	}

	return database, queries, nil
}

func ensureDefaultConfig(ctx context.Context, queries *db.Queries) error {
	now := time.Now().UTC().Format(time.RFC3339)
	defaultPlayer := "vlc"
	if runtime.GOOS == "darwin" {
		defaultPlayer = "iina"
	}

	// Insert-if-missing defaults so user-updated values survive restarts.
	defaults := map[string]string{
		"app.name":       "pli",
		"app.theme":      "dark",
		"player.default": defaultPlayer,
		"plex.base_url":  "http://127.0.0.1:32400",
		"plex.token":     "",
		"plex.client_id": uuid.New().String(),
	}

	for key, value := range defaults {
		if err := queries.InsertConfigIfNotExists(ctx, db.InsertConfigIfNotExistsParams{
			Key:       key,
			Value:     value,
			UpdatedAt: now,
		}); err != nil {
			return err
		}
	}

	return nil
}

func seedDemoData(ctx context.Context, queries *db.Queries) error {
	count, err := queries.CountShows(ctx)
	if err != nil {
		return err
	}
	if count > 0 {
		return nil
	}

	now := time.Now().UTC()
	ts := func(hoursAgo int) string {
		return now.Add(-time.Duration(hoursAgo) * time.Hour).Format(time.RFC3339)
	}

	if err := queries.InsertShow(ctx, db.InsertShowParams{ID: 1, Title: "Severance", Summary: "A team undergoes memory bifurcation at work.", AddedAt: ts(120), UpdatedAt: ts(2)}); err != nil {
		return err
	}
	if err := queries.InsertShow(ctx, db.InsertShowParams{ID: 2, Title: "The Bear", Summary: "A chef returns home to run a family sandwich shop.", AddedAt: ts(200), UpdatedAt: ts(6)}); err != nil {
		return err
	}

	seasons := []db.InsertSeasonParams{
		{ID: 11, ShowID: 1, SeasonNumber: 1, Title: "Season 1"},
		{ID: 12, ShowID: 1, SeasonNumber: 2, Title: "Season 2"},
		{ID: 21, ShowID: 2, SeasonNumber: 1, Title: "Season 1"},
		{ID: 22, ShowID: 2, SeasonNumber: 2, Title: "Season 2"},
	}
	for _, season := range seasons {
		if err := queries.InsertSeason(ctx, season); err != nil {
			return err
		}
	}

	episodes := []db.InsertEpisodeParams{
		{ID: 101, ShowID: 1, SeasonID: 11, EpisodeNumber: 1, Title: "Good News About Hell", Watched: 1, AddedAt: ts(110)},
		{ID: 102, ShowID: 1, SeasonID: 11, EpisodeNumber: 2, Title: "Half Loop", Watched: 1, AddedAt: ts(105)},
		{ID: 103, ShowID: 1, SeasonID: 11, EpisodeNumber: 3, Title: "In Perpetuity", Watched: 0, AddedAt: ts(95)},
		{ID: 104, ShowID: 1, SeasonID: 11, EpisodeNumber: 4, Title: "The You You Are", Watched: 0, AddedAt: ts(90)},
		{ID: 121, ShowID: 1, SeasonID: 12, EpisodeNumber: 1, Title: "Hello, Ms. Cobel", Watched: 0, AddedAt: ts(20)},
		{ID: 122, ShowID: 1, SeasonID: 12, EpisodeNumber: 2, Title: "Goodbye, Mrs. Selvig", Watched: 0, AddedAt: ts(12)},
		{ID: 201, ShowID: 2, SeasonID: 21, EpisodeNumber: 1, Title: "System", Watched: 1, AddedAt: ts(190)},
		{ID: 202, ShowID: 2, SeasonID: 21, EpisodeNumber: 2, Title: "Hands", Watched: 1, AddedAt: ts(188)},
		{ID: 221, ShowID: 2, SeasonID: 22, EpisodeNumber: 1, Title: "Beef", Watched: 1, AddedAt: ts(48)},
		{ID: 222, ShowID: 2, SeasonID: 22, EpisodeNumber: 2, Title: "Pasta", Watched: 1, AddedAt: ts(24)},
	}
	for _, episode := range episodes {
		if err := queries.InsertEpisode(ctx, episode); err != nil {
			return err
		}
	}

	movies := []db.InsertMovieParams{
		{ID: 1, Title: "Dune: Part Two", ReleaseYear: 2024, Watched: 1, AddedAt: ts(8)},
		{ID: 2, Title: "The Creator", ReleaseYear: 2023, Watched: 0, AddedAt: ts(36)},
		{ID: 3, Title: "Past Lives", ReleaseYear: 2023, Watched: 0, AddedAt: ts(72)},
	}
	for _, movie := range movies {
		if err := queries.InsertMovie(ctx, movie); err != nil {
			return err
		}
	}

	return nil
}
