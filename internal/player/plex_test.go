package player

import (
	"context"
	"net/http"
	"net/http/httptest"
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
