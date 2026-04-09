package player

import (
	"context"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"

	"github.com/google/uuid"
)

type PlexClient struct {
	BaseURL string
	Token   string
}

type plexMediaContainer struct {
	XMLName      xml.Name    `xml:"MediaContainer"`
	FriendlyName string      `xml:"friendlyName,attr"`
	Videos       []plexVideo `xml:"Video"`
}

type plexVideo struct {
	Title                string       `xml:"title,attr"`
	GrandparentTitle     string       `xml:"grandparentTitle,attr"`
	Type                 string       `xml:"type,attr"`
	RatingKey            string       `xml:"ratingKey,attr"`
	ParentRatingKey      string       `xml:"parentRatingKey,attr"`
	GrandparentRatingKey string       `xml:"grandparentRatingKey,attr"`
	SessionKey           string       `xml:"sessionKey,attr"`
	Duration             int64        `xml:"duration,attr"`
	ViewOffset           int64        `xml:"viewOffset,attr"`
	ParentIndex          int64        `xml:"parentIndex,attr"`
	Index                int64        `xml:"index,attr"`
	Media                []plexMedia  `xml:"Media"`
	Markers              []plexMarker `xml:"Marker"`
}

type plexMedia struct {
	Parts []plexPart `xml:"Part"`
}

type plexPart struct {
	Key string `xml:"key,attr"`
}

type plexMarker struct {
	Type            string `xml:"type,attr"`
	StartTimeOffset int64  `xml:"startTimeOffset,attr"`
	EndTimeOffset   int64  `xml:"endTimeOffset,attr"`
	Final           bool   `xml:"final,attr"`
}

type PlexMarker struct {
	Type            string
	StartTimeOffset int64
	EndTimeOffset   int64
	Final           bool
}

type PlexMetadata struct {
	RatingKey     string
	Type          string
	ShowID        string
	ShowTitle     string
	SeasonID      string
	SeasonNumber  int64
	EpisodeNumber int64
	Title         string
	PartKey       string
	Duration      int64 // milliseconds
	ViewOffset    int64 // milliseconds
	Markers       []PlexMarker
}

func (c *PlexClient) TestConnection(ctx context.Context) (string, error) {
	u := c.BaseURL
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return "", err
	}
	c.setHeaders(req)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("plex identity request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return "", fmt.Errorf("plex identity: status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("plex identity read: %w", err)
	}

	var mc plexMediaContainer
	if err := xml.Unmarshal(body, &mc); err != nil {
		return "", fmt.Errorf("plex identity parse: %w", err)
	}

	return mc.FriendlyName, nil
}

func (c *PlexClient) FetchMetadata(ctx context.Context, ratingKey string) (*PlexMetadata, error) {
	u := fmt.Sprintf("%s/library/metadata/%s", c.BaseURL, ratingKey)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	c.setHeaders(req)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("plex metadata request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("plex metadata: status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("plex metadata read: %w", err)
	}

	var mc plexMediaContainer
	if err := xml.Unmarshal(body, &mc); err != nil {
		return nil, fmt.Errorf("plex metadata parse: %w", err)
	}

	if len(mc.Videos) == 0 || len(mc.Videos[0].Media) == 0 || len(mc.Videos[0].Media[0].Parts) == 0 {
		return nil, fmt.Errorf("plex metadata: no playable parts for rating key %s", ratingKey)
	}

	return &PlexMetadata{
		RatingKey:     strings.TrimSpace(mc.Videos[0].RatingKey),
		Type:          strings.TrimSpace(mc.Videos[0].Type),
		ShowID:        strings.TrimSpace(mc.Videos[0].GrandparentRatingKey),
		ShowTitle:     strings.TrimSpace(mc.Videos[0].GrandparentTitle),
		SeasonID:      strings.TrimSpace(mc.Videos[0].ParentRatingKey),
		SeasonNumber:  mc.Videos[0].ParentIndex,
		EpisodeNumber: mc.Videos[0].Index,
		Title:         mc.Videos[0].Title,
		PartKey:       mc.Videos[0].Media[0].Parts[0].Key,
		Duration:      mc.Videos[0].Duration,
		ViewOffset:    mc.Videos[0].ViewOffset,
		Markers:       normalizeMarkers(mc.Videos[0].Markers),
	}, nil
}

func (c *PlexClient) FetchNextEpisode(ctx context.Context, ratingKey string) (*PlexEpisode, error) {
	current, err := c.FetchMetadata(ctx, ratingKey)
	if err != nil {
		return nil, err
	}
	if current.Type != "episode" || current.ShowID == "" {
		return nil, nil
	}

	var container browseContainer
	if err := c.doXML(ctx, "/library/metadata/"+current.ShowID+"/allLeaves", &container); err != nil {
		return nil, err
	}

	episodes := make([]PlexEpisode, 0, len(container.Videos))
	for _, v := range container.Videos {
		episodeID := strings.TrimSpace(v.RatingKey)
		if episodeID == "" {
			continue
		}
		episodes = append(episodes, PlexEpisode{
			ID:            episodeID,
			ShowID:        strings.TrimSpace(v.GrandparentRatingKey),
			SeasonNumber:  v.ParentIndex,
			EpisodeNumber: v.Index,
			Title:         v.Title,
			Summary:       strings.TrimSpace(v.Summary),
			Watched:       false,
			ViewOffset:    v.ViewOffset,
			Duration:      v.Duration,
			AddedAt:       toRFC3339(v.AddedAt),
			CoverPath:     firstNonEmpty(v.Thumb, v.ParentThumb, v.GrandparentThumb),
		})
	}

	return nextEpisodeAfter(current, episodes), nil
}

