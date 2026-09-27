set shell := ["bash", "-cu"]

app_addr := env_var_or_default("PLI_ADDR", "0.0.0.0:8080")
db_path := env_var_or_default("PLI_DB_PATH", "data/pli.db")
bin_path := env_var_or_default("PLI_BIN_PATH", "bin/pli")

# Run the web server.
serve:
    PLI_ADDR="{{app_addr}}" PLI_DB_PATH="{{db_path}}" cargo run --locked

# Run Rust tests, including legacy database compatibility.
test:
    cargo test --locked

# Build the standalone binary with embedded web assets.
build:
    cargo build --release --locked
    mkdir -p "$(dirname "{{bin_path}}")"
    cp target/release/pli "{{bin_path}}"

# Format Rust source.
fmt:
    cargo fmt --all

# Check Rust lints.
lint:
    cargo clippy --locked --all-targets -- -D warnings

# Run source checks and Rust tests.
check:
    cargo fmt --all --check
    cargo clippy --locked --all-targets -- -D warnings
    cargo test --locked

# Test the real app against a local Plex fixture in Chromium.
test-ui:
    npm test

# Run an isolated sample library without changing saved settings.
preview:
    cargo build --locked
    npm run preview
