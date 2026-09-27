use std::time::Duration;

use anyhow::{Context, Result, bail, ensure};
use reqwest::{Client, Method, Response};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use url::Url;

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
pub(crate) struct Container {
    #[serde(rename = "@friendlyName")]
    pub friendly_name: String,
    #[serde(rename = "@totalSize")]
    pub total_size: Option<usize>,
    #[serde(rename = "Video")]
    pub videos: Vec<Node>,
    #[serde(rename = "Directory")]
    pub directories: Vec<Node>,
}

#[derive(Debug, Default, Deserialize, Clone)]
#[serde(default)]
pub(crate) struct Node {
    #[serde(rename = "@ratingKey")]
    pub id: String,
    #[serde(rename = "@key")]
    pub key: String,
    #[serde(rename = "@type")]
    pub kind: String,
    #[serde(rename = "@title")]
    pub title: String,
    #[serde(rename = "@grandparentRatingKey")]
    pub show_id: String,
    #[serde(rename = "@grandparentTitle")]
    pub show_title: String,
    #[serde(rename = "@parentRatingKey")]
    pub season_id: String,
    #[serde(rename = "@parentIndex")]
    pub season_number: i64,
    #[serde(rename = "@index")]
    pub index: i64,
    #[serde(rename = "@year")]
    pub year: i64,
    #[serde(rename = "@addedAt")]
    pub added_at: i64,
    #[serde(rename = "@viewCount")]
    pub view_count: i64,
    #[serde(rename = "@viewOffset")]
    pub view_offset: i64,
    #[serde(rename = "@duration")]
    pub duration: i64,
    #[serde(rename = "@leafCount")]
    pub total: i64,
    #[serde(rename = "@viewedLeafCount")]
    pub watched: i64,
    #[serde(rename = "@thumb")]
    pub thumb: String,
    #[serde(rename = "@parentThumb")]
    pub parent_thumb: String,
    #[serde(rename = "@grandparentThumb")]
    pub show_thumb: String,
    #[serde(rename = "@art")]
    pub art: String,
    #[serde(rename = "@grandparentArt")]
    pub show_art: String,
    #[serde(rename = "@summary")]
    pub summary: String,
    #[serde(rename = "@rating")]
    pub rating: String,
    #[serde(rename = "@audienceRating")]
    pub audience_rating: String,
    #[serde(rename = "@contentRating")]
    pub content_rating: String,
    #[serde(rename = "@tagline")]
    pub tagline: String,
    #[serde(rename = "@studio")]
    pub studio: String,
    #[serde(rename = "@sessionKey")]
    pub session_key: String,
    #[serde(rename = "Genre")]
    pub genres: Vec<Tag>,
    #[serde(rename = "Director")]
    pub directors: Vec<Tag>,
    #[serde(rename = "Role")]
    pub actors: Vec<Tag>,
    #[serde(rename = "Media")]
    pub media: Vec<Media>,
    #[serde(rename = "Marker")]
    pub markers: Vec<Marker>,
}

#[derive(Debug, Default, Deserialize, Clone)]
#[serde(default)]
pub(crate) struct Tag {
    #[serde(rename = "@tag")]
    tag: String,
}

#[derive(Debug, Default, Deserialize, Clone)]
#[serde(default)]
pub(crate) struct Media {
    #[serde(rename = "@videoResolution")]
    resolution: String,
    #[serde(rename = "@audioCodec")]
    audio_codec: String,
    #[serde(rename = "@audioChannels")]
    audio_channels: i64,
    #[serde(rename = "Part")]
    pub parts: Vec<Part>,
}

#[derive(Debug, Default, Deserialize, Clone)]
pub(crate) struct Part {
    #[serde(rename = "@key", default)]
    pub key: String,
}

#[derive(Debug, Default, Deserialize, Clone)]
#[serde(default)]
pub(crate) struct Marker {
    #[serde(rename = "@type")]
    kind: String,
    #[serde(rename = "@startTimeOffset")]
    start: i64,
    #[serde(rename = "@endTimeOffset")]
    end: i64,
    #[serde(rename = "@final")]
    final_marker: String,
}

