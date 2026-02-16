package player

import "testing"

func TestShouldScrobble(t *testing.T) {
	tests := []struct {
		name       string
		positionMs int64
		durationMs int64
		want       bool
	}{
		{name: "zero duration", positionMs: 900, durationMs: 0, want: false},
		{name: "below threshold", positionMs: 899, durationMs: 1000, want: false},
		{name: "at threshold", positionMs: 900, durationMs: 1000, want: true},
		{name: "above threshold", positionMs: 950, durationMs: 1000, want: true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := shouldScrobble(tc.positionMs, tc.durationMs); got != tc.want {
				t.Fatalf("shouldScrobble(%d, %d) = %v, want %v", tc.positionMs, tc.durationMs, got, tc.want)
			}
		})
	}
}

func TestStateFromPause(t *testing.T) {
	if got := stateFromPause(true); got != "paused" {
		t.Fatalf("stateFromPause(true) = %q, want %q", got, "paused")
	}
	if got := stateFromPause(false); got != "playing" {
		t.Fatalf("stateFromPause(false) = %q, want %q", got, "playing")
	}
}
