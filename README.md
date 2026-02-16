# pli

`pli` is a single-binary Plex web app built with Go.

- Backend: `chi` web server
- Persistence: SQLite for config + cache + media snapshot data
- Queries: `sqlc`-generated typed query layer
- Frontend: dark shadcn-inspired design with Lucide icons

## Quick start

```bash
go mod tidy
go run ./cmd/pli
```

Open:

`http://localhost:8080`

## Environment

- `PLI_ADDR` (default `:8080`)
- `PLI_DB_PATH` (default `data/pli.db`)

## SQLite + sqlc

- Schema: `sql/schema.sql`
- Queries: `sql/query.sql`
- sqlc config: `sqlc.yaml`
- Generated code: `internal/db`

Regenerate query code after query/schema changes:

```bash
./bin/sqlc generate
```