impl Node {
    /// Returns a directory's rating key, including Plex's path-only representation.
    pub fn rating_key(&self) -> &str {
        if self.id.trim().is_empty() {
            self.key
                .trim_end_matches('/')
                .rsplit('/')
                .next()
                .unwrap_or("")
        } else {
            self.id.trim()
        }
    }

    /// Formats the title used by the external player's window.
    pub fn display_title(&self) -> String {
        let title = self.title.trim();
        let show = self.show_title.trim();
        if self.kind != "episode" || show.is_empty() {
            return title.to_owned();
        }
        if title.is_empty() {
            return show.to_owned();
        }
        if self.season_number > 0 && self.index > 0 {
            format!(
                "{show} · S{:02}E{:02} · {title}",
                self.season_number, self.index
            )
        } else {
            format!("{show} · {title}")
        }
    }

    /// Converts Plex's movie metadata into the browser API representation.
    pub fn movie(&self) -> Value {
        let media = self.media.first().cloned().unwrap_or_default();
        json!({
            "id": self.rating_key(), "title": self.title, "year": self.year,
            "watched": self.view_count > 0, "view_offset": self.view_offset, "duration": self.duration,
            "added_at": timestamp(self.added_at), "cover_url": image_url(&self.thumb), "art_url": image_url(&self.art),
            "summary": self.summary, "rating": self.rating, "audience_rating": self.audience_rating,
            "content_rating": self.content_rating, "tagline": self.tagline, "studio": self.studio,
            "genres": tags(&self.genres, usize::MAX), "directors": tags(&self.directors, usize::MAX),
            "actors": tags(&self.actors, 10), "video_resolution": media.resolution,
            "audio_codec": media.audio_codec, "audio_channels": media.audio_channels
        })
    }

    /// Converts show metadata without fetching every episode in the library.
    pub fn show(&self) -> Value {
        json!({"id": self.rating_key(), "title": self.title, "summary": self.summary,
            "watched_count": self.watched, "total_episodes": self.total,
            "next_up": if self.total > self.watched { "Continue watching" } else { "" },
            "cover_url": image_url(first(&[&self.thumb, &self.parent_thumb, &self.show_thumb])), "art_url": image_url(&self.art)})
    }

    /// Converts season metadata into its episode counts and ordering.
    pub fn season(&self) -> Value {
        json!({"id": self.rating_key(), "season_number": self.index, "title": self.title,
            "watched_count": self.watched, "total_episodes": self.total})
    }

    /// Converts episode metadata and marks the next unwatched episode.
    pub fn episode(&self, next_id: &str) -> Value {
        json!({"id": self.rating_key(), "season_number": self.season_number, "episode_number": self.index,
            "title": self.title, "summary": self.summary, "watched": self.view_count > 0,
            "view_offset": self.view_offset, "duration": self.duration,
            "is_next_up": !next_id.is_empty() && self.rating_key() == next_id, "added_at": timestamp(self.added_at),
            "cover_url": image_url(&self.thumb)})
    }

    /// Converts recent additions, retaining artwork and metadata for the Cinema hero.
    pub fn recent(&self) -> Value {
        let (headline, subline) = if self.kind == "episode" {
            (
                format!(
                    "{} S{:02}E{:02}",
                    self.show_title, self.season_number, self.index
                ),
                self.title.clone(),
            )
        } else {
            (
                self.title.clone(),
                if self.year > 0 {
                    self.year.to_string()
                } else {
                    String::new()
                },
            )
        };
        json!({"id": self.rating_key(), "type": self.kind, "show_id": self.show_id,
            "headline": headline, "subline": subline,
            "title": if self.kind == "episode" { &self.show_title } else { &self.title },
            "added_at": timestamp(self.added_at), "year": self.year, "duration": self.duration,
            "summary": self.summary, "genres": tags(&self.genres, 3), "directors": tags(&self.directors, 2),
            "art_url": image_url(first(&[&self.art, &self.show_art])),
            "cover_url": image_url(first(&[&self.show_thumb, &self.parent_thumb, &self.thumb]))})
    }

