//! Program events.
//!
//! Events are emitted via `emit!` and are indexed by downstream services
//! (the SDK watcher, explorers, auditor dashboards). Event fields never
//! contain plaintext transfer amounts, only ciphertexts and public signals.

use anchor_lang::prelude::*;

#[event]
pub struct ConfigInitialized {
    pub admin: Pubkey,
    pub version: u16,
    pub timestamp: i64,
}

#[event]
pub struct ConfigUpdated {
    pub admin: Pubkey,
    pub field: u8,
    pub timestamp: i64,
}

#[event]
pub struct ShieldExecuted {
    pub owner: Pubkey,
    pub mint: Pubkey,
    pub source_ata: Pubkey,
    pub amount_lamports: u64,
    pub timestamp: i64,
}

#[event]
pub struct ConfidentialTransferSubmitted {
    pub source_owner: Pubkey,
    pub destination_owner: Pubkey,
    pub mint: Pubkey,
    pub proof_context: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct PendingApplied {
    pub owner: Pubkey,
    pub mint: Pubkey,
    pub applied_counter: u64,
    pub timestamp: i64,
}

#[event]
pub struct WithdrawExecuted {
    pub owner: Pubkey,
    pub mint: Pubkey,
    pub destination_ata: Pubkey,
    pub amount: u64,
    pub auditor_cosigned: bool,
    pub timestamp: i64,
}

#[event]
pub struct BurnerCreated {
    pub owner: Pubkey,
    pub burner: Pubkey,
    pub ttl_seconds: i64,
    pub expires_at: i64,
}

#[event]
pub struct BurnerDestroyed {
    pub owner: Pubkey,
    pub burner: Pubkey,
    pub revoked_at: i64,
}

#[event]
pub struct AuditorRegistered {
    pub mint: Pubkey,
    pub auditor_pubkey: [u8; 32],
    pub admin: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct AuditorRotated {
    pub mint: Pubkey,
    pub old_pubkey: [u8; 32],
    pub new_pubkey: [u8; 32],
    pub timestamp: i64,
}

#[event]
pub struct MixRoundOpened {
    pub round: Pubkey,
    pub mint: Pubkey,
    pub denomination: u64,
    pub capacity: u8,
    pub opened_at: i64,
}

#[event]
pub struct MixCommitted {
    pub round: Pubkey,
    pub participant: Pubkey,
    pub commitment: [u8; 32],
    pub index: u8,
}

#[event]
pub struct MixRevealed {
    pub round: Pubkey,
    pub participant: Pubkey,
    pub index: u8,
}

#[event]
pub struct MixSettled {
    pub round: Pubkey,
    pub participants: u8,
    pub settled_at: i64,
}
