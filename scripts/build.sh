#!/usr/bin/env bash
# Reproducible build entrypoint.
#
# Invoked by the Makefile `build` target and by CI. Pins the Rust toolchain via
# rust-toolchain.toml and the Anchor CLI version via Anchor.toml so two
# contributors on different machines emit the same program bytecode.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

log() {
    printf '[build] %s\n' "$*"
}

require() {
    if ! command -v "$1" >/dev/null 2>&1; then
        printf '[build] missing tool: %s\n' "$1" >&2
        exit 1
    fi
}

require cargo
require anchor
require yarn

log "rust toolchain"
cargo --version
rustc --version

log "anchor toolchain"
anchor --version

log "yarn install (frozen lockfile)"
yarn install --frozen-lockfile

log "cargo check"
cargo check --workspace --all-targets

log "anchor build"
anchor build

log "tsc noEmit over SDK"
yarn workspace @ghos/sdk tsc --noEmit

log "python ruff over CLI"
( cd cli && python -m ruff check . ) || true

log "done"