    /// Converts on-deck entries into resumable cards.
    pub fn continuing(&self) -> Value {
        let subtitle = if self.kind == "episode" {
            format!(
                "S{:02}E{:02} · {}",
                self.season_number, self.index, self.title
            )
        } else if self.year > 0 {
            self.year.to_string()
        } else {
            String::new()
        };
        json!({"id": self.rating_key(), "type": self.kind, "show_id": self.show_id,
            "title": if self.kind == "episode" { &self.show_title } else { &self.title }, "subtitle": subtitle,
            "cover_url": image_url(first(&[&self.show_thumb, &self.parent_thumb, &self.thumb])),
            "art_url": image_url(first(&[&self.art, &self.show_art])),
            "view_offset": self.view_offset, "duration": self.duration})
    }

    /// Filters invalid markers and orders valid intro and credits ranges.
    pub fn normalized_markers(&self) -> Vec<Value> {
        let mut markers: Vec<_> = self
            .markers
            .iter()
            .filter(|m| !m.kind.trim().is_empty() && m.start >= 0 && m.end > m.start)
            .collect();
        markers.sort_by_key(|m| (m.start, m.end));
        markers
            .into_iter()
            .map(|m| {
                json!({"type": m.kind.trim().to_lowercase(), "start_ms": m.start,
            "end_ms": m.end, "final": matches!(m.final_marker.as_str(), "1" | "true")})
            })
            .collect()
    }
}

#[derive(Clone)]
pub(crate) struct Plex {
    http: Client,
    base: Url,
    token: String,
    client_id: String,
}

impl Plex {
    /// Builds a bounded HTTP client using the configured Plex server origin.
    pub fn new(base: &str, token: &str, client_id: &str) -> Result<Self> {
        let base = validate_base(base)?;
        let http = Client::builder()
            .timeout(Duration::from_secs(20))
            .connect_timeout(Duration::from_secs(5))
            .redirect(reqwest::redirect::Policy::none())
            .build()?;
        Ok(Self {
            http,
            base,
            token: token.trim().into(),
            client_id: client_id.into(),
        })
    }

    /// Namespaces caches by server and credentials so switching servers cannot reuse another library.
    pub fn cache_key(&self, path: &str) -> String {
        const HEX: &[u8; 16] = b"0123456789abcdef";
        Sha256::digest(format!("{}\0{}\0{path}", self.base, self.token))
            .iter()
            .flat_map(|byte| {
                [
                    HEX[(byte >> 4) as usize] as char,
                    HEX[(byte & 15) as usize] as char,
                ]
            })
            .collect()
    }

    fn endpoint(&self, path: &str) -> Result<Url> {
        ensure!(
            path.starts_with('/')
                && !path.starts_with("//")
                && !path.contains('\\')
                && !path.contains("://"),
            "invalid Plex path"
        );
        Ok(Url::parse(&format!(
            "{}{path}",
            self.base.as_str().trim_end_matches('/')
        ))?)
    }

    /// Sends a Plex request without exposing credentials in errors or following redirects.
    pub async fn request(&self, method: Method, path: &str) -> Result<Response> {
        let response = self
            .http
            .request(method, self.endpoint(path)?)
            .header("X-Plex-Token", &self.token)
            .header("X-Plex-Client-Identifier", &self.client_id)
            .header("X-Plex-Product", "pli")
            .header("Accept", "application/xml")
            .send()
            .await
            .map_err(|_| {
                anyhow::anyhow!("Cannot reach Plex. Check the server address and connection.")
            })?;
        ensure!(
            response.status().is_success(),
            "Plex returned HTTP {}",
            response.status().as_u16()
        );
        Ok(response)
    }

    /// Fetches and decodes Plex XML within a fixed memory limit.
    pub async fn xml(&self, path: &str) -> Result<Container> {
        let bytes = bounded_body(self.request(Method::GET, path).await?, 32 * 1024 * 1024).await?;
        quick_xml::de::from_reader(bytes.as_slice()).context("Plex returned invalid XML")
    }

