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
