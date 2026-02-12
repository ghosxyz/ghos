# Changelog

All notable changes to this project are documented in this file.
The format is based on Keep a Changelog, and this project adheres to Semantic Versioning.

## [0.4.1] - 2026-04-25

### Changed

- Tighten burner account TTL clamp to the protocol-wide max of 30 days
- Audit log: include mint hash in the rotation event body
- SDK: retry transient `Blockhash not found` twice before surfacing the error
- CLI: `ghos status` now prints the decrypted available balance and pending counter side by side

### Fixed

- Dust-free padding miscalc when amount was below the rent-exempt floor
- CoinJoin settle path would double-count the host note on odd-sized participant sets
- TS SDK bn.js type import under Node 22 strict mode

## [0.4.0] - 2026-04-08

### Added

- Per-mint auditor registry, including `auditor_register` and `auditor_rotate` instructions
- Optional auditor co-sign path for withdrawals beyond a configured threshold
- Python CLI `ghos audit` subcommand
- Devnet integration test job in CI, gated on `main`

### Changed

- Anchor 0.29.0 to 0.30.1 upgrade
- solana-program pinned to `=1.18.26`
- Rename `note_commit` seed to `mix_commit` for clarity

## [0.3.0] - 2026-03-12

### Added

- CoinJoin mixing rounds with commit-reveal protocol, minimum 4 participants
- `mix_init` / `mix_commit` / `mix_reveal` / `mix_settle` instruction set
- Mix round watcher helper in `examples/mix_coinjoin.ts`
- SDK `ZkKeyPair.deriveFromSigner` deterministic derivation helper

### Fixed

- PDA seed collision when two burners existed with the same owner in the same slot

## [0.2.0] - 2026-02-14

### Added

- Burner account lifecycle: `create_burner`, `destroy_burner`, TTL timer, owner registry
- SDK burner helpers, CLI `ghos burner` subcommand
- 40 unit tests for the SDK crypto module

### Changed

- GhosConfig layout extended with `burner_ttl_max` and `burner_registry_cap`
- Program upgrade authority moved to PDA-owned multisig placeholder

## [0.1.0] - 2026-01-06

### Added

- Initial release
- Shield (SPL to confidential), confidential transfer, apply pending, withdraw
- Token-2022 confidential transfer CPI wrapper
- SDK client, WASM ElGamal proof generator hook
- Anchor 0.29.0 based program, localnet tests
- CI workflow with fmt + build + secret scan

<!-- chore: v0.2.0 CHANGELOG entry -->
