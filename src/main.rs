mod image_cache;
mod plex;
mod store;
mod ui;
mod web;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let addr = std::env::var("PLI_ADDR").unwrap_or_else(|_| "0.0.0.0:8080".into());
    let path = std::env::var("PLI_DB_PATH").unwrap_or_else(|_| "data/pli.db".into());
    let image_ttl = std::env::var("PLI_IMAGE_CACHE_TTL_SECS")
        .unwrap_or_else(|_| "86400".into())
        .parse::<u64>()
        .map_err(|_| anyhow::anyhow!("PLI_IMAGE_CACHE_TTL_SECS must be a nonnegative integer"))?;
    let app = web::App::open(
        std::path::Path::new(&path),
        std::time::Duration::from_secs(image_ttl),
    )
    .await?;
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    eprintln!("pli listening on http://{}", listener.local_addr()?);
    topcoat::serve(listener, web::router(app)).await?;
    Ok(())
}
