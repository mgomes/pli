package player

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"os"
	"os/exec"
	"sync"
	"time"
)

const (
	ipcSocket        = "/tmp/pli-playback.sock"
	progressInterval = 5 * time.Second
)

type ConfigReader func(key string) (string, error)

type PlayRequest struct {
	Type string `json:"type"`
	ID   string `json:"id"`
}

type PlaybackState struct {
	Active     bool    `json:"active"`
	Title      string  `json:"title,omitempty"`
	RatingKey  string  `json:"rating_key,omitempty"`
	PositionMs int64   `json:"position_ms,omitempty"`
	DurationMs int64   `json:"duration_ms,omitempty"`
	State      string  `json:"state,omitempty"`
	Progress   float64 `json:"progress,omitempty"`
}

type session struct {
	ratingKey string
	title     string
	posMs     int64
	durMs     int64
	state     string
	cancel    context.CancelFunc
	scrobbled bool
}

type Manager struct {
	mu           sync.Mutex
	active       *session
	configReader ConfigReader
}

func NewManager(configReader ConfigReader) *Manager {
	return &Manager{configReader: configReader}
}

func (m *Manager) Play(ctx context.Context, req PlayRequest) error {
	m.mu.Lock()
	if m.active != nil {
		m.mu.Unlock()
		return fmt.Errorf("a session is already active")
	}
	m.mu.Unlock()

	iinaPath, err := FindIINA()
	if err != nil {
		return err
	}

	baseURL, _ := m.configReader("plex.base_url")
	if baseURL == "" {
		baseURL = "http://127.0.0.1:32400"
	}
	token, _ := m.configReader("plex.token")

	plex := &PlexClient{BaseURL: baseURL, Token: token}

	meta, err := plex.FetchMetadata(ctx, req.ID)
	if err != nil {
		return fmt.Errorf("fetch plex metadata: %w", err)
	}

	streamURL := plex.StreamURL(meta.PartKey)

	// Clean up stale socket.
	os.Remove(ipcSocket)

	cmd := exec.Command(iinaPath,
		"--mpv-input-ipc-server="+ipcSocket,
		streamURL,
	)
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("launch iina: %w", err)
	}

	sessCtx, cancel := context.WithCancel(context.Background())
	sess := &session{
		ratingKey: req.ID,
		title:     meta.Title,
		state:     "playing",
		cancel:    cancel,
	}

	m.mu.Lock()
	m.active = sess
	m.mu.Unlock()

	go m.monitorProcess(sessCtx, cmd, sess)
	go m.pollProgress(sessCtx, plex, sess)

	return nil
}

func (m *Manager) State() PlaybackState {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.active == nil {
		return PlaybackState{Active: false}
	}

	s := m.active
	var progress float64
	if s.durMs > 0 {
		progress = float64(s.posMs) / float64(s.durMs)
	}

	return PlaybackState{
		Active:     true,
		Title:      s.title,
		RatingKey:  s.ratingKey,
		PositionMs: s.posMs,
		DurationMs: s.durMs,
		State:      s.state,
		Progress:   progress,
	}
}

func (m *Manager) Stop() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.active != nil {
		m.active.cancel()
		m.active = nil
	}
}

func (m *Manager) Shutdown() {
	m.Stop()
	os.Remove(ipcSocket)
}

func (m *Manager) monitorProcess(ctx context.Context, cmd *exec.Cmd, sess *session) {
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()

	select {
	case <-ctx.Done():
		// Session was cancelled externally.
		if cmd.Process != nil {
			cmd.Process.Kill()
		}
	case <-done:
		// Process exited on its own: stop the polling goroutine.
		sess.cancel()
	}

	m.mu.Lock()
	if m.active == sess {
		m.active = nil
	}
	m.mu.Unlock()
}

func (m *Manager) pollProgress(ctx context.Context, plex *PlexClient, sess *session) {
	defer m.reportStopped(plex, sess)

	conn, err := m.connectIPC(ctx, ipcSocket, 15*time.Second)
	if err != nil {
		log.Printf("player: ipc connect failed: %v", err)
		return
	}
	defer conn.Close()

	scanner := bufio.NewScanner(conn)
	ticker := time.NewTicker(progressInterval)
	defer ticker.Stop()

	m.sampleAndReport(ctx, conn, scanner, plex, sess)

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			m.sampleAndReport(ctx, conn, scanner, plex, sess)
		}
	}
}

