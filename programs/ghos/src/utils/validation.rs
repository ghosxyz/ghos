//! Generic pre-checks reused by every instruction handler.

use anchor_lang::prelude::*;

use crate::constants::{
    BURNER_TTL_MAX_SECONDS, BURNER_TTL_MIN_SECONDS, DUST_FREE_UNIT, MIX_MAX_PARTICIPANTS,
    MIX_MIN_PARTICIPANTS,
};
use crate::errors::GhosError;
use crate::state::GhosConfig;

/// Block any flow that mutates state while the protocol is paused.
pub fn assert_not_paused(config: &GhosConfig) -> Result<()> {
    require!(!config.paused, GhosError::Paused);
    Ok(())
}

/// Verify the signer is the protocol admin recorded in the config account.
pub fn assert_admin(config: &GhosConfig, signer: &Pubkey) -> Result<()> {
    require_keys_eq!(config.admin, *signer, GhosError::NotAdmin);
    Ok(())
}

/// Reject amounts that would leak dust through rent-exemption side channels.
pub fn assert_dust_free(amount: u64) -> Result<()> {
    require!(amount >= DUST_FREE_UNIT, GhosError::AmountBelowDustFloor);
    require!(
        amount.checked_rem(DUST_FREE_UNIT).unwrap_or(u64::MAX) == 0,
        GhosError::AmountNotAligned
    );
    Ok(())
}

/// Round an amount up to the next dust-free multiple. Returns the padded amount
/// and the delta the caller should refund from the padding vault.
pub fn pad_amount(amount: u64) -> (u64, u64) {
    let rem = amount % DUST_FREE_UNIT;
    if rem == 0 {
        (amount, 0)
    } else {
        let padded = amount.saturating_add(DUST_FREE_UNIT - rem);
        (padded, DUST_FREE_UNIT - rem)
    }
}

/// Validate TTL inputs for burner account creation.
pub fn validate_burner_ttl(ttl: i64) -> Result<()> {
    require!(
        (BURNER_TTL_MIN_SECONDS..=BURNER_TTL_MAX_SECONDS).contains(&ttl),
        GhosError::BurnerTtlOutOfRange
    );
    Ok(())
}

/// Validate CoinJoin capacity against protocol bounds.
pub fn validate_mix_capacity(capacity: u8) -> Result<()> {
    require!(
        (MIX_MIN_PARTICIPANTS..=MIX_MAX_PARTICIPANTS).contains(&capacity),
        GhosError::MixBelowMinimum
    );
    Ok(())
}

/// Return the current unix timestamp from the Solana `Clock` sysvar.
pub fn now_ts() -> Result<i64> {
    Ok(Clock::get()?.unix_timestamp)
}

/// Guard: the protocol version stored on-chain must match the program compile
/// time constant. Used on flows that assume a given schema layout.
pub fn assert_protocol_version(config: &GhosConfig, expected: u16) -> Result<()> {
    require_eq!(
        config.version,
        expected,
        GhosError::ProtocolVersionMismatch
    );
    Ok(())
}

/// Assert a byte slice has the expected fixed length, returning a typed error
/// rather than a generic deserialization failure.
pub fn assert_len(actual: usize, expected: usize, err: GhosError) -> Result<()> {
    require_eq!(actual, expected, err);
    Ok(())
}
