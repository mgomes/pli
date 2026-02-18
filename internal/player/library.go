package player

import (
	"context"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"path"
	"sort"
	"strconv"
	"strings"
	"time"
)

type PlexRecentItem struct {
	ID        string
	Kind      string
	Headline  string
	Subline   string
	AddedAt   string
	CoverPath string
}

type PlexMovie struct {
	ID              string
	Title           string
	Year            int64
	Watched         bool
	ViewOffset      int64
	Duration        int64
	AddedAt         string
	CoverPath       string
	ArtPath         string
	Summary         string
	Rating          string
	AudienceRating  string
	ContentRating   string
	Tagline         string
	Studio          string
	Genres          []string
	Directors       []string
	Actors          []string
	VideoResolution string
	AudioCodec      string
	AudioChannels   int
}

type PlexShow struct {
	ID            string
	Title         string
	Summary       string
	WatchedCount  int64
	TotalEpisodes int64
	NextUp        string
	CoverPath     string
	ArtPath       string
}

type PlexSeason struct {
	ID            string
	SeasonNumber  int64
	Title         string
	WatchedCount  int64
	TotalEpisodes int64
	CoverPath     string
}

type PlexEpisode struct {
	ID            string
	ShowID        string
	SeasonNumber  int64
	EpisodeNumber int64
	Title         string
	Watched       bool
	ViewOffset    int64
	Duration      int64
	AddedAt       string
	CoverPath     string
}

type browseContainer struct {
	XMLName     xml.Name          `xml:"MediaContainer"`
	Directories []browseDirectory `xml:"Directory"`
	Videos      []browseVideo     `xml:"Video"`
}

type browseDirectory struct {
	Key             string `xml:"key,attr"`
	RatingKey       string `xml:"ratingKey,attr"`
	ParentRatingKey string `xml:"parentRatingKey,attr"`
	Type            string `xml:"type,attr"`
	Title           string `xml:"title,attr"`
	Thumb           string `xml:"thumb,attr"`
	Art             string `xml:"art,attr"`
	Summary         string `xml:"summary,attr"`
	LeafCount       int64  `xml:"leafCount,attr"`
	ViewedLeafCount int64  `xml:"viewedLeafCount,attr"`
	Index           int64  `xml:"index,attr"`
}

type browseGenre struct {
	Tag string `xml:"tag,attr"`
}

type browseDirector struct {
	Tag string `xml:"tag,attr"`
}

type browseRole struct {
	Tag string `xml:"tag,attr"`
}

type browseMediaInfo struct {
	VideoResolution string `xml:"videoResolution,attr"`
	AudioCodec      string `xml:"audioCodec,attr"`
	AudioChannels   int    `xml:"audioChannels,attr"`
}

type browseVideo struct {
	RatingKey            string `xml:"ratingKey,attr"`
	GrandparentRatingKey string `xml:"grandparentRatingKey,attr"`
	Type                 string `xml:"type,attr"`
	Title                string `xml:"title,attr"`
	GrandparentTitle     string `xml:"grandparentTitle,attr"`
	ParentTitle          string `xml:"parentTitle,attr"`
	Art                  string `xml:"art,attr"`
	Thumb                string `xml:"thumb,attr"`
	ParentThumb          string `xml:"parentThumb,attr"`
	GrandparentThumb     string `xml:"grandparentThumb,attr"`
	ParentIndex          int64  `xml:"parentIndex,attr"`
	Index                int64  `xml:"index,attr"`
	ViewCount            int64  `xml:"viewCount,attr"`
	ViewOffset           int64  `xml:"viewOffset,attr"`
	LeafCount            int64  `xml:"leafCount,attr"`
	ViewedLeafCount      int64  `xml:"viewedLeafCount,attr"`
	Year                 int64  `xml:"year,attr"`
	AddedAt              int64  `xml:"addedAt,attr"`
	Summary              string `xml:"summary,attr"`
	Rating               string `xml:"rating,attr"`
	AudienceRating       string `xml:"audienceRating,attr"`
	ContentRating        string `xml:"contentRating,attr"`
	Tagline              string `xml:"tagline,attr"`
	Duration             int64  `xml:"duration,attr"`
	Studio               string `xml:"studio,attr"`

	Genres     []browseGenre     `xml:"Genre"`
	Directors  []browseDirector  `xml:"Director"`
	Roles      []browseRole      `xml:"Role"`
	MediaItems []browseMediaInfo `xml:"Media"`
}