    /// Collects all pages of a Plex library response.
    pub async fn collection(&self, path: &str) -> Result<Container> {
        let mut result = Container::default();
        let mut offset = 0;
        loop {
            let separator = if path.contains('?') { '&' } else { '?' };
            let mut page = self
                .xml(&format!(
                    "{path}{separator}X-Plex-Container-Start={offset}&X-Plex-Container-Size=500"
                ))
                .await?;
            let size = page.videos.len() + page.directories.len();
            offset += size;
            let more = page.total_size.is_some_and(|total| offset < total);
            result.videos.append(&mut page.videos);
            result.directories.append(&mut page.directories);
            if !more || size == 0 {
                break;
            }
            ensure!(
                offset <= 100_000,
                "Plex library pagination exceeded its limit"
            );
        }
        Ok(result)
    }

    /// Loads movies or shows across all matching Plex libraries.
    pub async fn library(&self, kind: &str) -> Result<Vec<Node>> {
        let sections = self.xml("/library/sections").await?;
        let mut nodes = Vec::new();
        for section in sections.directories.into_iter().filter(|s| s.kind == kind) {
            validate_id(&section.key)?;
            let type_id = if kind == "movie" { 1 } else { 2 };
            let result = self
                .collection(&format!(
                    "/library/sections/{}/all?type={type_id}",
                    section.key
                ))
                .await?;
            nodes.extend(if kind == "movie" {
                result.videos
            } else {
                result.directories
            });
        }
        nodes.retain(|n| !n.rating_key().is_empty() && (n.kind.is_empty() || n.kind == kind));
        nodes.sort_by(|a, b| a.title.cmp(&b.title));
        let mut seen = std::collections::HashSet::new();
        nodes.retain(|n| seen.insert(n.rating_key().to_owned()));
        Ok(nodes)
    }

    /// Loads playable metadata, explicitly requesting Plex's intro and credits markers.
    pub async fn metadata(&self, id: &str) -> Result<Node> {
        validate_id(id)?;
        let container = self
            .xml(&format!("/library/metadata/{id}?includeMarkers=1"))
            .await?;
        let mut node = container
            .videos
            .into_iter()
            .next()
            .context("Plex returned no playable metadata")?;
        ensure!(
            node.media
                .iter()
                .any(|m| m.parts.iter().any(|p| !p.key.is_empty())),
            "Plex returned no playable parts"
        );
        if node.id.is_empty() {
            node.id = id.into();
        }
        Ok(node)
    }

    /// Loads episodes in season and episode order, including specials.
    pub async fn episodes(&self, id: &str, leaves: bool) -> Result<Vec<Node>> {
        validate_id(id)?;
        let suffix = if leaves { "allLeaves" } else { "children" };
        let mut nodes = self
            .collection(&format!("/library/metadata/{id}/{suffix}"))
            .await?
            .videos;
        nodes.retain(|n| !n.rating_key().is_empty());
        nodes.sort_by(|a, b| {
            (a.season_number, a.index, &a.id).cmp(&(b.season_number, b.index, &b.id))
        });
        Ok(nodes)
    }

    /// Anchors media URLs to the configured server while preserving Plex's query parameters.
    pub fn stream_url(&self, part: &str) -> Result<Url> {
        let part = self.base.join(part)?;
        let mut stream = self.base.clone();
        stream.set_path(part.path());
        stream.set_query(part.query());
        stream.set_fragment(None);
        if !self.token.is_empty() && !stream.query_pairs().any(|(k, _)| k == "X-Plex-Token") {
            stream
                .query_pairs_mut()
                .append_pair("X-Plex-Token", &self.token);
        }
        Ok(stream)
    }

    /// Returns the existing external-player handoff contract.
    pub fn playback(&self, node: &Node) -> Result<Value> {
        let part = node
            .media
            .iter()
            .flat_map(|m| &m.parts)
            .find(|p| !p.key.is_empty())
            .context("No playable part")?;
        Ok(
            json!({"title": node.title, "display_title": node.display_title(),
            "stream_url": self.stream_url(&part.key)?.as_str(), "rating_key": node.rating_key(),
            "duration_ms": node.duration, "view_offset_ms": node.view_offset}),
        )
    }

