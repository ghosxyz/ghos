/**
 * Deterministic proof fixtures for local validator tests.
 *
 * On a real Solana network the zk-token-proof program actually verifies the
 * twisted ElGamal ciphertext + bulletproof range proof. On a local validator
 * run without the zk-token-proof program loaded, we cannot verify real
 * proofs, so these fixtures produce byte layouts that match the expected
 * shapes and never make it into a mainnet path.
 *
 * Every helper here returns byte slices of exactly the sizes documented in
 * programs/ghos/src/constants.rs, so that accounts the SDK creates to hold
 * the proof contexts match Anchor's space calculation.
 */
import { Keypair, PublicKey } from "@solana/web3.js";
import { createHash, randomBytes } from "crypto";

/** Ciphertext size from constants.rs (ELGAMAL_CIPHERTEXT_LEN). */
export const ELGAMAL_CIPHERTEXT_LEN = 64;

/** Standard 32-byte key/commitment length used across the codebase. */
export const KEY_LEN = 32;

/**
 * Fixed-shape ciphertext pair: (c1, c2) each 32 bytes. Returned as a
 * concatenated 64-byte Uint8Array.
 */
export function stubCiphertext(seed: string, amount: bigint): Uint8Array {
  const digest = hash(`${seed}:${amount.toString(10)}`);
  const out = new Uint8Array(ELGAMAL_CIPHERTEXT_LEN);
  out.set(digest, 0);
  out.set(hash(`${seed}:${amount.toString(10)}:c2`), 32);
  return out;
}

/**
 * Pedersen-style 32-byte commitment, deterministic on input.
 */
export function stubCommitment(label: string, payload: Uint8Array): Uint8Array {
  const h = createHash("sha256");
  h.update(Buffer.from(label));
  h.update(Buffer.from(payload));
  return new Uint8Array(h.digest());
}

/**
 * Stub range proof: the zk-token-proof program expects a specific serialized
 * layout; here we emit a byte blob of the right length so the SDK can
 * pre-allocate the proof-context account. The actual verification is only
 * exercised in the devnet test file.
 */
export function stubRangeProof(bits: 64 | 128 = 64): Uint8Array {
  const size = bits === 64 ? 672 : 736;
  const buf = randomBytes(size);
  // Stamp a recognizable prefix so tests can assert the shape.
  buf[0] = 0xbb;
  buf[1] = 0x70;
  return new Uint8Array(buf);
}

/**
 * Stub equality proof blob. Size is 192 bytes per spl-zk-token-proof for the
 * ciphertext-commitment equality proof.
 */
export function stubEqualityProof(): Uint8Array {
  const buf = randomBytes(192);
  buf[0] = 0xe9;
  buf[1] = 0x01;
  return new Uint8Array(buf);
}

/**
 * Pubkey-validity proof. 64 bytes.
 */
export function stubPubkeyValidityProof(): Uint8Array {
  const buf = randomBytes(64);
  buf[0] = 0xbc;
  return new Uint8Array(buf);
}

/**
 * Zero-balance proof. 96 bytes.
 */
export function stubZeroBalanceProof(): Uint8Array {
  const buf = randomBytes(96);
  buf[0] = 0x2b;
  return new Uint8Array(buf);
}

/**
 * Returns a deterministic ElGamal "keypair" as two 32-byte arrays. This is
 * NOT a real twisted ElGamal key, it is a test harness placeholder.
 * The real keypair lives in the SDK's crypto/elgamal.ts module.
 */
export function stubElGamalKeypair(seed: string): {
  secret: Uint8Array;
  public: Uint8Array;
} {
  const secret = hash(`${seed}:secret`);
  const pub = hash(`${seed}:public`);
  return { secret, public: pub };
}

/**
 * Deterministic hash of a string into 32 bytes.
 */
export function hash(input: string): Uint8Array {
  const h = createHash("sha256");
  h.update(Buffer.from(input));
  return new Uint8Array(h.digest());
}

/**
 * Helper to decide whether we should skip proof-dependent tests. Set
 * GHOS_SKIP_REAL_PROOFS=1 to force the stub path even on devnet.
 */
export function shouldUseStubProofs(): boolean {
  return process.env.GHOS_SKIP_REAL_PROOFS === "1";
}

/**
 * Bundle of every proof an instruction may consume. Returned by the
 * end-to-end test helpers so each `it()` block gets a fresh set.
 */
export interface ProofBundle {
  sourceCiphertext: Uint8Array;
  destinationCiphertext: Uint8Array;
  rangeProof: Uint8Array;
  equalityProof: Uint8Array;
  pubkeyValidityProof: Uint8Array;
}

/**
 * Build a full proof bundle for a confidential transfer from `source` to
 * `destination` of `amount`.
 */
export function buildProofBundle(
  source: PublicKey,
  destination: PublicKey,
  amount: bigint
): ProofBundle {
  return {
    sourceCiphertext: stubCiphertext(
      `${source.toBase58()}->${destination.toBase58()}`,
      amount
    ),
    destinationCiphertext: stubCiphertext(
      `${destination.toBase58()}<-${source.toBase58()}`,
      amount
    ),
    rangeProof: stubRangeProof(64),
    equalityProof: stubEqualityProof(),
    pubkeyValidityProof: stubPubkeyValidityProof(),
  };
}

/**
 * Commitment helper used by the mix harness. Participants commit to
 * (note, output_address, salt) during the commit phase and reveal in the
 * reveal phase.
 */
export function buildMixCommitment(
  note: bigint,
  outputAddress: PublicKey,
  salt: Uint8Array
): Uint8Array {
  const amountBuf = Buffer.alloc(8);
  amountBuf.writeBigUInt64LE(note);
  const h = createHash("sha256");
  h.update(Buffer.from("ghos.mix.commit.v1"));
  h.update(amountBuf);
  h.update(outputAddress.toBuffer());
  h.update(Buffer.from(salt));
  return new Uint8Array(h.digest());
}

/**
 * Stretchy salt generator for mix commitments.
 */
export function mixSalt(participantIndex: number): Uint8Array {
  return hash(`ghos.mix.salt:${participantIndex}:${Date.now()}`);
}

/**
 * Byte-level equality check, kept here so proof tests don't pull in
 * chai's deep-equal for 32-byte arrays.
 */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Wrap a 32-byte slice in a Solana PublicKey view, used when passing a
 * derived ElGamal public key into an instruction that accepts a pubkey-
 * typed account meta.
 */
export function elGamalPubkeyAsPublicKey(pubkey: Uint8Array): PublicKey {
  if (pubkey.length !== 32) {
    throw new Error("ElGamal pubkey must be exactly 32 bytes");
  }
  return new PublicKey(pubkey);
}

/**
 * Utility: convert a Keypair's public key into 32 raw bytes.
 */
export function keypairPubkeyBytes(k: Keypair): Uint8Array {
  return new Uint8Array(k.publicKey.toBytes());
}
