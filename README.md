<p align="center">
  <img src="./assets/banner.png" alt="ghos.xyz" width="100%" />
</p>

<p align="center">
  <a href="https://github.com/ghosxyz/ghos/blob/main/LICENSE">
    <img src="https://img.shields.io/badge/License-MIT-ff1249?style=for-the-badge&labelColor=0a0a0a" alt="License MIT" />
  </a>
  <a href="https://github.com/ghosxyz/ghos/actions/workflows/ci.yml">
    <img src="https://img.shields.io/github/actions/workflow/status/ghosxyz/ghos/ci.yml?branch=main&style=for-the-badge&labelColor=0a0a0a&color=ff1249&label=CI" alt="CI" />
  </a>
  <a href="https://github.com/ghosxyz/ghos/releases">
    <img src="https://img.shields.io/badge/Version-0.4.1-ff1249?style=for-the-badge&labelColor=0a0a0a" alt="Version" />
  </a>
  <a href="https://github.com/ghosxyz/ghos/commits">
    <img src="https://img.shields.io/github/last-commit/ghosxyz/ghos?style=for-the-badge&labelColor=0a0a0a&color=ff1249" alt="Last Commit" />
  </a>
  <a href="https://github.com/ghosxyz/ghos/stargazers">
    <img src="https://img.shields.io/github/stars/ghosxyz/ghos?style=for-the-badge&labelColor=0a0a0a&color=ff1249" alt="Stars" />
  </a>
  <a href="https://github.com/ghosxyz/ghos">
    <img src="https://img.shields.io/github/repo-size/ghosxyz/ghos?style=for-the-badge&labelColor=0a0a0a&color=ff1249" alt="Repo Size" />
  </a>
  <a href="https://github.com/ghosxyz/ghos/issues">
    <img src="https://img.shields.io/github/issues/ghosxyz/ghos?style=for-the-badge&labelColor=0a0a0a&color=ff1249" alt="Open Issues" />
  </a>
</p>

<p align="center">
  <a href="https://x.com/ghosxyz">
    <img src="https://img.shields.io/badge/X-@ghosxyz-0a0a0a?style=for-the-badge&logo=x&logoColor=white" alt="X" />
  </a>
  <a href="https://ghos.xyz">
    <img src="https://img.shields.io/badge/Website-ghos.xyz-ff1249?style=for-the-badge&labelColor=0a0a0a" alt="Website" />
  </a>
  <a href="https://ghos.xyz/docs/">
    <img src="https://img.shields.io/badge/Docs-read-ff1249?style=for-the-badge&labelColor=0a0a0a" alt="Docs" />
  </a>
  <a href="https://github.com/ghosxyz/ghos/tree/main/programs/ghos">
    <img src="https://img.shields.io/badge/Anchor-0.30.1-ff1249?style=for-the-badge&labelColor=0a0a0a" alt="Anchor" />
  </a>
  <a href="https://github.com/ghosxyz/ghos/tree/main/programs/ghos">
    <img src="https://img.shields.io/badge/Solana-1.18-ff1249?style=for-the-badge&labelColor=0a0a0a" alt="Solana" />
  </a>
</p>

---

ghos is a Solana privacy OS built on Token-2022 Confidential Balances. Balances are ElGamal-encrypted on-chain, transfer amounts never appear in plaintext, and range proofs are generated on the client using twisted ElGamal over Ristretto255 and bulletproofs. Optional per-mint auditor keys satisfy selective disclosure without leaking amounts to the public.

The core engine is a single Anchor program that wraps and extends the Token-2022 Confidential Transfer extension with burner account lifecycle, CoinJoin-style mixing rounds, and an auditor registry. The SDK (TypeScript) exposes a browser-friendly proof generator so no ciphertexts or secrets leave the user's device. The CLI (Python) exposes the same flows to terminals and automation.

## Features

| Feature                          | Status  | Notes                                                           |
| -------------------------------- | ------- | --------------------------------------------------------------- |
| Shield (SPL to confidential)     | stable  | CPI into Token-2022 confidential transfer                       |
| Confidential transfer            | stable  | Twisted ElGamal over Ristretto255                               |
| Apply pending balance            | stable  | Drains pending counter into available counter                   |
| Withdraw (confidential to SPL)   | stable  | Reveals only when user signs off                                |
| Burner account lifecycle         | stable  | Ephemeral keypair registry with expiry                          |
| CoinJoin mixing rounds           | beta    | Commit-reveal with N>=4 participants, equal-note set            |
| Per-mint auditor registry        | beta    | Optional ElGamal pubkey per mint for selective disclosure       |
| Client-side ZK proof generation  | stable  | WASM via spl-zk-token-proof-program primitives                  |
| Dust-free transfer padding       | stable  | Amounts rounded to avoid rent-exemption dust leaks              |
| Batched shielding                | alpha   | Multi-mint shield in one tx, SDK helper                         |

