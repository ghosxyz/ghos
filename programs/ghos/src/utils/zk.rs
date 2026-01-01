//! CPI helpers for `spl-zk-token-proof-program` proof verification.
//!
//! The program exposes separate instructions for each proof kind. ghos uses:
//! - `VerifyRangeProofU64` for 64-bit bulletproof range proofs (shield, withdraw)
//! - `VerifyBatchedRangeProofU128` for transfer, which combines two 64-bit ranges
//! - `VerifyCiphertextCommitmentEquality` for transfer equality between source
//!   and destination commitments
//! - `VerifyPubkeyValidity` for auditor registration
//! - `VerifyZeroBalance` for burner destruction
//!
//! Each verification creates a short-lived proof context account that the
//! Token-2022 program then consumes via CPI. The proof context lifecycle is:
//! - client submits proof data + creates context account
//! - ghos or token-2022 consumes the context account in the same tx
//! - context account is closed by the consumer, lamports refunded to the fee payer

use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke;

use crate::constants::zk_token_proof_program_id;
use crate::errors::GhosError;

/// Proof kinds ghos knows about. The discriminants intentionally match the
/// upstream `ProofInstruction` numeric ordering so they are stable.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum ProofKind {
    RangeProof64 = 0,
    BatchedRangeProof128 = 1,
    CiphertextCommitmentEquality = 2,
    PubkeyValidity = 3,
    ZeroBalance = 4,
}

impl ProofKind {
    /// Map to the upstream instruction tag byte used when CPIing into the
    /// zk-token-proof program.
    pub fn tag(self) -> u8 {
        match self {
            ProofKind::RangeProof64 => 18,
            ProofKind::BatchedRangeProof128 => 20,
            ProofKind::CiphertextCommitmentEquality => 12,
            ProofKind::PubkeyValidity => 22,
            ProofKind::ZeroBalance => 10,
        }
    }

    /// Typed error to surface when this kind of verification fails.
    pub fn err(self) -> GhosError {
        match self {
            ProofKind::RangeProof64 => GhosError::RangeProofVerificationFailed,
            ProofKind::BatchedRangeProof128 => GhosError::RangeProofVerificationFailed,
            ProofKind::CiphertextCommitmentEquality => {
                GhosError::EqualityProofVerificationFailed
            }
            ProofKind::PubkeyValidity => GhosError::PubkeyValidityProofFailed,
            ProofKind::ZeroBalance => GhosError::ZeroBalanceProofFailed,
        }
    }
}

/// Invoke the zk-token-proof program's "verify & store" variant, which writes
/// a context account the Token-2022 program can later consume.
///
/// Accounts expected:
/// 0. `[writable]` the proof context account (uninitialized, funded by client)
/// 1. `[]` context state authority (usually the payer)
/// 2. `[writable]` system program for account init
/// 3. Proof data passed in the instruction data itself.
pub fn verify_and_store(
    proof_program: AccountInfo,
    context_account: AccountInfo,
    context_authority: AccountInfo,
    system_program: AccountInfo,
    kind: ProofKind,
    proof_bytes: &[u8],
) -> Result<()> {
    require_keys_eq!(
        *proof_program.key,
        zk_token_proof_program_id(),
        GhosError::UnexpectedProofContext
    );
    let mut data = Vec::with_capacity(proof_bytes.len() + 1);
    data.push(kind.tag());
    data.extend_from_slice(proof_bytes);

    let ix = anchor_lang::solana_program::instruction::Instruction {
        program_id: zk_token_proof_program_id(),
        accounts: vec![
            AccountMeta::new(*context_account.key, false),
            AccountMeta::new_readonly(*context_authority.key, true),
            AccountMeta::new_readonly(*system_program.key, false),
        ],
        data,
    };
    invoke(
        &ix,
        &[
            context_account,
            context_authority,
            system_program,
            proof_program,
        ],
    )
    .map_err(|_| error!(kind.err()))?;
    Ok(())
}

/// Close a proof context account, refunding lamports to the destination.
/// Must be called after the verifying consumer has finished reading it.
pub fn close_context(
    proof_program: AccountInfo,
    context_account: AccountInfo,
    destination: AccountInfo,
    authority: AccountInfo,
) -> Result<()> {
    require_keys_eq!(
        *proof_program.key,
        zk_token_proof_program_id(),
        GhosError::UnexpectedProofContext
    );
    let ix = anchor_lang::solana_program::instruction::Instruction {
        program_id: zk_token_proof_program_id(),
        accounts: vec![
            AccountMeta::new(*context_account.key, false),
            AccountMeta::new(*destination.key, false),
            AccountMeta::new_readonly(*authority.key, true),
        ],
        data: vec![0xFF],
    };
    invoke(
        &ix,
        &[context_account, destination, authority, proof_program],
    )?;
    Ok(())
}

/// Helper for burner destruction: the caller must prove the confidential
/// account backing the burner has zero available balance.
pub fn verify_zero_balance(
    proof_program: AccountInfo,
    context_account: AccountInfo,
    authority: AccountInfo,
    system_program: AccountInfo,
    proof_bytes: &[u8],
) -> Result<()> {
    verify_and_store(
        proof_program,
        context_account,
        authority,
        system_program,
        ProofKind::ZeroBalance,
        proof_bytes,
    )
}

/// Helper for auditor registration: verify the auditor submitted a valid
/// ElGamal public key via a pubkey validity proof.
pub fn verify_auditor_pubkey(
    proof_program: AccountInfo,
    context_account: AccountInfo,
    authority: AccountInfo,
    system_program: AccountInfo,
    proof_bytes: &[u8],
) -> Result<()> {
    verify_and_store(
        proof_program,
        context_account,
        authority,
        system_program,
        ProofKind::PubkeyValidity,
        proof_bytes,
    )
}