type plexSection struct {
	Key  string
	Type string
}

func (c *PlexClient) FetchRecentlyAdded(ctx context.Context, limit int) ([]PlexRecentItem, error) {
	if limit <= 0 {
		limit = 20
	}

	var container browseContainer
	query := fmt.Sprintf("/library/recentlyAdded?X-Plex-Container-Start=0&X-Plex-Container-Size=%d", limit)
	if err := c.doXML(ctx, query, &container); err != nil {
		return nil, err
	}

	items := make([]PlexRecentItem, 0, len(container.Videos))
	for _, v := range container.Videos {
		ratingKey := strings.TrimSpace(v.RatingKey)
		if ratingKey == "" {
			continue
		}

		item := PlexRecentItem{
			ID:        ratingKey,
			Kind:      v.Type,
			Headline:  v.Title,
			Subline:   "",
			AddedAt:   toRFC3339(v.AddedAt),
			CoverPath: firstNonEmpty(v.Thumb, v.ParentThumb, v.GrandparentThumb),
		}

		switch v.Type {
		case "episode":
			item.Headline = fmt.Sprintf("%s S%02dE%02d", safeTitle(v.GrandparentTitle), v.ParentIndex, v.Index)
			item.Subline = v.Title
		case "movie":
			if v.Year > 0 {
				item.Subline = strconv.FormatInt(v.Year, 10)
			}
		}

		items = append(items, item)
	}

	return items, nil
}

func (c *PlexClient) FetchMovies(ctx context.Context) ([]PlexMovie, error) {
	sections, err := c.fetchSections(ctx)
	if err != nil {
		return nil, err
	}

	movies := []PlexMovie{}
	for _, section := range sections {
		if section.Type != "movie" {
			continue
		}

		var container browseContainer
		query := fmt.Sprintf("/library/sections/%s/all?type=1", section.Key)
		if err := c.doXML(ctx, query, &container); err != nil {
			return nil, err
		}

		for _, v := range container.Videos {
			if t := normalizeType(v.Type); t != "" && t != "movie" {
				continue
			}
			ratingKey := strings.TrimSpace(v.RatingKey)
			if ratingKey == "" {
				continue
			}
			genres := make([]string, 0, len(v.Genres))
			for _, g := range v.Genres {
				if t := strings.TrimSpace(g.Tag); t != "" {
					genres = append(genres, t)
				}
			}
			directors := make([]string, 0, len(v.Directors))
			for _, d := range v.Directors {
				if t := strings.TrimSpace(d.Tag); t != "" {
					directors = append(directors, t)
				}
			}
			actors := make([]string, 0, len(v.Roles))
			for _, r := range v.Roles {
				if t := strings.TrimSpace(r.Tag); t != "" {
					actors = append(actors, t)
					if len(actors) >= 10 {
						break
					}
				}
			}

			movie := PlexMovie{
				ID:             ratingKey,
				Title:          v.Title,
				Year:           v.Year,
				Watched:        v.ViewCount > 0,
				ViewOffset:     v.ViewOffset,
				Duration:       v.Duration,
				AddedAt:        toRFC3339(v.AddedAt),
				CoverPath:      firstNonEmpty(v.Thumb),
				ArtPath:        strings.TrimSpace(v.Art),
				Summary:        strings.TrimSpace(v.Summary),
				Rating:         strings.TrimSpace(v.Rating),
				AudienceRating: strings.TrimSpace(v.AudienceRating),
				ContentRating:  strings.TrimSpace(v.ContentRating),
				Tagline:        strings.TrimSpace(v.Tagline),
				Studio:         strings.TrimSpace(v.Studio),
				Genres:         genres,
				Directors:      directors,
				Actors:         actors,
			}

			if len(v.MediaItems) > 0 {
				m := v.MediaItems[0]
				movie.VideoResolution = strings.TrimSpace(m.VideoResolution)
				movie.AudioCodec = strings.TrimSpace(m.AudioCodec)
				movie.AudioChannels = m.AudioChannels
			}

			movies = append(movies, movie)
		}
	}

	sort.Slice(movies, func(i, j int) bool {
		return movies[i].Title < movies[j].Title
	})

	return movies, nil
}

