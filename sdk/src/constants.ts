/**
 * Protocol-level constants shared between the ghos Anchor program and the
 * TypeScript SDK. Every value in this file mirrors a value in the on-chain
 * `programs/ghos/src/constants.rs` module. Drift between these two files is a
 * protocol-breaking condition and must be caught at review time.
 *
 * The SDK depends on these numbers for:
 *   - PDA derivation (seeds)
 *   - Pre-flight validation of user input (dust floor, burner TTL bounds)
 *   - Serialization sizing (ciphertext length, commitment length)
 *   - Compute-unit budgeting of proof-heavy transactions
 */

import { PublicKey } from "@solana/web3.js";

/**
 * The on-chain program id for the ghos Anchor program, deployed identically on
 * devnet and mainnet. If you are running a local validator for testing, override
 * this via the `programId` option on `GhosClient`.
 */
export const GHOS_PROGRAM_ID: PublicKey = new PublicKey(
  "EnKo8EbfJkani8UePTmAVPzdCZM8vMEYYkjTar4fwBPg"
);

/**
 * Token-2022 program id. ghos only operates on Token-2022 mints that have the
 * confidential transfer extension enabled. Classical SPL Token accounts are
 * rejected at the program boundary.
 */
export const TOKEN_2022_PROGRAM_ID: PublicKey = new PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
);

/**
 * Classic SPL Token program id, kept for completeness so SDK callers can
 * differentiate the two when constructing an `ata_create` fallback chain.
 */
export const SPL_TOKEN_PROGRAM_ID: PublicKey = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);

/**
 * Associated Token Account program id.
 */
export const ASSOCIATED_TOKEN_PROGRAM_ID: PublicKey = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);

/**
 * The spl-zk-token-proof program id, fixed across clusters. Range / equality /
 * pubkey-validity proofs are verified by CPI into this program.
 */
export const ZK_TOKEN_PROOF_PROGRAM_ID: PublicKey = new PublicKey(
  "ZkTokenProof1111111111111111111111111111111"
);

/**
 * The SystemProgram id, hardcoded here for legibility so seed tables read as a
 * single cohesive set of constants.
 */
export const SYSTEM_PROGRAM_ID: PublicKey = new PublicKey(
  "11111111111111111111111111111111"
);

/**
 * Sysvar rent id. Needed by Anchor's init attribute.
 */
export const RENT_SYSVAR_ID: PublicKey = new PublicKey(
  "SysvarRent111111111111111111111111111111111"
);

/** Seed for the singleton GhosConfig PDA. */
export const CONFIG_SEED: Buffer = Buffer.from("ghos.config");

/** Seed for per-owner burner registry entries. */
export const BURNER_SEED: Buffer = Buffer.from("ghos.burner");

/** Seed for CoinJoin round accounts. */
export const MIX_ROUND_SEED: Buffer = Buffer.from("ghos.mix.round");

/** Seed for per-participant mix commitment entries. */
export const MIX_COMMITMENT_SEED: Buffer = Buffer.from("ghos.mix.commit");

/** Seed for per-mint auditor registry entries. */
export const AUDITOR_SEED: Buffer = Buffer.from("ghos.auditor");

/** Seed for the protocol padding vault. */
export const PADDING_VAULT_SEED: Buffer = Buffer.from("ghos.padding");

/** Numeric tag of the running protocol version (major.minor packed, 0x0401 => 4.1). */
export const PROTOCOL_VERSION = 0x0401;

/** Hard cap on participants in a single mix round. */
export const MIX_MAX_PARTICIPANTS = 16;

/** Minimum number of participants for anonymity set guarantee. */
export const MIX_MIN_PARTICIPANTS = 4;

/** Maximum TTL (seconds) for a burner account, 30 days. */
export const BURNER_TTL_MAX_SECONDS = 60 * 60 * 24 * 30;

/** Minimum TTL (seconds) for a burner account, 60s. */
export const BURNER_TTL_MIN_SECONDS = 60;

/** Dust-free quantization unit. All amounts must be a multiple of this. */
export const DUST_FREE_UNIT = 1000n;