    /// Sends a timeline, scrobble, or progress request to Plex.
    pub async fn command(&self, path: &str, params: &[(&str, String)]) -> Result<()> {
        let query = url::form_urlencoded::Serializer::new(String::new())
            .extend_pairs(params.iter().map(|(k, v)| (*k, v)))
            .finish();
        self.request(Method::GET, &format!("{path}?{query}"))
            .await?;
        Ok(())
    }

    /// Sets watched status and clears the resume offset when marking unwatched.
    pub async fn watched(&self, id: &str, watched: bool) -> Result<()> {
        validate_id(id)?;
        let action = if watched { "scrobble" } else { "unscrobble" };
        self.command(
            &format!("/:/{action}"),
            &[
                ("key", id.into()),
                ("identifier", "com.plexapp.plugins.library".into()),
            ],
        )
        .await?;
        if !watched {
            self.command(
                "/:/progress",
                &[
                    ("key", format!("/library/metadata/{id}")),
                    ("identifier", "com.plexapp.plugins.library".into()),
                    ("time", "0".into()),
                    ("state", "stopped".into()),
                ],
            )
            .await?;
        }
        Ok(())
    }

    /// Creates a short-lived sign-in PIN with Plex's official authentication service.
    pub async fn auth_start(&self) -> Result<Value> {
        let response = self
            .http
            .post("https://plex.tv/api/v2/pins")
            .header("Accept", "application/json")
            .form(&[
                ("strong", "true"),
                ("X-Plex-Product", "pli"),
                ("X-Plex-Client-Identifier", &self.client_id),
            ])
            .send()
            .await
            .map_err(|_| anyhow::anyhow!("Cannot reach Plex sign-in"))?;
        ensure!(
            response.status().is_success(),
            "Plex sign-in returned HTTP {}",
            response.status().as_u16()
        );
        let pin: Value = response.json().await?;
        let code = pin["code"].as_str().context("Plex returned no PIN code")?;
        let id = pin["id"].as_u64().context("Plex returned no PIN ID")?;
        let query = url::form_urlencoded::Serializer::new(String::new())
            .extend_pairs([
                ("clientID", self.client_id.as_str()),
                ("code", code),
                ("context[device][product]", "pli"),
            ])
            .finish();
        Ok(
            json!({"pin_id": id, "code": code, "auth_url": format!("https://app.plex.tv/auth#?{query}")}),
        )
    }

    /// Polls a sign-in PIN, treating Plex rate limits as pending authentication.
    pub async fn auth_poll(&self, id: &str, code: &str) -> Result<Option<String>> {
        ensure!(id.parse::<u64>().is_ok(), "invalid PIN ID");
        let response = self
            .http
            .get(format!("https://plex.tv/api/v2/pins/{id}"))
            .header("Accept", "application/json")
            .header("X-Plex-Client-Identifier", &self.client_id)
            .query(&[("code", code)])
            .send()
            .await
            .map_err(|_| anyhow::anyhow!("Cannot reach Plex sign-in"))?;
        if response.status().as_u16() == 429 {
            return Ok(None);
        }
        ensure!(
            response.status().is_success(),
            "Plex sign-in returned HTTP {}",
            response.status().as_u16()
        );
        let pin: Value = response.json().await?;
        Ok(pin["authToken"]
            .as_str()
            .filter(|t| !t.is_empty())
            .map(str::to_owned))
    }
}

/// Validates server addresses before storing or contacting them.
pub(crate) fn validate_base(value: &str) -> Result<Url> {
    let url = Url::parse(value.trim()).context("Enter a valid Plex server URL")?;
    ensure!(
        matches!(url.scheme(), "http" | "https")
            && url.host_str().is_some()
            && url.username().is_empty()
            && url.password().is_none()
            && url.query().is_none()
            && url.fragment().is_none(),
        "Use an http or https server URL without credentials, query, or fragment"
    );
    Ok(url)
}

