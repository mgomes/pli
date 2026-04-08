package player

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

func TestReportTimelineChecksStatusCode(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/:/timeline" {
				t.Fatalf("unexpected path: %s", r.URL.Path)
			}
			w.WriteHeader(http.StatusOK)
		}))
		defer ts.Close()

		client := &PlexClient{BaseURL: ts.URL, Token: "token"}
		if err := client.ReportTimeline(context.Background(), "123", 1000, 2000, "playing"); err != nil {
			t.Fatalf("ReportTimeline() error = %v", err)
		}
	})

	t.Run("error status", func(t *testing.T) {
		ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "timeline failed", http.StatusBadGateway)
		}))
		defer ts.Close()

		client := &PlexClient{BaseURL: ts.URL, Token: "token"}
		if err := client.ReportTimeline(context.Background(), "123", 1000, 2000, "playing"); err == nil {
			t.Fatalf("expected ReportTimeline() to fail on non-2xx status")
		}
	})
}

func TestScrobbleChecksStatusCode(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/:/scrobble" {
				t.Fatalf("unexpected path: %s", r.URL.Path)
			}
			w.WriteHeader(http.StatusOK)
		}))
		defer ts.Close()

		client := &PlexClient{BaseURL: ts.URL, Token: "token"}
		if err := client.Scrobble(context.Background(), "123"); err != nil {
			t.Fatalf("Scrobble() error = %v", err)
		}
	})

	t.Run("error status", func(t *testing.T) {
		ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "scrobble failed", http.StatusInternalServerError)
		}))
		defer ts.Close()

		client := &PlexClient{BaseURL: ts.URL, Token: "token"}
		if err := client.Scrobble(context.Background(), "123"); err == nil {
			t.Fatalf("expected Scrobble() to fail on non-2xx status")
		}
	})
}

func TestDeleteMetadataChecksStatusCode(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodDelete {
				t.Fatalf("unexpected method: %s", r.Method)
			}
			if r.URL.Path != "/library/metadata/123" {
				t.Fatalf("unexpected path: %s", r.URL.Path)
			}
			w.WriteHeader(http.StatusNoContent)
		}))
		defer ts.Close()

		client := &PlexClient{BaseURL: ts.URL, Token: "token"}
		if err := client.DeleteMetadata(context.Background(), "123"); err != nil {
			t.Fatalf("DeleteMetadata() error = %v", err)
		}
	})

	t.Run("error status", func(t *testing.T) {
		ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "delete failed", http.StatusForbidden)
		}))
		defer ts.Close()

		client := &PlexClient{BaseURL: ts.URL, Token: "token"}
		if err := client.DeleteMetadata(context.Background(), "123"); err == nil {
			t.Fatalf("expected DeleteMetadata() to fail on non-2xx status")
		}
	})

	t.Run("missing rating key", func(t *testing.T) {
		client := &PlexClient{BaseURL: "http://127.0.0.1:32400", Token: "token"}
		if err := client.DeleteMetadata(context.Background(), " "); err == nil {
			t.Fatalf("expected DeleteMetadata() to fail when rating key is empty")
		}
	})
}

func TestStreamURLBuildsValidURL(t *testing.T) {
	tests := []struct {
		name        string
		baseURL     string
		partKey     string
		token       string
		wantScheme  string
		wantHost    string
		wantPath    string
		wantToken   string
		wantQueryKV map[string]string
	}{
		{
			name:       "relative path no query",
			baseURL:    "http://127.0.0.1:32400",
			partKey:    "/library/parts/123/file.mkv",
			token:      "abc123",
			wantScheme: "http",
			wantHost:   "127.0.0.1:32400",
			wantPath:   "/library/parts/123/file.mkv",
			wantToken:  "abc123",
		},
		{
			name:       "preserves existing query",
			baseURL:    "http://127.0.0.1:32400",
			partKey:    "/library/parts/123/file.mkv?download=1",
			token:      "abc123",
			wantScheme: "http",
			wantHost:   "127.0.0.1:32400",
			wantPath:   "/library/parts/123/file.mkv",
			wantToken:  "abc123",
			wantQueryKV: map[string]string{
				"download": "1",
			},
		},
		{
			name:       "does not override existing token",
			baseURL:    "http://127.0.0.1:32400",
			partKey:    "/library/parts/123/file.mkv?X-Plex-Token=from-part",
			token:      "from-client",
			wantScheme: "http",
			wantHost:   "127.0.0.1:32400",
			wantPath:   "/library/parts/123/file.mkv",
			wantToken:  "from-part",
		},
		{
			name:       "absolute part URL uses configured server",
			baseURL:    "https://plex.example.com",
			partKey:    "http://localhost:32400/library/parts/123/file.mkv?download=1",
			token:      "abc123",
			wantScheme: "https",
			wantHost:   "plex.example.com",
			wantPath:   "/library/parts/123/file.mkv",
			wantToken:  "abc123",
			wantQueryKV: map[string]string{
				"download": "1",
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			client := &PlexClient{
				BaseURL: tc.baseURL,
				Token:   tc.token,
			}

			raw := client.StreamURL(tc.partKey)
			parsed, err := url.Parse(raw)
			if err != nil {
				t.Fatalf("StreamURL() returned invalid URL %q: %v", raw, err)
			}
			if parsed.Scheme != tc.wantScheme {
				t.Fatalf("scheme = %q, want %q", parsed.Scheme, tc.wantScheme)
			}
			if parsed.Host != tc.wantHost {
				t.Fatalf("host = %q, want %q", parsed.Host, tc.wantHost)
			}
			if parsed.Path != tc.wantPath {
				t.Fatalf("path = %q, want %q", parsed.Path, tc.wantPath)
			}
			if got := parsed.Query().Get("X-Plex-Token"); got != tc.wantToken {
				t.Fatalf("X-Plex-Token = %q, want %q", got, tc.wantToken)
			}
			for key, want := range tc.wantQueryKV {
				if got := parsed.Query().Get(key); got != want {
					t.Fatalf("query[%q] = %q, want %q", key, got, want)
				}
			}
		})
	}
}