func (c *PlexClient) StreamURL(partKey string) string {
	baseURL, err := url.Parse(strings.TrimSpace(c.BaseURL))
	if err != nil {
		return ""
	}

	partURL, err := url.Parse(strings.TrimSpace(partKey))
	if err != nil {
		return ""
	}

	// Plex can return an absolute part URL (sometimes localhost). Always anchor
	// playback URLs to the configured server origin and keep only path/query.
	streamURL := baseURL.ResolveReference(&url.URL{
		Path:     partURL.Path,
		RawPath:  partURL.RawPath,
		RawQuery: partURL.RawQuery,
		Fragment: partURL.Fragment,
	})
	if c.Token != "" {
		query := streamURL.Query()
		if query.Get("X-Plex-Token") == "" {
			query.Set("X-Plex-Token", c.Token)
		}
		streamURL.RawQuery = query.Encode()
	}

	return streamURL.String()
}

func normalizeMarkers(markers []plexMarker) []PlexMarker {
	result := make([]PlexMarker, 0, len(markers))
	for _, marker := range markers {
		markerType := strings.ToLower(strings.TrimSpace(marker.Type))
		if markerType == "" || marker.EndTimeOffset <= marker.StartTimeOffset {
			continue
		}
		result = append(result, PlexMarker{
			Type:            markerType,
			StartTimeOffset: marker.StartTimeOffset,
			EndTimeOffset:   marker.EndTimeOffset,
			Final:           marker.Final,
		})
	}

	sort.Slice(result, func(i, j int) bool {
		if result[i].StartTimeOffset == result[j].StartTimeOffset {
			return result[i].EndTimeOffset < result[j].EndTimeOffset
		}
		return result[i].StartTimeOffset < result[j].StartTimeOffset
	})

	return result
}

func nextEpisodeAfter(current *PlexMetadata, episodes []PlexEpisode) *PlexEpisode {
	if current == nil || len(episodes) == 0 {
		return nil
	}

	sort.Slice(episodes, func(i, j int) bool {
		if episodes[i].SeasonNumber == episodes[j].SeasonNumber {
			if episodes[i].EpisodeNumber == episodes[j].EpisodeNumber {
				return episodes[i].ID < episodes[j].ID
			}
			return episodes[i].EpisodeNumber < episodes[j].EpisodeNumber
		}
		return episodes[i].SeasonNumber < episodes[j].SeasonNumber
	})

	for i := range episodes {
		episode := episodes[i]
		if episode.ID == current.RatingKey {
			continue
		}
		if episode.SeasonNumber < current.SeasonNumber {
			continue
		}
		if episode.SeasonNumber == current.SeasonNumber && episode.EpisodeNumber <= current.EpisodeNumber {
			continue
		}
		return &episodes[i]
	}

	return nil
}

func (c *PlexClient) ReportTimeline(ctx context.Context, ratingKey string, timeMs, durationMs int64, state string) error {
	params := url.Values{
		"ratingKey":       {ratingKey},
		"key":             {fmt.Sprintf("/library/metadata/%s", ratingKey)},
		"time":            {strconv.FormatInt(timeMs, 10)},
		"duration":        {strconv.FormatInt(durationMs, 10)},
		"state":           {state},
		"hasMDE":          {"1"},
		"playQueueItemID": {"0"},
	}
	u := fmt.Sprintf("%s/:/timeline?%s", c.BaseURL, params.Encode())

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return err
	}
	c.setHeaders(req)

	return c.doExpect2xx(req, "plex timeline")
}

func (c *PlexClient) Scrobble(ctx context.Context, ratingKey string) error {
	params := url.Values{
		"key":        {ratingKey},
		"identifier": {"com.plexapp.plugins.library"},
	}
	u := fmt.Sprintf("%s/:/scrobble?%s", c.BaseURL, params.Encode())

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return err
	}
	c.setHeaders(req)

	return c.doExpect2xx(req, "plex scrobble")
}

func (c *PlexClient) ClearProgress(ctx context.Context, ratingKey string) error {
	params := url.Values{
		"key":        {fmt.Sprintf("/library/metadata/%s", ratingKey)},
		"identifier": {"com.plexapp.plugins.library"},
		"time":       {"0"},
		"state":      {"stopped"},
	}
	u := fmt.Sprintf("%s/:/progress?%s", c.BaseURL, params.Encode())

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return err
	}
	c.setHeaders(req)

	return c.doExpect2xx(req, "plex clear progress")
}

