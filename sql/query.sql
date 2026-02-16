-- name: UpsertConfig :exec
INSERT INTO app_config (key, value, updated_at)
VALUES (?, ?, ?)
ON CONFLICT(key)
DO UPDATE SET
  value = excluded.value,
  updated_at = excluded.updated_at;

-- name: InsertConfigIfNotExists :exec
INSERT OR IGNORE INTO app_config (key, value, updated_at)
VALUES (?, ?, ?);

-- name: GetConfig :one
SELECT key, value, updated_at
FROM app_config
WHERE key = ?;

-- name: ListConfigs :many
SELECT key, value, updated_at
FROM app_config
ORDER BY key;

-- name: UpsertCacheItem :exec
INSERT INTO cache_items (namespace, key, payload, expires_at, updated_at)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT(namespace, key)
DO UPDATE SET
  payload = excluded.payload,
  expires_at = excluded.expires_at,
  updated_at = excluded.updated_at;

-- name: GetCacheItem :one
SELECT namespace, key, payload, expires_at, updated_at
FROM cache_items
WHERE namespace = ? AND key = ?;

-- name: DeleteExpiredCacheItems :exec
DELETE FROM cache_items
WHERE expires_at IS NOT NULL AND expires_at <= ?;

-- name: CountShows :one
SELECT COUNT(*)
FROM shows;

-- name: InsertShow :exec
INSERT INTO shows (id, title, summary, added_at, updated_at)
VALUES (?, ?, ?, ?, ?);

-- name: InsertSeason :exec
INSERT INTO seasons (id, show_id, season_number, title)
VALUES (?, ?, ?, ?);

-- name: InsertEpisode :exec
INSERT INTO episodes (id, show_id, season_id, episode_number, title, watched, added_at)
VALUES (?, ?, ?, ?, ?, ?, ?);

-- name: InsertMovie :exec
INSERT INTO movies (id, title, release_year, watched, added_at)
VALUES (?, ?, ?, ?, ?);

-- name: ListMovies :many
SELECT id, title, release_year, watched, added_at
FROM movies
ORDER BY added_at DESC, id DESC;

-- name: GetShow :one
SELECT id, title, summary, added_at, updated_at
FROM shows
WHERE id = ?;

-- name: ListTVShows :many
SELECT
  s.id,
  s.title,
  CAST(COALESCE(SUM(CASE WHEN e.watched = 1 THEN 1 ELSE 0 END), 0) AS INTEGER) AS watched_count,
  CAST(COALESCE(COUNT(e.id), 0) AS INTEGER) AS total_episodes,
  CAST(COALESCE((
    SELECT sn.season_number
    FROM episodes e2
    JOIN seasons sn ON sn.id = e2.season_id
    WHERE e2.show_id = s.id AND e2.watched = 0
    ORDER BY sn.season_number, e2.episode_number
    LIMIT 1
  ), 0) AS INTEGER) AS next_up_season,
  CAST(COALESCE((
    SELECT e2.episode_number
    FROM episodes e2
    JOIN seasons sn ON sn.id = e2.season_id
    WHERE e2.show_id = s.id AND e2.watched = 0
    ORDER BY sn.season_number, e2.episode_number
    LIMIT 1
  ), 0) AS INTEGER) AS next_up_episode,
  CAST(COALESCE((
    SELECT e2.title
    FROM episodes e2
    JOIN seasons sn ON sn.id = e2.season_id
    WHERE e2.show_id = s.id AND e2.watched = 0
    ORDER BY sn.season_number, e2.episode_number
    LIMIT 1
  ), '') AS TEXT) AS next_up_title
FROM shows s
LEFT JOIN episodes e ON e.show_id = s.id
GROUP BY s.id, s.title
ORDER BY s.title;

-- name: ListSeasonsByShow :many
SELECT
  sn.id,
  sn.show_id,
  sn.season_number,
  sn.title,
  CAST(COALESCE(SUM(CASE WHEN e.watched = 1 THEN 1 ELSE 0 END), 0) AS INTEGER) AS watched_count,
  CAST(COALESCE(COUNT(e.id), 0) AS INTEGER) AS total_episodes
FROM seasons sn
LEFT JOIN episodes e ON e.season_id = sn.id
WHERE sn.show_id = ?
GROUP BY sn.id, sn.show_id, sn.season_number, sn.title
ORDER BY sn.season_number;

-- name: GetSeason :one
SELECT id, show_id, season_number, title
FROM seasons
WHERE id = ?;

-- name: ListEpisodesBySeason :many
SELECT
  e.id,
  e.show_id,
  e.season_id,
  sn.season_number,
  e.episode_number,
  e.title,
  e.watched,
  e.added_at,
  CASE
    WHEN e.id = (
      SELECT e2.id
      FROM episodes e2
      JOIN seasons sn2 ON sn2.id = e2.season_id
      WHERE e2.show_id = e.show_id AND e2.watched = 0
      ORDER BY sn2.season_number, e2.episode_number
      LIMIT 1
    ) THEN 1
    ELSE 0
  END AS is_next_up
FROM episodes e
JOIN seasons sn ON sn.id = e.season_id
WHERE e.season_id = ?
ORDER BY e.episode_number;

-- name: ListRecentlyAdded :many
SELECT item_type, item_id, headline, subline, added_at
FROM (
  SELECT
    'movie' AS item_type,
    m.id AS item_id,
    m.title AS headline,
    printf('%d', m.release_year) AS subline,
    m.added_at AS added_at
  FROM movies m

  UNION ALL

  SELECT
    'episode' AS item_type,
    e.id AS item_id,
    sh.title || ' ' || printf('S%02dE%02d', sn.season_number, e.episode_number) AS headline,
    e.title AS subline,
    e.added_at AS added_at
  FROM episodes e
  JOIN seasons sn ON sn.id = e.season_id
  JOIN shows sh ON sh.id = e.show_id
) items
ORDER BY added_at DESC
LIMIT ?;