/// Rejects rating keys that could change the requested Plex endpoint.
pub(crate) fn validate_id(id: &str) -> Result<()> {
    ensure!(
        !id.is_empty()
            && id.len() <= 128
            && id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'),
        "invalid media ID"
    );
    Ok(())
}

/// Reads a bounded response body, including when Content-Length is absent.
pub(crate) async fn bounded_body(mut response: Response, limit: usize) -> Result<Vec<u8>> {
    if response.content_length().is_some_and(|n| n > limit as u64) {
        bail!("Plex response is too large");
    }
    let mut data = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        ensure!(
            data.len() + chunk.len() <= limit,
            "Plex response is too large"
        );
        data.extend_from_slice(&chunk);
    }
    Ok(data)
}

fn image_url(path: &str) -> String {
    if path.is_empty() {
        return String::new();
    }
    let query = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("path", path)
        .finish();
    format!("/api/plex/image?{query}")
}

fn first<'a>(values: &[&'a str]) -> &'a str {
    values
        .iter()
        .map(|v| v.trim())
        .find(|v| !v.is_empty())
        .unwrap_or("")
}

fn tags(values: &[Tag], limit: usize) -> Vec<&str> {
    values
        .iter()
        .map(|v| v.tag.trim())
        .filter(|v| !v.is_empty())
        .take(limit)
        .collect()
}

fn timestamp(seconds: i64) -> String {
    if seconds <= 0 {
        return String::new();
    }
    chrono::DateTime::from_timestamp(seconds, 0)
        .map(|t| t.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_keys_preserve_existing_names_and_connection_isolation() -> Result<()> {
        let plex = Plex::new("http://localhost:32400", "fixture-token", "pli")?;
        let path = "/library/metadata/42/thumb";
        let key = plex.cache_key(path);
        assert_eq!(
            key,
            "c3450541035ee4b2bfc6847c0e60dc46cead3d8ae0973ee38930aedf9f3c2206"
        );
        assert_ne!(key, plex.cache_key("/library/metadata/43/thumb"));
        assert_ne!(
            key,
            Plex::new("http://darwin:32400", "fixture-token", "pli")?.cache_key(path)
        );
        assert_ne!(
            key,
            Plex::new("http://localhost:32400", "different-token", "pli")?.cache_key(path)
        );
        Ok(())
    }

    #[test]
    fn stream_urls_use_configured_origin() -> Result<()> {
        let plex = Plex::new("https://plex.example:32400", "secret + &", "pli")?;
        for part in [
            "/library/parts/1/file.mkv?download=1",
            "http://localhost:32400/library/parts/1/file.mkv?download=1",
        ] {
            let url = plex.stream_url(part)?;
            assert_eq!(url.host_str(), Some("plex.example"));
            assert_eq!(
                url.query_pairs()
                    .find(|(k, _)| k == "X-Plex-Token")
                    .unwrap()
                    .1,
                "secret + &"
            );
            assert!(url.query_pairs().any(|(k, v)| k == "download" && v == "1"));
        }
        assert!(validate_id("../settings").is_err());
        assert!(validate_base("file:///etc/passwd").is_err());
        assert!(plex.endpoint("//another-host/image").is_err());
        Ok(())
    }

    #[test]
    fn xml_markers_titles_and_specials() -> Result<()> {
        let c: Container = quick_xml::de::from_str(
            r#"<MediaContainer><Video type="episode" title="Hello &amp; Goodbye" grandparentTitle="Show" parentIndex="2" index="3"><Marker type=" Credits " startTimeOffset="100" endTimeOffset="200" final="1"/><Marker type="intro" startTimeOffset="10" endTimeOffset="50"/><Marker type="intro" startTimeOffset="50" endTimeOffset="50"/></Video></MediaContainer>"#,
        )?;
        let node = &c.videos[0];
        assert_eq!(node.display_title(), "Show · S02E03 · Hello & Goodbye");
        let markers = node.normalized_markers();
        assert_eq!(markers.len(), 2);
        assert_eq!(markers[0]["type"], "intro");
        assert_eq!(markers[1]["final"], true);
        Ok(())
    }
}