func (c *PlexClient) Unscrobble(ctx context.Context, ratingKey string) error {
	params := url.Values{
		"key":        {ratingKey},
		"identifier": {"com.plexapp.plugins.library"},
	}
	u := fmt.Sprintf("%s/:/unscrobble?%s", c.BaseURL, params.Encode())

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return err
	}
	c.setHeaders(req)

	return c.doExpect2xx(req, "plex unscrobble")
}

func (c *PlexClient) DeleteMetadata(ctx context.Context, ratingKey string) error {
	ratingKey = strings.TrimSpace(ratingKey)
	if ratingKey == "" {
		return fmt.Errorf("plex delete metadata: rating key is required")
	}

	u := fmt.Sprintf("%s/library/metadata/%s", strings.TrimRight(c.BaseURL, "/"), url.PathEscape(ratingKey))
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, u, nil)
	if err != nil {
		return err
	}
	c.setHeaders(req)

	return c.doExpect2xx(req, "plex delete metadata")
}

func (c *PlexClient) doExpect2xx(req *http.Request, op string) error {
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("%s: %w", op, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return fmt.Errorf("%s: status %d: %s", op, resp.StatusCode, strings.TrimSpace(string(body)))
	}

	return nil
}

func (c *PlexClient) setHeaders(req *http.Request) {
	if c.Token != "" {
		req.Header.Set("X-Plex-Token", c.Token)
	}
	req.Header.Set("X-Plex-Client-Identifier", "pli-app")
	req.Header.Set("X-Plex-Product", "pli")
	req.Header.Set("Accept", "application/xml")
}

func (c *PlexClient) RegisterPlaySession(ctx context.Context, ratingKey string) (string, error) {
	sessionID := uuid.New().String()
	params := url.Values{
		"path":                      {fmt.Sprintf("/library/metadata/%s", ratingKey)},
		"mediaIndex":                {"0"},
		"partIndex":                 {"0"},
		"protocol":                  {"http"},
		"directPlay":                {"1"},
		"directStream":              {"1"},
		"X-Plex-Session-Identifier": {sessionID},
	}
	u := fmt.Sprintf("%s/video/:/transcode/universal/decision?%s", c.BaseURL, params.Encode())
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return "", err
	}
	c.setHeaders(req)
	return sessionID, c.doExpect2xx(req, "plex decision")
}

type PlexSession struct {
	Title      string
	RatingKey  string
	SessionKey string
}

func (c *PlexClient) FetchSessions(ctx context.Context) ([]PlexSession, error) {
	var mc plexMediaContainer
	if err := c.doXML(ctx, "/status/sessions", &mc); err != nil {
		return nil, err
	}
	sessions := make([]PlexSession, 0, len(mc.Videos))
	for _, v := range mc.Videos {
		sessions = append(sessions, PlexSession{
			Title:      v.Title,
			RatingKey:  v.RatingKey,
			SessionKey: v.SessionKey,
		})
	}
	return sessions, nil
}

// PlexAuth handles the Plex OAuth PIN-based authentication flow against plex.tv.
type PlexAuth struct {
	ClientID string
	Product  string
}

type PlexPin struct {
	ID      int64  `json:"id"`
	Code    string `json:"code"`
	AuthURL string `json:"auth_url"`
}

func (a *PlexAuth) CreatePin(ctx context.Context) (*PlexPin, error) {
	form := url.Values{
		"strong":                   {"true"},
		"X-Plex-Product":           {a.Product},
		"X-Plex-Client-Identifier": {a.ClientID},
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://plex.tv/api/v2/pins", strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("plex create pin: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return nil, fmt.Errorf("plex create pin: status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var result struct {
		ID   int64  `json:"id"`
		Code string `json:"code"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("plex create pin: decode: %w", err)
	}

	authURL := fmt.Sprintf("https://app.plex.tv/auth#?clientID=%s&code=%s&context%%5Bdevice%%5D%%5Bproduct%%5D=%s",
		url.QueryEscape(a.ClientID),
		url.QueryEscape(result.Code),
		url.QueryEscape(a.Product),
	)

	return &PlexPin{
		ID:      result.ID,
		Code:    result.Code,
		AuthURL: authURL,
	}, nil
}

func (a *PlexAuth) CheckPin(ctx context.Context, pinID int64, code string) (string, error) {
	u := fmt.Sprintf("https://plex.tv/api/v2/pins/%d", pinID)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-Plex-Client-Identifier", a.ClientID)
	q := req.URL.Query()
	q.Set("code", code)
	req.URL.RawQuery = q.Encode()

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("plex check pin: %w", err)
	}
	defer resp.Body.Close()

	// Treat rate-limiting as "not ready yet" rather than a hard error.
	if resp.StatusCode == http.StatusTooManyRequests {
		return "", nil
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return "", fmt.Errorf("plex check pin: status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var result struct {
		AuthToken string `json:"authToken"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("plex check pin: decode: %w", err)
	}

	return result.AuthToken, nil
}
