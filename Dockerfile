# syntax=docker/dockerfile:1.7
FROM rust:1.78-slim-bookworm AS builder

RUN apt-get update && apt-get install -y \
    pkg-config libssl-dev build-essential curl git libudev-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY rust-toolchain.toml Cargo.toml Cargo.lock* Anchor.toml ./
COPY programs ./programs

RUN cargo fetch

COPY . .

RUN cargo build --release --manifest-path programs/ghos/Cargo.toml

FROM debian:bookworm-slim AS runtime

RUN apt-get update && apt-get install -y ca-certificates libssl3 \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -r -u 1001 -m ghos

WORKDIR /home/ghos

COPY --from=builder /app/target/release/libghos.so /usr/local/lib/libghos.so
COPY --from=builder /app/target/deploy /opt/ghos/deploy

USER ghos

ENTRYPOINT ["/bin/sh", "-c"]
CMD ["echo ghos program artifact available at /usr/local/lib/libghos.so"]
