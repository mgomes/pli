use std::{
    path::PathBuf,
    time::{Duration, Instant},
};

use anyhow::Result;
use tokio::sync::Mutex;

pub(crate) struct ImageCache {
    dir: PathBuf,
    ttl: Duration,
    last_cleanup: Mutex<Instant>,
}

pub(crate) struct Image {
    pub bytes: Vec<u8>,
    pub mime: String,
}

impl ImageCache {
    /// Opens a disk cache and removes expired artwork left by earlier runs.
    pub async fn open(dir: PathBuf, ttl: Duration) -> Result<Self> {
        tokio::fs::create_dir_all(&dir).await?;
        let cache = Self {
            dir,
            ttl,
            last_cleanup: Mutex::new(Instant::now()),
        };
        cache.prune().await?;
        Ok(cache)
    }

    /// Reads artwork only while it is fresh. Expired or damaged entries are misses.
    pub async fn get(&self, key: &str) -> Option<Image> {
        let path = self.dir.join(format!("{key}.image"));
        let metadata = tokio::fs::metadata(&path).await.ok()?;
        if !self.fresh(&metadata) {
            let _ = tokio::fs::remove_file(path).await;
            return None;
        }
        let data = tokio::fs::read(path).await.ok()?;
        let split = data.iter().position(|byte| *byte == b'\n')?;
        let mime = std::str::from_utf8(&data[..split]).ok()?;
        if !supported_mime(mime) {
            return None;
        }
        Some(Image {
            mime: mime.to_owned(),
            bytes: data[split + 1..].to_vec(),
        })
    }

    /// Atomically stores an image and periodically removes expired cache files.
    pub async fn put(&self, key: &str, image: &Image) -> Result<()> {
        if self.ttl.is_zero() {
            return Ok(());
        }
        let path = self.dir.join(format!("{key}.image"));
        let temp = self.dir.join(format!("{}.tmp", uuid::Uuid::new_v4()));
        let mut data = Vec::with_capacity(image.mime.len() + 1 + image.bytes.len());
        data.extend_from_slice(image.mime.as_bytes());
        data.push(b'\n');
        data.extend_from_slice(&image.bytes);
        let write = async {
            tokio::fs::write(&temp, &data).await?;
            tokio::fs::rename(&temp, &path).await
        }
        .await;
        if write.is_err() {
            let _ = tokio::fs::remove_file(&temp).await;
        }
        write?;
        let mut last_cleanup = self.last_cleanup.lock().await;
        if last_cleanup.elapsed() >= Duration::from_secs(3600) {
            self.prune().await?;
            *last_cleanup = Instant::now();
        }
        Ok(())
    }

    fn fresh(&self, metadata: &std::fs::Metadata) -> bool {
        metadata
            .modified()
            .ok()
            .and_then(|time| time.elapsed().ok())
            .is_some_and(|age| age < self.ttl)
    }

    async fn prune(&self) -> Result<()> {
        let mut entries = tokio::fs::read_dir(&self.dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            if path.extension().is_none_or(|ext| ext != "image") {
                continue;
            }
            if let Ok(metadata) = entry.metadata().await
                && metadata.is_file()
                && !self.fresh(&metadata)
            {
                let _ = tokio::fs::remove_file(path).await;
            }
        }
        Ok(())
    }
}

/// Allows raster image formats that can be safely returned by the artwork proxy.
pub(crate) fn supported_mime(mime: &str) -> bool {
    matches!(
        mime,
        "image/jpeg" | "image/png" | "image/webp" | "image/gif" | "image/avif"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs::{File, FileTimes},
        time::SystemTime,
    };

    #[tokio::test]
    async fn expiration_survives_restart_and_removes_old_images() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let cache = ImageCache::open(dir.path().into(), Duration::from_secs(86400)).await?;
        let image = Image {
            bytes: vec![1, 2, 3],
            mime: "image/png".into(),
        };
        cache.put("fresh", &image).await?;
        cache.put("expired", &image).await?;
        cache.put("unused", &image).await?;
        let yesterday = SystemTime::now() - Duration::from_secs(86401);
        for key in ["expired", "unused"] {
            File::open(dir.path().join(format!("{key}.image")))?
                .set_times(FileTimes::new().set_modified(yesterday))?;
        }
        assert!(cache.get("expired").await.is_none());
        assert!(!dir.path().join("expired.image").exists());
        let reopened = ImageCache::open(dir.path().into(), Duration::from_secs(86400)).await?;
        assert!(!dir.path().join("unused.image").exists());
        let hit = reopened.get("fresh").await.unwrap();
        assert_eq!(hit.bytes, image.bytes);
        assert_eq!(hit.mime, image.mime);
        reopened.put("expired", &image).await?;
        assert!(reopened.get("expired").await.is_some());
        let disabled = ImageCache::open(dir.path().into(), Duration::ZERO).await?;
        disabled.put("disabled", &image).await?;
        assert!(disabled.get("disabled").await.is_none());
        assert!(!dir.path().join("disabled.image").exists());
        Ok(())
    }
}