func TestFetchMetadataIncludesMarkersAndEpisodeContext(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/library/metadata/123" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/xml")
		_, _ = w.Write([]byte(`
<MediaContainer size="1">
  <Video ratingKey="123" type="episode" grandparentRatingKey="show-1" parentRatingKey="season-1" parentIndex="1" index="2" title="Second Episode" duration="1800000" viewOffset="60000">
    <Media>
      <Part key="/library/parts/123/file.mkv" />
    </Media>
    <Marker type="credits" startTimeOffset="1700000" endTimeOffset="1795000" final="1" />
    <Marker type="intro" startTimeOffset="15000" endTimeOffset="75000" />
  </Video>
</MediaContainer>`))
	}))
	defer ts.Close()

	client := &PlexClient{BaseURL: ts.URL, Token: "token"}
	meta, err := client.FetchMetadata(context.Background(), "123")
	if err != nil {
		t.Fatalf("FetchMetadata() error = %v", err)
	}

	if meta.RatingKey != "123" {
		t.Fatalf("RatingKey = %q, want %q", meta.RatingKey, "123")
	}
	if meta.Type != "episode" {
		t.Fatalf("Type = %q, want %q", meta.Type, "episode")
	}
	if meta.ShowID != "show-1" {
		t.Fatalf("ShowID = %q, want %q", meta.ShowID, "show-1")
	}
	if meta.SeasonID != "season-1" {
		t.Fatalf("SeasonID = %q, want %q", meta.SeasonID, "season-1")
	}
	if meta.SeasonNumber != 1 || meta.EpisodeNumber != 2 {
		t.Fatalf("episode coordinates = S%02dE%02d, want S01E02", meta.SeasonNumber, meta.EpisodeNumber)
	}
	if len(meta.Markers) != 2 {
		t.Fatalf("markers length = %d, want 2", len(meta.Markers))
	}
	if meta.Markers[0].Type != "intro" {
		t.Fatalf("first marker type = %q, want %q", meta.Markers[0].Type, "intro")
	}
	if !meta.Markers[1].Final {
		t.Fatalf("credits marker final = false, want true")
	}
}

func TestFetchNextEpisodeResolvesChronologicalSuccessor(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/xml")

		switch r.URL.Path {
		case "/library/metadata/current":
			_, _ = w.Write([]byte(`
<MediaContainer size="1">
  <Video ratingKey="current" type="episode" grandparentRatingKey="show-1" parentRatingKey="season-1" parentIndex="1" index="2" title="Episode 2" duration="1800000">
    <Media>
      <Part key="/library/parts/current/file.mkv" />
    </Media>
  </Video>
</MediaContainer>`))
		case "/library/metadata/show-1/allLeaves":
			_, _ = w.Write([]byte(`
<MediaContainer size="3">
  <Video ratingKey="ep-4" grandparentRatingKey="show-1" parentIndex="2" index="1" title="Episode 4" />
  <Video ratingKey="current" grandparentRatingKey="show-1" parentIndex="1" index="2" title="Episode 2" />
  <Video ratingKey="ep-3" grandparentRatingKey="show-1" parentIndex="1" index="3" title="Episode 3" />
</MediaContainer>`))
		default:
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
	}))
	defer ts.Close()

	client := &PlexClient{BaseURL: ts.URL, Token: "token"}
	nextEpisode, err := client.FetchNextEpisode(context.Background(), "current")
	if err != nil {
		t.Fatalf("FetchNextEpisode() error = %v", err)
	}
	if nextEpisode == nil {
		t.Fatalf("FetchNextEpisode() = nil, want next episode")
	}
	if nextEpisode.ID != "ep-3" {
		t.Fatalf("next episode ID = %q, want %q", nextEpisode.ID, "ep-3")
	}
}

func TestFetchNextEpisodeReturnsNilForNonEpisode(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/library/metadata/movie-1" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/xml")
		_, _ = w.Write([]byte(`
<MediaContainer size="1">
  <Video ratingKey="movie-1" type="movie" title="A Movie" duration="7200000">
    <Media>
      <Part key="/library/parts/movie-1/file.mkv" />
    </Media>
  </Video>
</MediaContainer>`))
	}))
	defer ts.Close()

	client := &PlexClient{BaseURL: ts.URL, Token: "token"}
	nextEpisode, err := client.FetchNextEpisode(context.Background(), "movie-1")
	if err != nil {
		t.Fatalf("FetchNextEpisode() error = %v", err)
	}
	if nextEpisode != nil {
		t.Fatalf("FetchNextEpisode() = %#v, want nil", nextEpisode)
	}
}