## Architecture

```
+------------------+        +---------------------------+        +------------------+
|   Browser / CLI  |  ---   |  ghos Anchor program       |  ---  |  Token-2022      |
|   (SDK, Python)  |  proof |  (shield/send/withdraw    |  CPI  |  Confidential    |
|                  |  ciph. |   burner/mix/audit)       |       |  Transfer ext.   |
+------------------+        +-------------+-------------+        +------------------+
                                          |
                                          | CPI (verify_range, verify_equality,
                                          |      verify_pubkey_validity)
                                          v
                            +-----------------------------+
                            | spl-zk-token-proof-program  |
                            | (twisted ElGamal, bulletpr.)|
                            +-----------------------------+
```

See [docs/architecture.md](docs/architecture.md) for account layout, instruction semantics, and PDA seeds.
See [docs/zk-stack.md](docs/zk-stack.md) for the full ZK stack (curves, range proofs, equality proofs, sigma protocols).
See [docs/threat-model.md](docs/threat-model.md) for threats in scope and out of scope.

## Build

```bash
git clone https://github.com/ghosxyz/ghos.git
cd ghos

# install JS deps (SDK, tests, examples)
yarn install

# build the Anchor program
anchor build

# run the integration tests
anchor test

# build the TS SDK
yarn workspace @ghos/sdk build

# install the Python CLI (from source)
cd cli && pip install -e . && cd ..
```

## Quick start

### TypeScript SDK

```ts
import { GhosClient, loadKeypair } from "@ghos/sdk";
import { Connection, PublicKey } from "@solana/web3.js";

const connection = new Connection("https://api.devnet.solana.com");
const payer = loadKeypair("~/.config/solana/id.json");
const client = new GhosClient({ connection, payer });

const mint = new PublicKey("<Token-2022 mint with confidential ext>");

// shield 1.00 USDC into the confidential balance
await client.shield({ mint, amount: 1_000_000n });
// { signature: "5K...", commitment: "confidential", pending: "1_000_000" }

// apply pending -> available (one-shot)
await client.applyPendingBalance({ mint });

// send confidentially (the amount never leaves the client as plaintext)
await client.confidentialTransfer({
  mint,
  toOwner: new PublicKey("<recipient>"),
  amount: 250_000n,
});
// { signature: "3Q...", verdict: "SUBMITTED", proof: "range+equality" }
```

### Rust (CPI into ghos from another program)

```rust
use anchor_lang::prelude::*;
use ghos::cpi::accounts::Shield;
use ghos::cpi;

pub fn forward_shield(ctx: Context<ForwardShield>, amount: u64) -> Result<()> {
    let cpi_ctx = CpiContext::new(
        ctx.accounts.ghos_program.to_account_info(),
        Shield {
            owner: ctx.accounts.user.to_account_info(),
            source_ata: ctx.accounts.user_ata.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            ghos_state: ctx.accounts.ghos_state.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
        },
    );
    cpi::shield(cpi_ctx, amount)
}
```

### Python CLI

```bash
# initialize config with devnet RPC + local keypair
ghos init --cluster devnet

# shield 1.00 USDC into the confidential balance
ghos shield --mint <mint-pubkey> --amount 1.0

# send confidentially
ghos send <recipient> 0.25 --mint <mint-pubkey> --confidential

# create a burner account that expires in 24h
ghos burner create --ttl 24h

# join a CoinJoin round
ghos mix join --denomination 0.1 --mint <mint-pubkey>

# check confidential balance (decrypted locally with your ElGamal secret)
ghos status --mint <mint-pubkey>
```

## Project structure