func (c *PlexClient) FetchTVShows(ctx context.Context) ([]PlexShow, error) {
	sections, err := c.fetchSections(ctx)
	if err != nil {
		return nil, err
	}

	shows := []PlexShow{}
	seen := make(map[string]struct{})
	for _, section := range sections {
		if section.Type != "show" {
			continue
		}

		var container browseContainer
		query := fmt.Sprintf("/library/sections/%s/all?type=2", section.Key)
		if err := c.doXML(ctx, query, &container); err != nil {
			return nil, err
		}

		for _, d := range container.Directories {
			if t := normalizeType(d.Type); t != "" && t != "show" {
				continue
			}
			showID := ratingKeyFromDirectory(d)
			if showID == "" {
				continue
			}
			if _, ok := seen[showID]; ok {
				continue
			}
			seen[showID] = struct{}{}
			nextUp := ""
			if d.LeafCount > d.ViewedLeafCount {
				nextUp = "Continue watching"
			}
			shows = append(shows, PlexShow{
				ID:            showID,
				Title:         d.Title,
				Summary:       strings.TrimSpace(d.Summary),
				WatchedCount:  d.ViewedLeafCount,
				TotalEpisodes: d.LeafCount,
				NextUp:        nextUp,
				CoverPath:     d.Thumb,
				ArtPath:       strings.TrimSpace(d.Art),
			})
		}
	}

	sort.Slice(shows, func(i, j int) bool {
		return shows[i].Title < shows[j].Title
	})

	return shows, nil
}

func (c *PlexClient) FetchShow(ctx context.Context, showID string) (*PlexShow, error) {
	var container browseContainer
	if err := c.doXML(ctx, "/library/metadata/"+showID, &container); err != nil {
		return nil, err
	}

	if len(container.Directories) > 0 {
		d := container.Directories[0]
		return &PlexShow{
			ID:            ratingKeyFromDirectory(d),
			Title:         safeTitle(d.Title),
			Summary:       strings.TrimSpace(d.Summary),
			WatchedCount:  d.ViewedLeafCount,
			TotalEpisodes: d.LeafCount,
			CoverPath:     d.Thumb,
			ArtPath:       strings.TrimSpace(d.Art),
		}, nil
	}

	// Some Plex responses encode show metadata as Video nodes.
	if len(container.Videos) > 0 {
		v := container.Videos[0]
		id := strings.TrimSpace(v.RatingKey)
		if id == "" {
			id = showID
		}
		return &PlexShow{
			ID:            id,
			Title:         safeTitle(v.Title),
			Summary:       strings.TrimSpace(v.Summary),
			WatchedCount:  v.ViewedLeafCount,
			TotalEpisodes: v.LeafCount,
			CoverPath:     firstNonEmpty(v.Thumb, v.ParentThumb, v.GrandparentThumb),
			ArtPath:       strings.TrimSpace(v.Art),
		}, nil
	}

	return nil, fmt.Errorf("show %s not found", showID)
}

func (c *PlexClient) FetchSeasons(ctx context.Context, showID string) ([]PlexSeason, error) {
	var container browseContainer
	if err := c.doXML(ctx, "/library/metadata/"+showID+"/children", &container); err != nil {
		return nil, err
	}

	seasons := make([]PlexSeason, 0, len(container.Directories))
	for _, d := range container.Directories {
		if normalizeType(d.Type) != "season" {
			continue
		}
		seasonID := ratingKeyFromDirectory(d)
		if seasonID == "" {
			continue
		}
		seasons = append(seasons, PlexSeason{
			ID:            seasonID,
			SeasonNumber:  d.Index,
			Title:         d.Title,
			WatchedCount:  d.ViewedLeafCount,
			TotalEpisodes: d.LeafCount,
			CoverPath:     d.Thumb,
		})
	}

	sort.Slice(seasons, func(i, j int) bool {
		return seasons[i].SeasonNumber < seasons[j].SeasonNumber
	})

	return seasons, nil
}