func (m *Manager) sampleAndReport(ctx context.Context, conn net.Conn, scanner *bufio.Scanner, plex *PlexClient, sess *session) {
	pos, err := m.mpvGetFloatProperty(conn, scanner, "time-pos")
	if err != nil {
		log.Printf("player: get time-pos: %v", err)
		return
	}
	dur, err := m.mpvGetFloatProperty(conn, scanner, "duration")
	if err != nil {
		log.Printf("player: get duration: %v", err)
		return
	}
	paused, err := m.mpvGetBoolProperty(conn, scanner, "pause")
	if err != nil {
		log.Printf("player: get pause: %v", err)
	}

	posMs := int64(pos * 1000)
	durMs := int64(dur * 1000)
	playbackState := stateFromPause(paused)

	m.mu.Lock()
	sess.posMs = posMs
	sess.durMs = durMs
	sess.state = playbackState
	scrobbleCandidate := !sess.scrobbled && shouldScrobble(posMs, durMs)
	m.mu.Unlock()

	if err := plex.ReportTimeline(ctx, sess.ratingKey, posMs, durMs, playbackState); err != nil {
		log.Printf("player: timeline error: %v", err)
	}

	if scrobbleCandidate {
		if err := plex.Scrobble(ctx, sess.ratingKey); err != nil {
			log.Printf("player: scrobble error: %v", err)
			return
		}
		m.mu.Lock()
		sess.scrobbled = true
		m.mu.Unlock()
		log.Printf("player: scrobbled %s", sess.title)
	}
}

func (m *Manager) reportStopped(plex *PlexClient, sess *session) {
	m.mu.Lock()
	posMs := sess.posMs
	durMs := sess.durMs
	m.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := plex.ReportTimeline(ctx, sess.ratingKey, posMs, durMs, "stopped"); err != nil {
		log.Printf("player: stopped timeline error: %v", err)
	}
}

func (m *Manager) connectIPC(ctx context.Context, socketPath string, timeout time.Duration) (net.Conn, error) {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		conn, err := net.DialTimeout("unix", socketPath, 500*time.Millisecond)
		if err == nil {
			return conn, nil
		}
		time.Sleep(500 * time.Millisecond)
	}
	return nil, fmt.Errorf("timeout connecting to %s", socketPath)
}

type mpvCommand struct {
	Command   []any `json:"command"`
	RequestID int   `json:"request_id"`
}

type mpvResponse struct {
	Data      any    `json:"data"`
	RequestID int    `json:"request_id"`
	Error     string `json:"error"`
}

func (m *Manager) mpvGetFloatProperty(conn net.Conn, scanner *bufio.Scanner, property string) (float64, error) {
	cmd := mpvCommand{
		Command:   []any{"get_property", property},
		RequestID: 1,
	}
	data, _ := json.Marshal(cmd)
	data = append(data, '\n')

	conn.SetWriteDeadline(time.Now().Add(2 * time.Second))
	if _, err := conn.Write(data); err != nil {
		return 0, fmt.Errorf("write ipc: %w", err)
	}

	conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	for scanner.Scan() {
		line := scanner.Bytes()
		var resp mpvResponse
		if err := json.Unmarshal(line, &resp); err != nil {
			continue
		}
		// Skip events (no request_id).
		if resp.RequestID == 0 && resp.Error == "" {
			continue
		}
		if resp.Error != "" && resp.Error != "success" {
			return 0, fmt.Errorf("mpv error: %s", resp.Error)
		}
		switch v := resp.Data.(type) {
		case float64:
			return v, nil
		case json.Number:
			return v.Float64()
		default:
			return 0, fmt.Errorf("unexpected data type for %s: %T", property, resp.Data)
		}
	}
	if err := scanner.Err(); err != nil {
		return 0, fmt.Errorf("read ipc: %w", err)
	}
	return 0, fmt.Errorf("ipc connection closed")
}

func (m *Manager) mpvGetBoolProperty(conn net.Conn, scanner *bufio.Scanner, property string) (bool, error) {
	cmd := mpvCommand{
		Command:   []any{"get_property", property},
		RequestID: 1,
	}
	data, _ := json.Marshal(cmd)
	data = append(data, '\n')

	conn.SetWriteDeadline(time.Now().Add(2 * time.Second))
	if _, err := conn.Write(data); err != nil {
		return false, fmt.Errorf("write ipc: %w", err)
	}

	conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	for scanner.Scan() {
		line := scanner.Bytes()
		var resp mpvResponse
		if err := json.Unmarshal(line, &resp); err != nil {
			continue
		}
		if resp.RequestID == 0 && resp.Error == "" {
			continue
		}
		if resp.Error != "" && resp.Error != "success" {
			return false, fmt.Errorf("mpv error: %s", resp.Error)
		}
		switch v := resp.Data.(type) {
		case bool:
			return v, nil
		case float64:
			return v != 0, nil
		default:
			return false, fmt.Errorf("unexpected data type for %s: %T", property, resp.Data)
		}
	}
	if err := scanner.Err(); err != nil {
		return false, fmt.Errorf("read ipc: %w", err)
	}
	return false, fmt.Errorf("ipc connection closed")
}

func shouldScrobble(positionMs, durationMs int64) bool {
	if durationMs <= 0 {
		return false
	}
	return float64(positionMs)/float64(durationMs) >= 0.90
}

func stateFromPause(paused bool) string {
	if paused {
		return "paused"
	}
	return "playing"
}
