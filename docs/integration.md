# Integration

This guide shows how to call ghos from another Solana program via CPI,
from a backend service via the TypeScript SDK, and from a shell via the
Python CLI. Each path is production-targeted; the Rust CPI path is the
most interesting and therefore gets the most space.

## Pick the right integration layer

| Scenario                                       | Use this                    |
| ---------------------------------------------- | --------------------------- |
| Another Solana program calls ghos atomically   | CPI from Anchor (Rust)      |
| Backend or cron job shields on behalf of user  | TypeScript SDK              |
| Terminal and ops scripts                       | Python CLI                  |
| Frontend dApp                                  | TypeScript SDK in browser   |

## Rust / Anchor CPI

Anchor generates CPI helpers for every instruction. Add `ghos` as a
dependency, wire the right account set, and invoke.

### Cargo dependencies

```toml
[dependencies]
ghos = { version = "0.4.1", features = ["cpi"] }
anchor-lang = "0.30.1"
anchor-spl = "0.30.1"
```

### Example: a "shield helper" program that wraps ghos

```rust
use anchor_lang::prelude::*;
use anchor_spl::token_2022::Token2022;
use ghos::cpi::accounts::Shield;
use ghos::cpi;
use ghos::program::Ghos;

declare_id!("Hook1111111111111111111111111111111111111111");

#[program]
pub mod shield_hook {
    use super::*;

    pub fn forward_shield(ctx: Context<ForwardShield>, amount: u64) -> Result<()> {
        require!(amount % 1_000 == 0, ErrorCode::AmountNotAligned);

        let cpi_accounts = Shield {
            owner: ctx.accounts.user.to_account_info(),
            source_ata: ctx.accounts.user_ata.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            ghos_state: ctx.accounts.ghos_state.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(
            ctx.accounts.ghos_program.to_account_info(),
            cpi_accounts,
        );
        cpi::shield(cpi_ctx, amount)
    }
}

#[derive(Accounts)]
pub struct ForwardShield<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub user_ata: AccountInfo<'info>,
    pub mint: AccountInfo<'info>,
    #[account(mut)]
    pub ghos_state: AccountInfo<'info>,
    pub token_program: Program<'info, Token2022>,
    pub ghos_program: Program<'info, Ghos>,
}

#[error_code]
pub enum ErrorCode {
    #[msg("amount not aligned to dust-free unit")]
    AmountNotAligned,
}
```

The key pattern: every ghos instruction has a generated `Context<T>`
with typed account slots, and `ghos::cpi::<instruction>(ctx, args...)`
forwards the call. No raw `invoke_signed` boilerplate.

### Example: calling confidential_transfer via CPI

```rust
use ghos::cpi::accounts::ConfidentialTransfer;
use ghos::cpi;

pub fn atomic_send(
    ctx: Context<AtomicSend>,
    src_ct: [u8; 64],
    dst_ct: [u8; 64],
    range_proof: Vec<u8>,
    equality_proof: Vec<u8>,
) -> Result<()> {
    let cpi_accounts = ConfidentialTransfer {
        source_owner: ctx.accounts.sender.to_account_info(),
        destination_owner: ctx.accounts.recipient.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        ghos_state: ctx.accounts.ghos_state.to_account_info(),
        token_program: ctx.accounts.token_program.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(
        ctx.accounts.ghos_program.to_account_info(),
        cpi_accounts,
    );
    cpi::confidential_transfer(cpi_ctx, src_ct, dst_ct, range_proof, equality_proof)
}
```

The caller is responsible for producing `src_ct`, `dst_ct`, and the
proofs; these must come from the user's client. An on-chain program
cannot generate valid twisted ElGamal ciphertexts because that requires
the user's ElGamal secret.

### PDA seeds to use from CPI

```rust
use ghos::constants::{CONFIG_SEED, AUDITOR_SEED, BURNER_SEED};
let (config_pda, _) = Pubkey::find_program_address(&[CONFIG_SEED], &ghos::ID);
let (audit_pda, _) = Pubkey::find_program_address(&[AUDITOR_SEED, mint.as_ref()], &ghos::ID);
```

Importing these constants from the ghos crate keeps the caller in lock
step with any seed changes.

### PDA signer patterns

If your wrapper program holds custody of user tokens via a PDA, sign the
CPI with the PDA. Example for a vault PDA seeded by `b"vault"`:

```rust
let seeds: &[&[u8]] = &[b"vault", &[bump]];
let signer_seeds = &[seeds];
let cpi_ctx = CpiContext::new_with_signer(
    ctx.accounts.ghos_program.to_account_info(),
    cpi_accounts,
    signer_seeds,
);
cpi::shield(cpi_ctx, amount)?;
```

### Error propagation

ghos returns `GhosError` which Anchor surfaces as a numeric code plus a
message. In the caller program catch and re-raise:

```rust
fn guarded_shield(ctx: Context<ForwardShield>, amount: u64) -> Result<()> {
    if let Err(e) = cpi::shield(cpi_ctx, amount) {
        msg!("ghos shield failed: {:?}", e);
        return Err(e.into());
    }
    Ok(())
}
```

## TypeScript SDK

