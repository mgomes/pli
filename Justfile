set shell := ["bash", "-cu"]

app_addr := env_var_or_default("PLI_ADDR", ":8080")
db_path := env_var_or_default("PLI_DB_PATH", "data/pli.db")
bin_path := env_var_or_default("PLI_BIN_PATH", "bin/pli")
# Boot the web server.
serve:
	mkdir -p "$PWD/.cache/go-build" "$PWD/.cache/go-mod"
	GOCACHE="$PWD/.cache/go-build" GOMODCACHE="$PWD/.cache/go-mod" PLI_ADDR={{app_addr}} PLI_DB_PATH={{db_path}} go run ./cmd/pli

# Run all Go tests.
test:
	mkdir -p "$PWD/.cache/go-build" "$PWD/.cache/go-mod"
	GOCACHE="$PWD/.cache/go-build" GOMODCACHE="$PWD/.cache/go-mod" go test ./...

# Build the pli binary.
build:
	mkdir -p "$PWD/.cache/go-build" "$PWD/.cache/go-mod" "$(dirname "{{bin_path}}")"
	GOCACHE="$PWD/.cache/go-build" GOMODCACHE="$PWD/.cache/go-mod" go build -o "{{bin_path}}" ./cmd/pli

# Refresh sqlc-generated query code.
sqlc:
	./bin/sqlc generate
