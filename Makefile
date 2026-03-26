.PHONY: help install build test lint format clean anchor-build anchor-test sdk-build cli-install devnet-seed docker

help:
	@echo "ghos make targets"
	@echo "  install       install js deps"
	@echo "  build         anchor build + sdk build"
	@echo "  test          anchor test + sdk test"
	@echo "  lint          prettier + cargo fmt check + ruff"
	@echo "  format        prettier write + cargo fmt + ruff format"
	@echo "  clean         remove target, dist, node_modules"
	@echo "  anchor-build  anchor build only"
	@echo "  anchor-test   anchor test only"
	@echo "  sdk-build     tsc build of the SDK"
	@echo "  cli-install   pip install the Python CLI in editable mode"
	@echo "  devnet-seed   run scripts/devnet_seed.ts against devnet"
	@echo "  docker        build the reproducible runtime image"

install:
	yarn install

build: anchor-build sdk-build

test: anchor-test
	yarn workspace @ghos/sdk test

lint:
	yarn lint
	cargo fmt --all -- --check
	cd cli && ruff check . && cd ..

format:
	yarn format
	cargo fmt --all
	cd cli && ruff format . && cd ..

clean:
	rm -rf target dist node_modules sdk/dist .anchor

anchor-build:
	anchor build

anchor-test:
	anchor test

sdk-build:
	yarn workspace @ghos/sdk build

cli-install:
	cd cli && pip install -e ".[dev]"

devnet-seed:
	yarn ts-node scripts/devnet_seed.ts

docker:
	docker build -t ghos:0.4.1 .
