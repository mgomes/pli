package player

import (
	"context"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"net/url"
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
	Title      string      `xml:"title,attr"`
	RatingKey  string      `xml:"ratingKey,attr"`
	SessionKey string      `xml:"sessionKey,attr"`
	Duration   int64       `xml:"duration,attr"`
	Media      []plexMedia `xml:"Media"`
}

type plexMedia struct {
	Parts []plexPart `xml:"Part"`
}

type plexPart struct {
	Key string `xml:"key,attr"`
}

type PlexMetadata struct {
	Title    string
	PartKey  string
	Duration int64 // milliseconds
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
		Title:    mc.Videos[0].Title,
		PartKey:  mc.Videos[0].Media[0].Parts[0].Key,
		Duration: mc.Videos[0].Duration,
	}, nil
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

	streamURL := baseURL.ResolveReference(partURL)
	if c.Token != "" {
		query := streamURL.Query()
		if query.Get("X-Plex-Token") == "" {
			query.Set("X-Plex-Token", c.Token)
		}
		streamURL.RawQuery = query.Encode()
	}

	return streamURL.String()
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
