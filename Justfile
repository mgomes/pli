set shell := ["bash", "-cu"]

app_addr := env_var_or_default("PLI_ADDR", ":8080")
db_path := env_var_or_default("PLI_DB_PATH", "data/pli.db")
# Boot the web server.
serve:
	mkdir -p "$PWD/.cache/go-build" "$PWD/.cache/go-mod"
	GOCACHE="$PWD/.cache/go-build" GOMODCACHE="$PWD/.cache/go-mod" PLI_ADDR={{app_addr}} PLI_DB_PATH={{db_path}} go run ./cmd/pli

# Run all Go tests.
test:
	mkdir -p "$PWD/.cache/go-build" "$PWD/.cache/go-mod"
	GOCACHE="$PWD/.cache/go-build" GOMODCACHE="$PWD/.cache/go-mod" go test ./...

# Build all packages.
build:
	mkdir -p "$PWD/.cache/go-build" "$PWD/.cache/go-mod"
	GOCACHE="$PWD/.cache/go-build" GOMODCACHE="$PWD/.cache/go-mod" go build ./...

# Refresh sqlc-generated query code.
sqlc:
	./bin/sqlc generate

# Package the IINA plugin as an installable .iinaplgz file.
iina-plugin:
	/Applications/IINA.app/Contents/MacOS/iina-plugin pack iina-plugin
