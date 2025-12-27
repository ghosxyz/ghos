//! Program-level error enum.
//!
//! Every instruction handler returns `Result<T, GhosError>` converted through
//! Anchor's `ErrorCode` bridge. The numeric codes here are stable across
//! minor versions; additions go at the end.

use anchor_lang::prelude::*;

#[error_code]
pub enum GhosError {
    #[msg("amount is below the dust-free quantization unit")]
    AmountBelowDustFloor,

    #[msg("amount is not aligned to the dust-free unit")]
    AmountNotAligned,

    #[msg("mint does not have the Token-2022 confidential transfer extension")]
    MintMissingConfidentialExt,

    #[msg("mint owner is not the Token-2022 program")]
    MintWrongProgramOwner,

    #[msg("token account is not a confidential account for the given mint")]
    AccountNotConfidential,

    #[msg("token account owner does not match the signer")]
    AccountOwnerMismatch,

    #[msg("supplied ElGamal ciphertext is malformed")]
    InvalidCiphertext,

    #[msg("range proof verification failed via zk-token-proof CPI")]
    RangeProofVerificationFailed,

    #[msg("equality proof verification failed via zk-token-proof CPI")]
    EqualityProofVerificationFailed,

    #[msg("pubkey validity proof verification failed via zk-token-proof CPI")]
    PubkeyValidityProofFailed,

    #[msg("zero balance proof verification failed via zk-token-proof CPI")]
    ZeroBalanceProofFailed,

    #[msg("auditor registration is required for this mint but was not provided")]
    AuditorEntryMissing,

    #[msg("auditor public key does not match the registered entry")]
    AuditorMismatch,

    #[msg("auditor rotation attempted before the cooldown period elapsed")]
    AuditorRotationTooSoon,

    #[msg("burner TTL is outside the allowed range")]
    BurnerTtlOutOfRange,

    #[msg("burner has expired and may no longer be used")]
    BurnerExpired,

    #[msg("burner is already registered for this owner at the requested seed")]
    BurnerAlreadyRegistered,

    #[msg("burner registry cap for this owner has been reached")]
    BurnerCapReached,

    #[msg("mix round requires a minimum number of participants")]
    MixBelowMinimum,

    #[msg("mix round is full, cannot accept more participants")]
    MixRoundFull,

    #[msg("mix round is not in the commit phase")]
    MixNotInCommit,

    #[msg("mix round is not in the reveal phase")]
    MixNotInReveal,

    #[msg("mix reveal does not match the prior commitment")]
    MixRevealMismatch,

    #[msg("mix round reveal window has elapsed, round aborted")]
    MixRevealTimeout,

    #[msg("mix denomination does not match the round configuration")]
    MixDenominationMismatch,

    #[msg("participant already committed in this round")]
    MixAlreadyCommitted,

    #[msg("participant never committed, cannot reveal")]
    MixNotCommitted,

    #[msg("the caller is not the protocol admin")]
    NotAdmin,

    #[msg("protocol has been paused by the admin")]
    Paused,

    #[msg("provided proof context account does not belong to the expected program")]
    UnexpectedProofContext,

    #[msg("calling instruction requires confidential_transfer feature to be enabled on the mint")]
    ConfidentialTransferDisabled,

    #[msg("apply pending requires a non-zero pending counter")]
    NothingToApply,

    #[msg("withdraw amount exceeds decrypted available balance")]
    WithdrawExceedsAvailable,

    #[msg("protocol version stored on-chain does not match program expectations")]
    ProtocolVersionMismatch,
}
