package player

import (
	"context"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

type PlexClient struct {
	BaseURL string
	Token   string
}

type plexMediaContainer struct {
	XMLName xml.Name    `xml:"MediaContainer"`
	Videos  []plexVideo `xml:"Video"`
}

type plexVideo struct {
	Title string      `xml:"title,attr"`
	Media []plexMedia `xml:"Media"`
}

type plexMedia struct {
	Parts []plexPart `xml:"Part"`
}

type plexPart struct {
	Key string `xml:"key,attr"`
}

type PlexMetadata struct {
	Title   string
	PartKey string
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
		Title:   mc.Videos[0].Title,
		PartKey: mc.Videos[0].Media[0].Parts[0].Key,
	}, nil
}

func (c *PlexClient) StreamURL(partKey string) string {
	return fmt.Sprintf("%s%s?X-Plex-Token=%s", c.BaseURL, partKey, url.QueryEscape(c.Token))
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
