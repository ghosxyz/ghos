//! On-chain account layouts.
//!
//! All accounts are Anchor-discriminated. Sizes are fixed at init time to keep
//! rent predictable; dynamic lists are bounded by compile-time constants from
//! `constants.rs`.

use anchor_lang::prelude::*;

use crate::constants::{
    AUDITOR_PUBKEY_LEN, BURNER_REGISTRY_CAP_PER_OWNER, MIX_COMMITMENT_LEN, MIX_MAX_PARTICIPANTS,
};

/// Protocol-wide configuration, singleton PDA.
#[account]
pub struct GhosConfig {
    pub admin: Pubkey,
    pub version: u16,
    pub paused: bool,
    pub dust_free_unit: u64,
    pub burner_ttl_max: i64,
    pub burner_ttl_min: i64,
    pub burner_registry_cap: u16,
    pub mix_min_participants: u8,
    pub mix_max_participants: u8,
    pub mix_reveal_window: i64,
    pub auditor_cosign_lamports: u64,
    pub last_updated: i64,
    pub bump: u8,
    pub reserved: [u8; 64],
}

impl GhosConfig {
    pub const LEN: usize = 8  // discriminator
        + 32                  // admin
        + 2                   // version
        + 1                   // paused
        + 8                   // dust_free_unit
        + 8 + 8               // burner ttl min/max
        + 2                   // burner_registry_cap
        + 1 + 1               // mix min/max
        + 8                   // mix_reveal_window
        + 8                   // auditor_cosign_lamports
        + 8                   // last_updated
        + 1                   // bump
        + 64; // reserved
}

/// Per-mint auditor registry entry.
///
/// Auditor registration is optional. If absent, confidential transfers still
/// settle; if present, auditor may decrypt transfer amounts using the
/// corresponding secret key.
#[account]
pub struct AuditorEntry {
    pub mint: Pubkey,
    pub auditor_pubkey: [u8; AUDITOR_PUBKEY_LEN],
    pub registered_at: i64,
    pub last_rotated_at: i64,
    pub rotation_cooldown: i64,
    pub admin: Pubkey,
    pub bump: u8,
    pub reserved: [u8; 16],
}

impl AuditorEntry {
    pub const LEN: usize = 8      // discriminator
        + 32                      // mint
        + AUDITOR_PUBKEY_LEN      // pubkey
        + 8 + 8 + 8               // registered / rotated / cooldown
        + 32                      // admin
        + 1                       // bump
        + 16; // reserved
}

/// Ephemeral burner account registry entry.
#[account]
pub struct BurnerAccount {
    pub owner: Pubkey,
    pub burner_pubkey: Pubkey,
    pub created_at: i64,
    pub expires_at: i64,
    pub nonce: u64,
    pub revoked: bool,
    pub usage_count: u32,
    pub bump: u8,
    pub reserved: [u8; 16],
}

impl BurnerAccount {
    pub const LEN: usize = 8     // discriminator
        + 32 + 32                // owner, burner
        + 8 + 8                  // created, expires
        + 8                      // nonce
        + 1                      // revoked
        + 4                      // usage_count
        + 1                      // bump
        + 16; // reserved
}

/// CoinJoin round metadata.
#[account]
pub struct MixRound {
    pub mint: Pubkey,
    pub denomination: u64,
    pub host: Pubkey,
    pub capacity: u8,
    pub committed: u8,
    pub revealed: u8,
    pub phase: MixPhase,
    pub opened_at: i64,
    pub commit_close_at: i64,
    pub reveal_close_at: i64,
    pub settled_at: i64,
    pub bump: u8,
    pub reserved: [u8; 32],
}

impl MixRound {
    pub const LEN: usize = 8      // discriminator
        + 32                      // mint
        + 8                       // denomination
        + 32                      // host
        + 1 + 1 + 1               // capacity/committed/revealed
        + 1                       // phase enum
        + 8 * 4                   // timestamps
        + 1                       // bump
        + 32; // reserved
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum MixPhase {
    Open = 0,
    Commit = 1,
    Reveal = 2,
    Settling = 3,
    Settled = 4,
    Aborted = 5,
}

/// Per-participant commitment in a mix round.
#[account]
pub struct MixCommitment {
    pub round: Pubkey,
    pub participant: Pubkey,
    pub commitment: [u8; MIX_COMMITMENT_LEN],
    pub revealed: bool,
    pub reveal_signal: [u8; 32],
    pub index: u8,
    pub committed_at: i64,
    pub revealed_at: i64,
    pub bump: u8,
    pub reserved: [u8; 16],
}

impl MixCommitment {
    pub const LEN: usize = 8      // discriminator
        + 32 + 32                 // round, participant
        + MIX_COMMITMENT_LEN      // commitment
        + 1                       // revealed
        + 32                      // reveal_signal
        + 1                       // index
        + 8 + 8                   // committed_at, revealed_at
        + 1                       // bump
        + 16; // reserved
}

/// Helper to assert that a burner entry is still live.
pub fn burner_is_active(entry: &BurnerAccount, now: i64) -> bool {
    !entry.revoked && entry.expires_at > now
}

/// Helper: count of remaining slots in a mix round given its capacity.
pub fn mix_remaining_slots(round: &MixRound) -> u8 {
    round.capacity.saturating_sub(round.committed)
}

/// Compile-time check that MixPhase discriminant fits into its backing byte.
const _: () = {
    assert!(MixPhase::Settled as u8 <= u8::MAX);
    assert!(MIX_MAX_PARTICIPANTS <= u8::MAX);
    assert!(BURNER_REGISTRY_CAP_PER_OWNER <= u16::MAX);
};
