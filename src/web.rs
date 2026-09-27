use std::{sync::Arc, time::Duration};

use anyhow::Result as AnyResult;
use reqwest::Method;
use serde::Deserialize;
use serde_json::{Value, json};
use topcoat::{
    Result,
    context::{Cx, app_context},
    router::{
        Body, Layer, LayerFuture, Next, Path, Router,
        content::{Form, Json},
        path_param, request,
        response::{IntoResponse, Response},
        route,
    },
};

use crate::{
    image_cache::{Image, ImageCache, supported_mime},
    plex::{self, Plex},
    store::Store,
    ui,
};

pub(crate) struct App {
    pub store: Store,
    pub images: ImageCache,
}

impl App {
    /// Opens the persistent store and prepares the image cache.
    pub async fn open(path: &std::path::Path, image_ttl: Duration) -> AnyResult<Self> {
        let store = Store::open(path).await?;
        let image_dir = path
            .parent()
            .unwrap_or_else(|| std::path::Path::new("."))
            .join("cache/images-rust");
        let images = ImageCache::open(image_dir, image_ttl).await?;
        Ok(Self { store, images })
    }

    async fn plex(&self) -> AnyResult<Plex> {
        let configs = self.store.configs().await?;
        let value = |key| {
            configs
                .iter()
                .find(|c| c.key == key)
                .map(|c| c.value.as_str())
                .unwrap_or("")
        };
        Plex::new(
            value("plex.base_url"),
            value("plex.token"),
            value("plex.client_id"),
        )
    }
}

/// Builds the Topcoat router for pages, embedded assets, and the Plex API.
pub(crate) fn router(app: App) -> Router {
    Router::builder()
        .app_context(Arc::new(app))
        .layer(Responses)
        .page(ui::home)
        .page(ui::recent)
        .page(ui::movies)
        .page(ui::movie)
        .page(ui::tv)
        .page(ui::show)
        .page(ui::season)
        .page(ui::settings)
        .route(health)
        .route(config)
        .route(update_config)
        .route(recently_added)
        .route(continue_watching)
        .route(movies)
        .route(shows)
        .route(seasons)
        .route(episodes)
        .route(image)
        .route(test_connection)
        .route(auth_start)
        .route(auth_poll)
        .route(play)
        .route(player_context)
        .route(timeline)
        .route(watched)
        .route(delete_media)
        .route(sessions)
        .route(css)
        .route(javascript)
        .route(player_script)
        .route(icons)
        .build()
}

fn app(cx: &Cx) -> &App {
    app_context::<Arc<App>>(cx)
}

struct Responses;

impl Layer for Responses {
    fn path(&self) -> Option<&Path> {
        None
    }

    fn handle<'a>(&'a self, cx: &'a Cx, body: Body, next: Next<'a>) -> LayerFuture<'a> {
        Box::pin(async move {
            let mut response =
                match tokio::time::timeout(Duration::from_secs(60), next.run(cx, body)).await {
                    Ok(result) => result.into_response(cx)?,
                    Err(_) => json_response(
                        504,
                        json!({"error": "The request timed out. Please try again."}),
                    )?,
                };
            if request::uri(cx).path().starts_with("/api/") {
                if response.status().is_client_error() || response.status().is_server_error() {
                    let is_json = response
                        .headers()
                        .get("content-type")
                        .is_some_and(|v| v.as_bytes().starts_with(b"application/json"));
                    if !is_json {
                        let status = response.status();
                        response = json_response(
                            status.as_u16(),
                            json!({"error": status.canonical_reason().unwrap_or("Request failed")}),
                        )?;
                    }
                }
                response
                    .headers_mut()
                    .insert("cache-control", "no-store".parse()?);
            }
            response
                .headers_mut()
                .insert("x-content-type-options", "nosniff".parse()?);
            Ok(response)
        })
    }
}

fn json_response(status: u16, value: Value) -> Result<Response> {
    Ok(Response::builder()
        .status(status)
        .header("Content-Type", "application/json; charset=utf-8")
        .body(Body::from(serde_json::to_vec(&value)?))?)
}

