package web

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/mgomes/pli/internal/db"
	_ "modernc.org/sqlite"
)

func TestHandlePlayerContextReturnsCurrentContextWhenNextMetadataFails(t *testing.T) {
	t.Parallel()

	plex := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/xml")

		switch r.URL.Path {
		case "/library/metadata/current":
			_, _ = w.Write([]byte(`
<MediaContainer size="1">
  <Video ratingKey="current" type="episode" grandparentRatingKey="show-1" parentRatingKey="season-1" parentIndex="1" index="2" title="Episode 2" duration="1800000" viewOffset="60000">
    <Media>
      <Part key="/library/parts/current/file.mkv" />
    </Media>
    <Marker type="intro" startTimeOffset="15000" endTimeOffset="75000" />
  </Video>
</MediaContainer>`))
		case "/library/metadata/show-1/allLeaves":
			_, _ = w.Write([]byte(`
<MediaContainer size="2">
  <Video ratingKey="current" grandparentRatingKey="show-1" parentIndex="1" index="2" title="Episode 2" />
  <Video ratingKey="next-ep" grandparentRatingKey="show-1" parentIndex="1" index="3" title="Episode 3" />
</MediaContainer>`))
		case "/library/metadata/next-ep":
			http.Error(w, "not found", http.StatusNotFound)
		default:
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
	}))
	defer plex.Close()

	database, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	defer database.Close()

	if _, err := database.Exec(`
CREATE TABLE app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`); err != nil {
		t.Fatalf("create app_config: %v", err)
	}

	queries := db.New(database)
	now := time.Now().UTC().Format(time.RFC3339)
	for key, value := range map[string]string{
		"plex.base_url": plex.URL,
		"plex.token":    "",
	} {
		if err := queries.UpsertConfig(t.Context(), db.UpsertConfigParams{
			Key:       key,
			Value:     value,
			UpdatedAt: now,
		}); err != nil {
			t.Fatalf("upsert config %s: %v", key, err)
		}
	}

	server, err := NewServer(queries, t.TempDir())
	if err != nil {
		t.Fatalf("NewServer() error = %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/player/context?rating_key=current", nil)
	rec := httptest.NewRecorder()

	server.handlePlayerContext(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var payload struct {
		RatingKey string `json:"rating_key"`
		Markers   []struct {
			Type string `json:"type"`
		} `json:"markers"`
		Next *struct {
			RatingKey string `json:"rating_key"`
		} `json:"next"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if payload.RatingKey != "current" {
		t.Fatalf("rating_key = %q, want %q", payload.RatingKey, "current")
	}
	if len(payload.Markers) != 1 || payload.Markers[0].Type != "intro" {
		t.Fatalf("markers = %#v, want one intro marker", payload.Markers)
	}
	if payload.Next != nil {
		t.Fatalf("next = %#v, want nil", payload.Next)
	}
}

func TestHandlePlayerContextReturnsCurrentContextWhenNextEpisodeLookupFails(t *testing.T) {
	t.Parallel()

	plex := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/xml")

		switch r.URL.Path {
		case "/library/metadata/current":
			_, _ = w.Write([]byte(`
<MediaContainer size="1">
  <Video ratingKey="current" type="episode" grandparentRatingKey="show-1" parentRatingKey="season-1" parentIndex="1" index="2" title="Episode 2" duration="1800000" viewOffset="60000">
    <Media>
      <Part key="/library/parts/current/file.mkv" />
    </Media>
    <Marker type="intro" startTimeOffset="15000" endTimeOffset="75000" />
  </Video>
</MediaContainer>`))
		case "/library/metadata/show-1/allLeaves":
			http.Error(w, "temporary failure", http.StatusBadGateway)
		default:
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
	}))
	defer plex.Close()

	database, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	defer database.Close()

	if _, err := database.Exec(`
CREATE TABLE app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`); err != nil {
		t.Fatalf("create app_config: %v", err)
	}

	queries := db.New(database)
	now := time.Now().UTC().Format(time.RFC3339)
	for key, value := range map[string]string{
		"plex.base_url": plex.URL,
		"plex.token":    "",
	} {
		if err := queries.UpsertConfig(t.Context(), db.UpsertConfigParams{
			Key:       key,
			Value:     value,
			UpdatedAt: now,
		}); err != nil {
			t.Fatalf("upsert config %s: %v", key, err)
		}
	}

	server, err := NewServer(queries, t.TempDir())
	if err != nil {
		t.Fatalf("NewServer() error = %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/player/context?rating_key=current", nil)
	rec := httptest.NewRecorder()

	server.handlePlayerContext(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var payload struct {
		RatingKey string `json:"rating_key"`
		Markers   []struct {
			Type string `json:"type"`
		} `json:"markers"`
		Next *struct {
			RatingKey string `json:"rating_key"`
		} `json:"next"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if payload.RatingKey != "current" {
		t.Fatalf("rating_key = %q, want %q", payload.RatingKey, "current")
	}
	if len(payload.Markers) != 1 || payload.Markers[0].Type != "intro" {
		t.Fatalf("markers = %#v, want one intro marker", payload.Markers)
	}
	if payload.Next != nil {
		t.Fatalf("next = %#v, want nil", payload.Next)
	}
}
