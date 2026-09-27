use std::path::Path;

use anyhow::{Context, Result};
use chrono::Utc;
use serde::Serialize;
use toasty::Db;
use tokio::sync::Mutex;

#[derive(Debug, Serialize, toasty::Model)]
#[table = "app_config"]
pub(crate) struct Config {
    #[key]
    pub key: String,
    pub value: String,
    #[serde(skip)]
    pub updated_at: String,
}

#[derive(Debug, toasty::Model)]
#[table = "pli_cache"]
struct Cache {
    #[key]
    id: String,
    payload: String,
    expires_at: i64,
}

pub(crate) struct Store {
    db: Mutex<Db>,
}

impl Store {
    /// Opens the existing SQLite database without replacing its settings or media tables.
    pub async fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
            std::fs::create_dir_all(parent)?;
        }
        // Explicit, additive DDL keeps the Go database compatible. All application
        // reads and writes use Toasty; schema pushes must never reset user data.
        let conn = rusqlite::Connection::open(path).context("open SQLite database")?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             CREATE TABLE IF NOT EXISTS app_config (
                 key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS pli_cache (
                 id TEXT PRIMARY KEY, payload TEXT NOT NULL, expires_at INTEGER NOT NULL
             );",
        )?;
        drop(conn);
        let db = Db::builder()
            .models(toasty::models!(Config, Cache))
            .connect(&format!("sqlite:{}", path.display()))
            .await?;
        let store = Self { db: Mutex::new(db) };
        let player = if cfg!(target_os = "macos") {
            "iina"
        } else {
            "vlc"
        };
        for (key, value) in [
            ("app.name", "pli".to_owned()),
            ("app.theme", "dark".to_owned()),
            ("player.default", player.to_owned()),
            ("plex.base_url", "http://127.0.0.1:32400".to_owned()),
            ("plex.token", String::new()),
            ("plex.client_id", uuid::Uuid::new_v4().to_string()),
        ] {
            if store.get(key).await?.is_none() {
                store.set(key, &value).await?;
            }
        }
        Ok(store)
    }

    /// Lists saved configuration in key order.
    pub async fn configs(&self) -> Result<Vec<Config>> {
        let mut db = self.db.lock().await;
        Ok(Config::all()
            .order_by(Config::fields().key().asc())
            .exec(&mut *db)
            .await?)
    }

    /// Reads a setting, distinguishing a missing value from a database error.
    pub async fn get(&self, key: &str) -> Result<Option<String>> {
        let mut db = self.db.lock().await;
        Ok(Config::filter(Config::fields().key().eq(key))
            .first()
            .exec(&mut *db)
            .await?
            .map(|c| c.value))
    }

    /// Persists a setting and invalidates cached library responses atomically.
    pub async fn set(&self, key: &str, value: &str) -> Result<()> {
        self.set_many(&[(key, value)]).await.map(|_| ())
    }

    /// Saves a settings batch in one transaction and returns the resulting configuration.
    pub async fn set_many(&self, settings: &[(&str, &str)]) -> Result<Vec<Config>> {
        let mut db = self.db.lock().await;
        let mut tx = db.transaction().await?;
        let updated_at = Utc::now().to_rfc3339();
        for &(key, value) in settings {
            if let Some(mut config) = Config::filter(Config::fields().key().eq(key))
                .first()
                .exec(&mut tx)
                .await?
            {
                toasty::update!(config {
                    value,
                    updated_at: &updated_at
                })
                .exec(&mut tx)
                .await?;
            } else {
                toasty::create!(Config {
                    key,
                    value,
                    updated_at: &updated_at
                })
                .exec(&mut tx)
                .await?;
            }
        }
        Cache::all().delete().exec(&mut tx).await?;
        let configs = Config::all()
            .order_by(Config::fields().key().asc())
            .exec(&mut tx)
            .await?;
        tx.commit().await?;
        Ok(configs)
    }

    /// Reads an unexpired response from the cache.
    pub async fn cached(&self, id: &str) -> Result<Option<String>> {
        let mut db = self.db.lock().await;
        Ok(Cache::filter(Cache::fields().id().eq(id))
            .first()
            .exec(&mut *db)
            .await?
            .filter(|c| c.expires_at > Utc::now().timestamp())
            .map(|c| c.payload))
    }

    /// Replaces a cached response and removes expired entries.
    pub async fn cache(&self, id: &str, payload: &str, seconds: i64) -> Result<()> {
        let mut db = self.db.lock().await;
        let mut tx = db.transaction().await?;
        let now = Utc::now().timestamp();
        Cache::filter(Cache::fields().expires_at().le(now))
            .delete()
            .exec(&mut tx)
            .await?;
        Cache::filter(Cache::fields().id().eq(id))
            .delete()
            .exec(&mut tx)
            .await?;
        toasty::create!(Cache {
            id,
            payload,
            expires_at: now + seconds
        })
        .exec(&mut tx)
        .await?;
        tx.commit().await?;
        Ok(())
    }

    /// Clears library responses after a watched-state change or deletion.
    pub async fn invalidate(&self) -> Result<()> {
        Cache::all()
            .delete()
            .exec(&mut *self.db.lock().await)
            .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn failed_settings_batch_rolls_back_every_change() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let path = dir.path().join("pli.db");
        let store = Store::open(&path).await?;
        store.set("plex.token", "original-token").await?;
        store.cache("recent", "[]", 60).await?;
        let conn = rusqlite::Connection::open(&path)?;
        conn.execute_batch(
            "CREATE TRIGGER reject_player BEFORE UPDATE ON app_config
            WHEN NEW.key = 'player.default' AND NEW.value = 'rejected'
            BEGIN SELECT RAISE(ABORT, 'test write failure'); END;",
        )?;
        assert!(
            store
                .set_many(&[
                    ("plex.token", "replacement-token"),
                    ("player.default", "rejected")
                ])
                .await
                .is_err()
        );
        assert_eq!(
            store.get("plex.token").await?.as_deref(),
            Some("original-token")
        );
        assert_eq!(store.cached("recent").await?.as_deref(), Some("[]"));
        let configs = store
            .set_many(&[
                ("plex.token", "replacement-token"),
                ("player.default", "vlc"),
            ])
            .await?;
        assert!(
            configs
                .iter()
                .any(|c| c.key == "plex.token" && c.value == "replacement-token")
        );
        assert_eq!(store.get("player.default").await?.as_deref(), Some("vlc"));
        assert!(store.cached("recent").await?.is_none());
        Ok(())
    }

    #[tokio::test]
    async fn preserves_go_database_and_persists_changes() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let path = dir.path().join("pli.db");
        let conn = rusqlite::Connection::open(&path)?;
        conn.execute_batch("CREATE TABLE app_config (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
            INSERT INTO app_config VALUES ('plex.token', 'existing-secret', '2026-01-01');
            CREATE TABLE movies (id INTEGER PRIMARY KEY, title TEXT);
            INSERT INTO movies VALUES (42, 'Keep me');")?;
        let store = Store::open(&path).await?;
        assert_eq!(
            store.get("plex.token").await?.as_deref(),
            Some("existing-secret")
        );
        let client_id = store.get("plex.client_id").await?;
        assert_eq!(
            store.get("plex.base_url").await?.as_deref(),
            Some("http://127.0.0.1:32400")
        );
        store.cache("recent", "[]", 60).await?;
        assert_eq!(store.cached("recent").await?.as_deref(), Some("[]"));
        store.set("plex.base_url", "http://localhost:32401").await?;
        assert!(store.cached("recent").await?.is_none());
        drop(store);
        let reopened = Store::open(&path).await?;
        assert_eq!(reopened.get("plex.client_id").await?, client_id);
        assert_eq!(
            reopened.get("plex.base_url").await?.as_deref(),
            Some("http://localhost:32401")
        );
        assert_eq!(
            conn.query_row("SELECT title FROM movies WHERE id=42", [], |r| r
                .get::<_, String>(0))?,
            "Keep me"
        );
        reopened.cache("expired", "{}", -1).await?;
        assert!(reopened.cached("expired").await?.is_none());
        Ok(())
    }
}
