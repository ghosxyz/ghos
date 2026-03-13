//! ghos, Solana privacy OS program.
//!
//! The on-chain entrypoint wires the 14 public instructions. Each instruction
//! is implemented in its own module under `instructions/`. Account layouts
//! live in `state`, error codes in `errors`, events in `events`.
//!
//! ghos is a thin coordination layer on top of the Token-2022 confidential
//! transfer extension and the spl-zk-token-proof program. The CPI boundary
//! with Token-2022 is implemented in `utils/token22.rs`; the boundary with
//! zk-token-proof is in `utils/zk.rs`.

use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;
pub mod utils;

use crate::constants::{AUDITOR_PUBKEY_LEN, MIX_COMMITMENT_LEN};
use crate::instructions::*;

declare_id!("EnKo8EbfJkani8UePTmAVPzdCZM8vMEYYkjTar4fwBPg");

#[program]
pub mod ghos {
    use super::*;

    /// Create the singleton `GhosConfig` PDA. Must be called once per deploy.
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        instructions::initialize::handler(ctx)
    }

    /// Admin-only knob updates for dust unit, burner bounds, mix bounds,
    /// auditor cosign fee, and protocol pause.
    pub fn config_update(ctx: Context<ConfigUpdate>, field: ConfigField) -> Result<()> {
        instructions::config_update::handler(ctx, field)
    }

    /// Deposit public SPL balance into the caller's confidential pending
    /// counter via Token-2022 CPI.
    pub fn shield(ctx: Context<Shield>, amount: u64) -> Result<()> {
        instructions::shield::handler(ctx, amount)
    }

    /// Drain pending confidential counter into the available counter for the
    /// caller's Token-2022 account.
    pub fn apply_pending(
        ctx: Context<ApplyPending>,
        expected_pending_counter: u64,
        new_decryptable_available: [u8; 36],
    ) -> Result<()> {
        instructions::apply_pending::handler(
            ctx,
            expected_pending_counter,
            new_decryptable_available,
        )
    }

    /// Emit a confidential transfer using three client-generated proof
    /// contexts (equality, ciphertext validity, range).
    pub fn confidential_transfer(
        ctx: Context<ConfidentialTransfer>,
        destination_owner: Pubkey,
        new_source_decryptable_balance: [u8; 36],
    ) -> Result<()> {
        instructions::confidential_transfer::handler(
            ctx,
            destination_owner,
            new_source_decryptable_balance,
        )
    }

    /// Convert confidential available balance back into SPL. Range proof and
    /// equality proof contexts are consumed when present.
    pub fn withdraw(
        ctx: Context<Withdraw>,
        amount: u64,
        new_decryptable_available: [u8; 36],
    ) -> Result<()> {
        instructions::withdraw::handler(ctx, amount, new_decryptable_available)
    }

    /// Register an ephemeral burner account under the caller's registry.
    pub fn create_burner(ctx: Context<CreateBurner>, nonce: u64, ttl_seconds: i64) -> Result<()> {
        instructions::create_burner::handler(ctx, nonce, ttl_seconds)
    }

    /// Close a burner entry after proving the underlying confidential account
    /// is zero-balance.
    pub fn destroy_burner(ctx: Context<DestroyBurner>, zero_proof_bytes: Vec<u8>) -> Result<()> {
        instructions::destroy_burner::handler(ctx, zero_proof_bytes)
    }

    /// Register a per-mint auditor ElGamal pubkey. Admin-only.
    pub fn auditor_register(
        ctx: Context<AuditorRegister>,
        auditor_pubkey: [u8; AUDITOR_PUBKEY_LEN],
        pubkey_validity_proof: Vec<u8>,
        rotation_cooldown: i64,
    ) -> Result<()> {
        instructions::auditor_register::handler(
            ctx,
            auditor_pubkey,
            pubkey_validity_proof,
            rotation_cooldown,
        )
    }

    /// Rotate the registered auditor pubkey, subject to the cooldown.
    pub fn auditor_rotate(
        ctx: Context<AuditorRotate>,
        new_auditor_pubkey: [u8; AUDITOR_PUBKEY_LEN],
        pubkey_validity_proof: Vec<u8>,
    ) -> Result<()> {
        instructions::auditor_rotate::handler(
            ctx,
            new_auditor_pubkey,
            pubkey_validity_proof,
        )
    }

    /// Open a CoinJoin round.
    pub fn mix_init(
        ctx: Context<MixInit>,
        round_id: u64,
        denomination: u64,
        capacity: u8,
        commit_window_seconds: i64,
    ) -> Result<()> {
        instructions::mix_init::handler(
            ctx,
            round_id,
            denomination,
            capacity,
            commit_window_seconds,
        )
    }

    /// Submit a commitment to an open mix round.
    pub fn mix_commit(
        ctx: Context<MixCommitAccounts>,
        commitment_bytes: [u8; MIX_COMMITMENT_LEN],
    ) -> Result<()> {
        instructions::mix_commit::handler(ctx, commitment_bytes)
    }

    /// Reveal a prior commitment in a mix round.
    pub fn mix_reveal(
        ctx: Context<MixRevealAccounts>,
        preimage: Vec<u8>,
        reveal_signal: [u8; 32],
    ) -> Result<()> {
        instructions::mix_reveal::handler(ctx, preimage, reveal_signal)
    }

    /// Transition a mix round into the settled or aborted phase.
    pub fn mix_settle(ctx: Context<MixSettleAccounts>) -> Result<()> {
        instructions::mix_settle::handler(ctx)
    }
}

// feat: lib.rs wire create_burner + destroy_burner

// feat: lib.rs wire the four mix instructions

// feat: lib.rs wire auditor + config instructions
