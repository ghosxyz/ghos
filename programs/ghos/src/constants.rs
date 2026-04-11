//! Compile-time constants shared by every instruction handler.
//!
//! Seeds are consumed by both the program and the SDK. Changing a seed is a
//! protocol-breaking change and must be accompanied by a major version bump.

use anchor_lang::prelude::*;

/// PDA seed for the singleton protocol config account.
pub const CONFIG_SEED: &[u8] = b"ghos.config";

/// PDA seed for a per-owner burner registry entry.
pub const BURNER_SEED: &[u8] = b"ghos.burner";

/// PDA seed for a CoinJoin round account.
pub const MIX_ROUND_SEED: &[u8] = b"ghos.mix.round";

/// PDA seed for a per-participant mix commitment entry.
pub const MIX_COMMITMENT_SEED: &[u8] = b"ghos.mix.commit";

/// PDA seed for the per-mint auditor registry entry.
pub const AUDITOR_SEED: &[u8] = b"ghos.auditor";

/// PDA seed for the protocol vault that temporarily holds dust-free padding
/// refunds during a shield flow.
pub const PADDING_VAULT_SEED: &[u8] = b"ghos.padding";

/// Hard cap on the number of participants in a single mix round. Above this
/// the range proof verification cost outgrows the compute-unit budget.
pub const MIX_MAX_PARTICIPANTS: u8 = 16;

/// Minimum participants to satisfy the anonymity set guarantee.
pub const MIX_MIN_PARTICIPANTS: u8 = 4;

/// Upper bound on burner TTL in seconds (30 days).
pub const BURNER_TTL_MAX_SECONDS: i64 = 60 * 60 * 24 * 30;

/// Lower bound on burner TTL in seconds (1 minute). Prevents accidental
/// zero-TTL entries.
pub const BURNER_TTL_MIN_SECONDS: i64 = 60;

/// Amount quantization unit for dust-free transfer padding. Amounts below the
/// unit are rejected to prevent dust-based deanonymization.
pub const DUST_FREE_UNIT: u64 = 1_000;

/// Maximum number of burner entries a single owner may register concurrently.
pub const BURNER_REGISTRY_CAP_PER_OWNER: u16 = 64;

/// Protocol version tag, stored in the config account at initialize time.
pub const PROTOCOL_VERSION: u16 = 0x0401;

/// Auditor key size in bytes (ElGamal public key over Ristretto255).
pub const AUDITOR_PUBKEY_LEN: usize = 32;

/// Amount of lamports withheld to cover a withdraw co-sign roundtrip if an
/// auditor is registered for the mint.
pub const AUDITOR_COSIGN_LAMPORTS: u64 = 5_000;

/// Commitment hash length for mix commit-reveal (Blake3 output).
pub const MIX_COMMITMENT_LEN: usize = 32;

/// Seconds window in which a commitment must be revealed after the commit
/// phase closes. Past this, the round aborts and participants can refund.
pub const MIX_REVEAL_WINDOW_SECONDS: i64 = 60 * 10;

/// The zk-token-proof program id on all Solana clusters.
#[allow(non_snake_case)]
pub fn zk_token_proof_program_id() -> Pubkey {
    // spl-zk-token-proof program address, fixed across clusters.
    "ZkTokenProof1111111111111111111111111111111"
        .parse()
        .expect("invalid hardcoded zk token proof program id")
}

/// Size of a twisted ElGamal ciphertext (C1 || C2), 64 bytes.
pub const ELGAMAL_CIPHERTEXT_LEN: usize = 64;

/// Default amount of compute units the SDK requests for proof-heavy transfer
/// instructions. The program itself does not enforce this, but it is encoded
/// here so the SDK and CLI agree.
pub const RECOMMENDED_CU_BUDGET: u32 = 600_000;

// refactor: tighten GhosConfig burner field defaults

// chore: tighten burner ttl max clamp to 30 days