```ts
import { GhosClient, loadKeypair } from "@ghos/sdk";
import { Connection, PublicKey } from "@solana/web3.js";

const connection = new Connection(process.env.GHOS_CLUSTER!);
const payer = loadKeypair(process.env.GHOS_WALLET!);
const client = new GhosClient({ connection, payer });

const mint = new PublicKey(process.env.GHOS_MINT!);

const shieldResult = await client.shield({ mint, amount: 1_000_000n });
console.log("shield sig:", shieldResult.signature);

const applyResult = await client.applyPendingBalance({ mint });
console.log("apply sig:", applyResult.signature);

const transferResult = await client.confidentialTransfer({
  mint,
  toOwner: new PublicKey(process.env.GHOS_RECIPIENT!),
  amount: 250_000n,
});
console.log("transfer sig:", transferResult.signature);
```

### Client options

| Option               | Type                      | Default                             |
| -------------------- | ------------------------- | ----------------------------------- |
| `connection`         | `Connection`              | required                            |
| `payer`              | `Keypair` or `Signer`     | required                            |
| `programId`          | `PublicKey`               | the ghos canonical id               |
| `commitment`         | `Commitment`              | `"confirmed"`                       |
| `computeUnitLimit`   | `number`                  | `600_000`                           |
| `computeUnitPrice`   | `number` microlamports    | `10`                                |

### Sending with a different fee payer

```ts
const sig = await client.shield(
  { mint, amount: 1_000_000n },
  { feePayer: altFeePayer }
);
```

### Waiting for events

```ts
const listener = client.on("ShieldExecuted", (event) => {
  console.log(`shield by ${event.owner.toBase58()}: ${event.amount_lamports}`);
});
await sleep(60_000);
listener.dispose();
```

## Python CLI

The CLI is the same code path as the SDK, exposed as a terminal tool.

```bash
# one-time config
ghos init --cluster devnet --wallet ~/.config/solana/id.json

# shield 1.0 USDC worth
ghos shield --mint 7xKX...Qm --amount 1.0

# send confidentially
ghos send 9Kfg...Xr 0.25 --mint 7xKX...Qm --confidential

# apply pending
ghos apply --mint 7xKX...Qm

# burner
ghos burner create --ttl 24h
ghos burner list
ghos burner destroy <burner-pubkey>

# mix
ghos mix list --mint 7xKX...Qm
ghos mix join <round-pubkey> --amount 0.1
ghos mix status <round-pubkey>

# audit
ghos audit register --mint 7xKX...Qm --pubkey <auditor-pubkey> --cooldown 24h
ghos audit rotate --mint 7xKX...Qm --pubkey <new-auditor-pubkey>

# status
ghos status --mint 7xKX...Qm
```

### CLI output conventions

- All amounts displayed in UI units (not atomic) with a trailing `:atom`
  annotation so the exact wire-format amount is always visible.
- Hex displays fingerprint the first 8 bytes, full bytes on `--verbose`.
- Exit code 0 on success, non-zero on any ghos error or network error.
- Human output on TTY, JSON output on `--json`.

## Backend integration notes

| Concern                         | Answer                                         |
| ------------------------------- | ---------------------------------------------- |
| Can I run the SDK in Node 18?   | Yes; Node 20 is the default for CI             |
| Does the SDK hit a third party? | No, all calls go to the user's RPC             |
| Can I generate proofs offline?  | Yes, the crypto/ module is pure JS/WASM        |
| Is proof generation CPU bound?  | Yes, about 180ms per range proof on M-class    |
| How do I persist ElGamal keys?  | Derive from signer, do not persist separately  |

## Testing your integration

Reuse the test fixtures from `tests/fixtures/`:

```ts
import { createConfidentialMint, defaultMintConfig } from "./tests/fixtures/mints";
import { deriveConfigPda, createFundedActor } from "./tests/fixtures/accounts";
import { buildProofBundle } from "./tests/fixtures/proofs";
```

These are the same helpers the core test suite uses; they keep your
tests in sync with the program's account layout.

## Common integration bugs

| Bug                                                  | Fix                                         |
| ---------------------------------------------------- | ------------------------------------------- |
| Passing an SPL Token (v1) mint instead of Token-2022 | Use `TOKEN_2022_PROGRAM_ID` when creating    |
| Forgetting the dust-free unit                        | Round to multiples of 1000 atomic           |
| Skipping `apply_pending_balance`                     | Pending never drains until the call lands   |
| Re-deriving PDAs with a different seed               | Import seeds from `ghos::constants`         |
| Forgetting the compute-budget prelude                | Add `setComputeUnitLimit(600_000)`          |
| Sharing one ElGamal key across mints                 | Derive one per mint via HKDF from signer    |

## Stability and versioning

- Instruction discriminators are fixed across minor versions.
- Error ordinals are append-only.
- PDA seeds are considered protocol-breaking to change, tracked under
  a `major` bump.
- Event shapes may gain fields at the end; never reordered.
- The `PROTOCOL_VERSION` constant in `constants.rs` is the authoritative
  pin; the SDK and CLI refuse to talk to a deployed program whose
  GhosConfig.version disagrees with the SDK's bundled `PROTOCOL_VERSION`.
