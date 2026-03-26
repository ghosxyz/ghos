set shell := ["bash", "-cu"]

default:
    @just --list

install:
    yarn install

build:
    anchor build
    yarn workspace @ghos/sdk build

test:
    anchor test
    yarn workspace @ghos/sdk test

fmt:
    yarn format
    cargo fmt --all
    cd cli && ruff format . && cd ..

lint:
    yarn lint
    cargo fmt --all -- --check
    cd cli && ruff check . && cd ..

clean:
    rm -rf target dist node_modules sdk/dist .anchor

devnet-seed:
    yarn ts-node scripts/devnet_seed.ts

docker:
    docker build -t ghos:0.4.1 .