fn api(result: AnyResult<Value>) -> Result<Response> {
    match result {
        Ok(value) => json_response(200, value),
        Err(error) => json_response(502, json!({"error": error.to_string()})),
    }
}

fn bad(message: &str) -> Result<Response> {
    json_response(400, json!({"error": message}))
}
fn ok() -> Value {
    json!({"status": "ok"})
}

#[route(GET "/healthz")]
async fn health() -> Result<Json<Value>> {
    Ok(Json(ok()))
}

#[route(GET "/api/config")]
async fn config(cx: &Cx) -> Result<Response> {
    api(async { Ok(json!({"configs": app(cx).store.configs().await?})) }.await)
}

#[derive(Deserialize)]
struct ConfigInput {
    key: String,
    value: String,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum ConfigUpdate {
    Single(ConfigInput),
    Batch { updates: Vec<ConfigInput> },
}

#[route(PUT "/api/config")]
async fn update_config(cx: &Cx, Json(input): Json<ConfigUpdate>) -> Result<Response> {
    let mut updates = match input {
        ConfigUpdate::Single(input) => vec![input],
        ConfigUpdate::Batch { updates } => updates,
    };
    if updates.is_empty() || updates.len() > 4 {
        return bad("Provide between one and four settings");
    }
    let mut keys = std::collections::HashSet::new();
    for input in &mut updates {
        input.value = input.value.trim().to_owned();
        if !keys.insert(input.key.as_str()) {
            return bad("Each setting may appear only once");
        }
        if let Err(error) = validate_config(input) {
            return bad(&error.to_string());
        }
    }
    api(async {
        let settings: Vec<_> = updates
            .iter()
            .map(|input| (input.key.as_str(), input.value.as_str()))
            .collect();
        let configs = app(cx).store.set_many(&settings).await?;
        Ok(json!({"status": "ok", "configs": configs}))
    }
    .await)
}

fn validate_config(input: &ConfigInput) -> AnyResult<()> {
    anyhow::ensure!(input.value.len() <= 8192, "Configuration value is too long");
    match input.key.as_str() {
        "plex.base_url" => {
            plex::validate_base(&input.value)?;
        }
        "player.default" => {
            anyhow::ensure!(
                matches!(input.value.as_str(), "iina" | "vlc"),
                "Choose IINA or VLC"
            );
        }
        "plex.client_id" => {
            anyhow::ensure!(!input.value.is_empty(), "Client ID is required");
        }
        "plex.token" => {}
        _ => anyhow::bail!("Unknown configuration key"),
    }
    Ok(())
}

#[route(GET "/api/recently-added")]
async fn recently_added(cx: &Cx) -> Result<Response> {
    let result: AnyResult<(Value, bool)> = async {
        let app = app(cx);
        let plex = app.plex().await?;
        let key = plex.cache_key("recently-added");
        if let Some(payload) = app.store.cached(&key).await?
            && let Ok(value) = serde_json::from_str(&payload) {
            return Ok((value, true));
        }
        let nodes = plex.xml("/library/recentlyAdded?X-Plex-Container-Start=0&X-Plex-Container-Size=24").await?;
        let value = json!({"items": nodes.videos.iter().filter(|n| !n.rating_key().is_empty()).map(|n| n.recent()).collect::<Vec<_>>()});
        app.store.cache(&key, &value.to_string(), 45).await?;
        Ok((value, false))
    }.await;
    match result {
        Ok((value, hit)) => {
            let mut response = json_response(200, value)?;
            response
                .headers_mut()
                .insert("x-cache", if hit { "HIT" } else { "MISS" }.parse()?);
            Ok(response)
        }
        Err(e) => api(Err(e)),
    }
}

#[route(GET "/api/continue-watching")]
async fn continue_watching(cx: &Cx) -> Result<Response> {
    api(async {
        let nodes = app(cx).plex().await?.collection("/library/onDeck").await?;
        Ok(json!({"items": nodes.videos.iter().filter(|n| !n.rating_key().is_empty()).map(|n| n.continuing()).collect::<Vec<_>>()}))
    }.await)
}

#[route(GET "/api/movies")]
async fn movies(cx: &Cx) -> Result<Response> {
    api(async { Ok(json!({"movies": app(cx).plex().await?.library("movie").await?.iter().map(|n| n.movie()).collect::<Vec<_>>()})) }.await)
}

#[route(GET "/api/tv/shows")]
async fn shows(cx: &Cx) -> Result<Response> {
    api(async { Ok(json!({"shows": app(cx).plex().await?.library("show").await?.iter().map(|n| n.show()).collect::<Vec<_>>()})) }.await)
}

path_param!(media_id: String, error = bad_request);
path_param!(season_id: String, error = bad_request);
path_param!(pin_id: String, error = bad_request);

#[route(GET "/api/tv/shows/{media_id}/seasons")]
async fn seasons(cx: &Cx) -> Result<Response> {
    let id = path_param::<MediaId>(cx)?;
    if plex::validate_id(id).is_err() {
        return bad("Invalid show ID");
    }
    api(async {
        let plex = app(cx).plex().await?;
        let mut seasons = plex.collection(&format!("/library/metadata/{id}/children")).await?.directories;
        seasons.retain(|n| n.kind == "season");
        seasons.sort_by_key(|n| n.index);
        let mut show = json!({"id": id, "title": "TV Show", "summary": "", "next_up": "", "cover_url": "", "art_url": ""});
        if let Ok(metadata) = plex.xml(&format!("/library/metadata/{id}")).await
            && let Some(node) = metadata.directories.first().or(metadata.videos.first()) {
            show = node.show();
        }
        if let Ok(leaves) = plex.episodes(id, true).await
            && let Some(next) = leaves.iter().find(|e| e.view_count == 0) {
            show["next_up"] = json!(format!("S{:02}E{:02} · {}", next.season_number, next.index, next.title));
        }
        Ok(json!({"show": show, "seasons": seasons.iter().map(|n| n.season()).collect::<Vec<_>>()}))
    }.await)
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct EpisodeQuery {
    show_id: String,
}

#[route(GET "/api/tv/seasons/{season_id}/episodes")]
async fn episodes(cx: &Cx, Form(query): Form<EpisodeQuery>) -> Result<Response> {
    let id = path_param::<SeasonId>(cx)?;
    if plex::validate_id(id).is_err()
        || (!query.show_id.is_empty() && plex::validate_id(&query.show_id).is_err())
    {
        return bad("Invalid season or show ID");
    }
    api(async {
        let plex = app(cx).plex().await?;
        let nodes = plex.episodes(id, false).await?;
        let show_id = if query.show_id.is_empty() { nodes.first().map(|n| n.show_id.as_str()).unwrap_or("") } else { &query.show_id };
        let next = if show_id.is_empty() { None } else { plex.episodes(show_id, true).await.ok().and_then(|nodes| nodes.into_iter().find(|n| n.view_count == 0)) };
        let next_id = next.as_ref().map(|n| n.rating_key()).unwrap_or("");
        let number = nodes.first().map(|n| n.season_number).unwrap_or_default();
        Ok(json!({"season": {"id": id, "show_id": show_id, "season_number": number, "title": format!("Season {number}")},
            "episodes": nodes.iter().map(|n| n.episode(next_id)).collect::<Vec<_>>()}))
    }.await)
}

#[derive(Deserialize)]
struct ImageQuery {
    path: String,
}

#[route(GET "/api/plex/image")]
async fn image(cx: &Cx, Form(query): Form<ImageQuery>) -> Result<Response> {
    if !query.path.starts_with('/')
        || query.path.starts_with("//")
        || query.path.contains("://")
        || query.path.contains('\\')
    {
        return bad("Invalid image path");
    }
    let result: AnyResult<(Image, &str)> = async {
        let app = app(cx);
        let plex = app.plex().await?;
        let key = plex.cache_key(&query.path);
        if let Some(cached) = app.images.get(&key).await {
            return Ok((cached, "HIT"));
        }
        let response = plex.request(Method::GET, &query.path).await?;
        let mime = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .split(';')
            .next()
            .unwrap_or("")
            .to_owned();
        anyhow::ensure!(
            supported_mime(&mime),
            "Plex did not return a supported image"
        );
        let bytes = plex::bounded_body(response, 20 * 1024 * 1024).await?;
        let artwork = Image { bytes, mime };
        let _ = app.images.put(&key, &artwork).await;
        Ok((artwork, "MISS"))
    }
    .await;
    match result {
        Ok((artwork, cache_status)) => Ok(Response::builder()
            .header("Content-Type", artwork.mime)
            .header("X-Cache", cache_status)
            .body(Body::from(artwork.bytes))?),
        Err(e) => api(Err(e)),
    }
}

#[derive(Deserialize)]
struct ConnectionInput {
    base_url: String,
    #[serde(default)]
    token: String,
}

#[route(POST "/api/plex/test")]
async fn test_connection(cx: &Cx, Json(input): Json<ConnectionInput>) -> Result<Response> {
    let result: AnyResult<String> = async {
        let client_id = app(cx)
            .store
            .get("plex.client_id")
            .await?
            .unwrap_or_default();
        Ok(Plex::new(&input.base_url, &input.token, &client_id)?
            .xml("/")
            .await?
            .friendly_name)
    }
    .await;
    json_response(
        200,
        match result {
            Ok(name) => json!({"ok": true, "server_name": name}),
            Err(e) => json!({"ok": false, "error": e.to_string()}),
        },
    )
}

#[route(POST "/api/plex/auth/start")]
async fn auth_start(cx: &Cx) -> Result<Response> {
    api(async { app(cx).plex().await?.auth_start().await }.await)
}

#[derive(Deserialize)]
struct PinQuery {
    code: String,
}

#[route(GET "/api/plex/auth/poll/{pin_id}")]
async fn auth_poll(cx: &Cx, Form(query): Form<PinQuery>) -> Result<Response> {
    let id = path_param::<PinId>(cx)?;
    if id.parse::<u64>().is_err() || query.code.is_empty() {
        return bad("PIN ID and code are required");
    }
    api(async {
        if let Some(token) = app(cx).plex().await?.auth_poll(id, &query.code).await? {
            app(cx).store.set("plex.token", &token).await?;
            Ok(json!({"done": true}))
        } else {
            Ok(json!({"done": false}))
        }
    }
    .await)
}

#[derive(Deserialize)]
struct PlayInput {
    r#type: String,
    id: String,
}

#[route(POST "/api/play")]
async fn play(cx: &Cx, Json(input): Json<PlayInput>) -> Result<Response> {
    if !matches!(input.r#type.as_str(), "movie" | "episode")
        || plex::validate_id(&input.id).is_err()
    {
        return bad("A valid media type and ID are required");
    }
    api(async {
        let plex = app(cx).plex().await?;
        plex.playback(&plex.metadata(&input.id).await?)
    }
    .await)
}

#[derive(Deserialize)]
struct ContextQuery {
    rating_key: String,
}

#[route(GET "/api/player/context")]
async fn player_context(cx: &Cx, Form(query): Form<ContextQuery>) -> Result<Response> {
    if plex::validate_id(&query.rating_key).is_err() {
        return bad("Invalid rating key");
    }
    api(async {
        let plex = app(cx).plex().await?;
        let node = plex.metadata(&query.rating_key).await?;
        let mut next = Value::Null;
        if node.kind == "episode" && !node.show_id.is_empty()
            && let Ok(nodes) = plex.episodes(&node.show_id, true).await
            && let Some(candidate) = nodes.iter().find(|n| n.id != node.id && (n.season_number, n.index) > (node.season_number, node.index))
            && let Ok(metadata) = plex.metadata(candidate.rating_key()).await {
            next = plex.playback(&metadata)?;
        }
        Ok(json!({"rating_key": node.rating_key(), "item_type": node.kind, "title": node.title,
            "display_title": node.display_title(), "duration_ms": node.duration, "view_offset_ms": node.view_offset,
            "markers": node.normalized_markers(), "next": next}))
    }.await)
}

#[derive(Deserialize)]
struct TimelineInput {
    rating_key: String,
    time_ms: i64,
    duration_ms: i64,
    state: String,
}

#[route(POST "/api/timeline")]
async fn timeline(cx: &Cx, Json(input): Json<TimelineInput>) -> Result<Response> {
    if plex::validate_id(&input.rating_key).is_err()
        || input.time_ms < 0
        || input.duration_ms < 0
        || !matches!(
            input.state.as_str(),
            "playing" | "paused" | "stopped" | "buffering"
        )
    {
        return bad("Invalid playback timeline");
    }
    api(async {
        let plex = app(cx).plex().await?;
        plex.command(
            "/:/timeline",
            &[
                ("ratingKey", input.rating_key.clone()),
                ("key", format!("/library/metadata/{}", input.rating_key)),
                ("time", input.time_ms.to_string()),
                ("duration", input.duration_ms.to_string()),
                ("state", input.state),
                ("hasMDE", "1".into()),
                ("playQueueItemID", "0".into()),
            ],
        )
        .await?;
        if input.duration_ms > 0 && input.time_ms as f64 / input.duration_ms as f64 >= 0.9 {
            plex.watched(&input.rating_key, true).await?;
        }
        app(cx).store.invalidate().await?;
        Ok(ok())
    }
    .await)
}

#[derive(Deserialize)]
struct WatchedInput {
    rating_key: String,
    watched: bool,
}

#[route(POST "/api/watched")]
async fn watched(cx: &Cx, Json(input): Json<WatchedInput>) -> Result<Response> {
    if plex::validate_id(&input.rating_key).is_err() {
        return bad("Invalid rating key");
    }
    api(async {
        app(cx)
            .plex()
            .await?
            .watched(&input.rating_key, input.watched)
            .await?;
        app(cx).store.invalidate().await?;
        Ok(ok())
    }
    .await)
}

#[route(DELETE "/api/media/{media_id}")]
async fn delete_media(cx: &Cx) -> Result<Response> {
    let id = path_param::<MediaId>(cx)?;
    if plex::validate_id(id).is_err() {
        return bad("Invalid rating key");
    }
    api(async {
        app(cx)
            .plex()
            .await?
            .request(Method::DELETE, &format!("/library/metadata/{id}"))
            .await?;
        app(cx).store.invalidate().await?;
        Ok(ok())
    }
    .await)
}

#[route(GET "/api/sessions")]
async fn sessions(cx: &Cx) -> Result<Response> {
    api(async {
        let nodes = app(cx).plex().await?.xml("/status/sessions").await?;
        Ok(json!({"sessions": nodes.videos.iter().map(|n| json!({"title": n.title, "rating_key": n.rating_key(), "session_key": n.session_key})).collect::<Vec<_>>()}))
    }.await)
}

fn asset(content_type: &str, bytes: &'static str) -> Result<Response> {
    Ok(Response::builder()
        .header("Content-Type", content_type)
        .header("Cache-Control", "no-cache")
        .body(Body::from(bytes))?)
}

#[route(GET "/static/app.css")]
async fn css() -> Result<Response> {
    asset("text/css; charset=utf-8", include_str!("../static/app.css"))
}
#[route(GET "/static/app.js")]
async fn javascript() -> Result<Response> {
    asset(
        "text/javascript; charset=utf-8",
        include_str!("../static/app.js"),
    )
}
#[route(GET "/static/icons.js")]
async fn icons() -> Result<Response> {
    asset(
        "text/javascript; charset=utf-8",
        include_str!("../static/icons.js"),
    )
}

#[route(GET "/static/player.js")]
async fn player_script() -> Result<Response> {
    asset(
        "text/javascript; charset=utf-8",
        include_str!("../static/player.js"),
    )
}