/** Maximum concurrent burner registry entries per owner. */
export const BURNER_REGISTRY_CAP_PER_OWNER = 64;

/** Byte length of an auditor (ElGamal) public key on Ristretto255. */
export const AUDITOR_PUBKEY_LEN = 32;

/** Byte length of a twisted ElGamal ciphertext (C1 || C2). */
export const ELGAMAL_CIPHERTEXT_LEN = 64;

/** Byte length of the mix round Blake3 commitment. */
export const MIX_COMMITMENT_LEN = 32;

/** Reveal window (seconds) for CoinJoin mix rounds. */
export const MIX_REVEAL_WINDOW_SECONDS = 60 * 10;

/** Extra lamports withheld to cover the auditor co-sign roundtrip. */
export const AUDITOR_COSIGN_LAMPORTS = 5000n;

/** Default compute-unit budget for proof-heavy transactions. */
export const RECOMMENDED_CU_BUDGET = 600_000;

/** Default priority fee (micro-lamports per CU) if the caller does not override. */
export const DEFAULT_PRIORITY_FEE_MICROLAMPORTS = 5000;

/**
 * Maximum serialized size of a bulletproof for a 64-bit range. The exact byte
 * count depends on the proof layout used by spl-zk-token-proof, but this upper
 * bound governs transaction packing decisions in the SDK.
 */
export const BULLETPROOF_MAX_BYTES = 736;

/**
 * Byte length of a Ristretto255 compressed point, used in raw proof encodings.
 */
export const RISTRETTO255_POINT_LEN = 32;

/**
 * Byte length of a Ristretto255 scalar, used in raw proof encodings.
 */
export const RISTRETTO255_SCALAR_LEN = 32;

/**
 * Fixed-string discriminator for the protocol genesis mark, used by tests to
 * assert a clean init against a brand-new cluster.
 */
export const GENESIS_MARK = "ghos.genesis.0401";

/**
 * Retry policy used by the SDK for transient RPC errors. Tunable, but the
 * defaults are reasonable for devnet + mainnet.
 */
export const DEFAULT_RETRY_POLICY = {
  maxRetries: 3,
  baseDelayMs: 400,
  maxDelayMs: 4000,
  jitter: true
} as const;

/**
 * Anchor discriminator length (leading 8 bytes of every account / instruction
 * payload). Exposed so decoders elsewhere in the SDK do not have to hardcode
 * the literal 8 repeatedly.
 */
export const ANCHOR_DISCRIMINATOR_LEN = 8;

/**
 * Commonly used RPC endpoints for the supported clusters.
 */
export const CLUSTER_ENDPOINTS = {
  devnet: "https://api.devnet.solana.com",
  testnet: "https://api.testnet.solana.com",
  mainnet: "https://api.mainnet-beta.solana.com"
} as const;

/**
 * Union of the clusters ghos officially supports.
 */
export type GhosCluster = keyof typeof CLUSTER_ENDPOINTS;

/**
 * Maximum number of participants whose commitments can be packed into a single
 * settle transaction. Mirrors the on-chain CU budget analysis; this SDK-side
 * limit keeps the client-side proof aggregation honest.
 */
export const MIX_SETTLE_BATCH_CAP = 8;

/**
 * ElGamal key derivation domain-separator string. Every derived keypair is
 * generated by hashing this tag with the owner's canonical signature over a
 * fixed challenge message, guaranteeing that a different domain produces a
 * different keypair even if the signer is reused.
 */
export const ELGAMAL_DERIVATION_DOMAIN = "ghos.elgamal.v1";

/**
 * Commitment domain-separator string for the mix commit-reveal protocol.
 */
export const MIX_COMMITMENT_DOMAIN = "ghos.mix.commit.v1";

/**
 * Challenge message signed by the owner when deriving the ElGamal keypair
 * deterministically. This is never transmitted on-chain, it is only used
 * locally to mix into the blake3 hash.
 */
export const OWNER_DERIVATION_CHALLENGE = Buffer.from(
  "ghos.owner.challenge.v1"
);