func (c *PlexClient) FetchEpisodes(ctx context.Context, seasonID string) ([]PlexEpisode, error) {
	var container browseContainer
	if err := c.doXML(ctx, "/library/metadata/"+seasonID+"/children", &container); err != nil {
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
			Watched:       v.ViewCount > 0,
			ViewOffset:    v.ViewOffset,
			Duration:      v.Duration,
			AddedAt:       toRFC3339(v.AddedAt),
			CoverPath:     firstNonEmpty(v.Thumb, v.ParentThumb, v.GrandparentThumb),
		})
	}

	sort.Slice(episodes, func(i, j int) bool {
		return episodes[i].EpisodeNumber < episodes[j].EpisodeNumber
	})

	return episodes, nil
}

func (c *PlexClient) FetchNextUpEpisode(ctx context.Context, showID string) (*PlexEpisode, error) {
	var container browseContainer
	if err := c.doXML(ctx, "/library/metadata/"+showID+"/allLeaves", &container); err != nil {
		return nil, err
	}

	episodes := make([]PlexEpisode, 0, len(container.Videos))
	for _, v := range container.Videos {
		if v.ViewCount > 0 {
			continue
		}
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
			Watched:       false,
			AddedAt:       toRFC3339(v.AddedAt),
			CoverPath:     firstNonEmpty(v.Thumb, v.ParentThumb, v.GrandparentThumb),
		})
	}

	if len(episodes) == 0 {
		return nil, nil
	}

	sort.Slice(episodes, func(i, j int) bool {
		if episodes[i].SeasonNumber == episodes[j].SeasonNumber {
			return episodes[i].EpisodeNumber < episodes[j].EpisodeNumber
		}
		return episodes[i].SeasonNumber < episodes[j].SeasonNumber
	})

	return &episodes[0], nil
}

func (c *PlexClient) fetchSections(ctx context.Context) ([]plexSection, error) {
	var container browseContainer
	if err := c.doXML(ctx, "/library/sections", &container); err != nil {
		return nil, err
	}

	sections := []plexSection{}
	for _, d := range container.Directories {
		itemType := normalizeType(d.Type)
		if itemType != "movie" && itemType != "show" {
			continue
		}
		if strings.TrimSpace(d.Key) == "" {
			continue
		}
		sections = append(sections, plexSection{Key: d.Key, Type: itemType})
	}
	return sections, nil
}

func (c *PlexClient) doXML(ctx context.Context, endpoint string, out any) error {
	u := strings.TrimRight(c.BaseURL, "/") + endpoint
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return err
	}
	c.setHeaders(req)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("plex request %s: %w", endpoint, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return fmt.Errorf("plex request %s: status %d: %s", endpoint, resp.StatusCode, strings.TrimSpace(string(body)))
	}

	if err := xml.NewDecoder(resp.Body).Decode(out); err != nil {
		return fmt.Errorf("plex decode %s: %w", endpoint, err)
	}

	return nil
}

func toRFC3339(unixSeconds int64) string {
	if unixSeconds <= 0 {
		return ""
	}
	return time.Unix(unixSeconds, 0).UTC().Format(time.RFC3339)
}

func ratingKeyFromDirectory(d browseDirectory) string {
	if strings.TrimSpace(d.RatingKey) != "" {
		return strings.TrimSpace(d.RatingKey)
	}
	if strings.TrimSpace(d.Key) == "" {
		return ""
	}
	return path.Base(strings.TrimRight(d.Key, "/"))
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func safeTitle(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "Unknown Show"
	}
	return value
}

func normalizeType(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}