```
ghos/
  programs/
    ghos/
      src/
        lib.rs                  entrypoint, program module, declare_id!
        state.rs                GhosConfig, BurnerAccount, MixRound, AuditorEntry
        errors.rs               GhosError enum, 32 variants, mapped to anchor
        events.rs               ShieldEvent, TransferEvent, MixSettleEvent ...
        constants.rs            seeds, sizes, version tag
        instructions/
          initialize.rs         create GhosConfig PDA, set admin
          shield.rs             SPL to confidential, CPI into Token-2022
          confidential_transfer.rs   ElGamal cipher pair, range proof verify
          apply_pending.rs      drain pending -> available counter
          withdraw.rs           confidential to SPL, auditor co-sign option
          create_burner.rs      ephemeral keypair registry entry, TTL
          destroy_burner.rs     revoke before TTL expiry
          mix_init.rs           open CoinJoin round, set denomination
          mix_commit.rs         commit(owner_ek, note) hash
          mix_reveal.rs         reveal and verify membership
          mix_settle.rs         settle outputs, redistribute notes
          auditor_register.rs   register ElGamal pubkey per mint
          auditor_rotate.rs     rotate auditor key, invalidate old
          config_update.rs      admin-only protocol knobs
        utils/
          token22.rs            Token-2022 CPI wrappers, extension checks
          zk.rs                 spl-zk-token-proof-program CPI helpers
          validation.rs         mint extension guards, owner checks
  sdk/
    src/
      index.ts                  public exports
      client.ts                 GhosClient, all instruction wrappers
      types.ts                  TS types, zod schemas, coders
      errors.ts                 SDK error codes
      pdas.ts                   PDA derivation helpers
      constants.ts              program id, seeds, defaults
      utils.ts                  retry, bn helpers, token22 probing
      instructions/             one file per instruction, returns TransactionInstruction
      crypto/
        elgamal.ts              twisted ElGamal over Ristretto255
        bulletproof.ts          64-bit range proof client
        sigma.ts                equality / pubkey-validity / zero-balance
        keys.ts                 GhosKeypair, deterministic from owner signer
      __tests__/                unit tests, 40+ cases
  cli/
    ghos_cli/
      __main__.py               python -m ghos_cli
      cli.py                    typer entry, command tree
      config.py                 ~/.config/ghos/config.toml loader
      client.py                 AsyncClient wrapper over solana-py
      crypto/
        elgamal.py              pure-python ElGamal for offline encryption
        keys.py                 deterministic keypair derivation
      commands/
        shield.py               ghos shield
        send.py                 ghos send
        withdraw.py             ghos withdraw
        burn.py                 ghos burner (create/list/destroy)
        mix.py                  ghos mix (join/status/settle)
        audit.py                ghos audit (register/rotate/list)
        status.py               ghos status
        init.py                 ghos init
      display.py                rich-based table and tree rendering
  tests/
    ghos.test.ts                anchor harness, localnet
    confidential_transfer.test.ts   shield + apply + transfer + withdraw roundtrip
    burner.test.ts              burner TTL, revoke, re-use guard
    mix.test.ts                 CoinJoin 4-party happy path, abort paths
    devnet.test.ts              real devnet RPC, runs in CI on main
  examples/
    shield_and_transfer.ts      minimal end-to-end
    burner_wallet_flow.ts       create burner, fund, use, destroy
    mix_coinjoin.ts             join a 4-party mix round
    auditor_setup.ts            register auditor, view decrypted auditor-side amount
    batch_airdrop.ts            batched shield to many recipients
  docs/
    architecture.md             account model, PDAs, instructions
    zk-stack.md                 curves, range proofs, equality proofs
    threat-model.md             in-scope and out-of-scope threats
    integration.md              integrating ghos from your own program
    api-reference.md            SDK + CLI reference
    confidential-transfer.md    Token-2022 extension primer
    burner-accounts.md          burner account lifecycle
    coinjoin.md                 CoinJoin round protocol
  migrations/
    deploy.ts                   anchor migrate, initialize GhosConfig
  scripts/
    devnet_seed.ts              seed devnet with test mints + auditor entries
    build.sh                    reproducible build entrypoint
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the PR flow, coding style, and test requirements.
See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for the community standards.
Security issues go through [SECURITY.md](SECURITY.md), not public issues.

## License

MIT. See [LICENSE](LICENSE).

## Links

- Website: [ghos.xyz](https://ghos.xyz)
- X: [@ghosxyz](https://x.com/ghosxyz)
- GitHub: [ghosxyz/ghos](https://github.com/ghosxyz/ghos)
- Docs: [ghos.xyz/docs/](https://ghos.xyz/docs/)
- Program ID (devnet): `EnKo8EbfJkani8UePTmAVPzdCZM8vMEYYkjTar4fwBPg`
- Ticker: $GHOS

<!-- docs: README quick start section refresh -->
