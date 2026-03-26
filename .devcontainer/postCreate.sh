#!/usr/bin/env bash
set -euxo pipefail

sudo apt-get update
sudo apt-get install -y pkg-config libssl-dev build-essential libudev-dev

sh -c "$(curl -sSfL https://release.solana.com/v1.18.26/install)" || true
cargo install --git https://github.com/coral-xyz/anchor --tag v0.30.1 anchor-cli --locked || true

corepack enable
yarn install

cd cli && pip install -e ".[dev]" && cd -
