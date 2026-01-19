/**
 * Hash helpers for the mix commit-reveal protocol.
 *
 * The ghos mix commit-reveal uses a domain-separated sha256 (not blake3,
 * matching what the on-chain program can cheaply verify via syscalls). The
 * commitment binds (round_pubkey, participant_pubkey, reveal_signal, salt),
 * and the reveal later opens to exactly these same four fields.
 *
 * A separate "note" commitment exists for per-participant output amounts:
 * hash(domain || mint || denomination || elgamal_pubkey || salt).
 */

import { sha256 } from "@noble/hashes/sha256";
import { sha512 } from "@noble/hashes/sha512";
import { PublicKey } from "@solana/web3.js";
import { MIX_COMMITMENT_DOMAIN, MIX_COMMITMENT_LEN } from "../constants";
import { sdkError } from "../errors";
import { concatBytes, constantTimeEqual, hexEncode, randomBytes, toBase64 } from "../utils";
import type { ElGamalPublicKey, MixNote } from "../types";

/**
 * Compute the commitment that a participant posts in the mix commit phase.
 *
 * commitment = sha256(domain || round || participant || reveal_signal || salt)
 *
 * The salt must be drawn from the CSPRNG and kept secret until the reveal
 * phase; revealing without knowing the salt is infeasible.
 */
export function computeMixCommitment(params: {
  round: PublicKey;
  participant: PublicKey;
  revealSignal: Uint8Array;
  salt: Uint8Array;
}): Uint8Array {
  if (params.revealSignal.length !== 32) {
    throw sdkError(
      "InvalidCommitmentLength",
      `revealSignal must be 32 bytes, got ${params.revealSignal.length}`
    );
  }
  if (params.salt.length !== 32) {
    throw sdkError(
      "InvalidCommitmentLength",
      `salt must be 32 bytes, got ${params.salt.length}`
    );
  }
  const domain = new TextEncoder().encode(MIX_COMMITMENT_DOMAIN);
  const out = sha256(
    concatBytes(
      domain,
      params.round.toBytes(),
      params.participant.toBytes(),
      params.revealSignal,
      params.salt
    )
  );
  if (out.length !== MIX_COMMITMENT_LEN) {
    throw sdkError(
      "InvalidCommitmentLength",
      `commitment should be ${MIX_COMMITMENT_LEN} bytes, got ${out.length}`
    );
  }
  return out;
}

/**
 * Verify a reveal against a posted commitment.
 */
export function verifyMixCommitment(params: {
  round: PublicKey;
  participant: PublicKey;
  revealSignal: Uint8Array;
  salt: Uint8Array;
  commitment: Uint8Array;
}): boolean {
  const recomputed = computeMixCommitment(params);
  return constantTimeEqual(recomputed, params.commitment);
}

/**
 * Compute the note commitment for a mix participant's output slot.
 */
export function computeNoteCommitment(params: {
  mint: PublicKey;
  denomination: bigint;
  pubkey: ElGamalPublicKey;
  salt: Uint8Array;
}): Uint8Array {
  const denomBuf = new Uint8Array(8);
  const view = new DataView(denomBuf.buffer);
  let tmp = params.denomination;
  for (let i = 0; i < 8; i++) {
    view.setUint8(i, Number(tmp & 0xffn));
    tmp >>= 8n;
  }
  return sha256(
    concatBytes(
      new TextEncoder().encode("ghos.mix.note.v1"),
      params.mint.toBytes(),
      denomBuf,
      params.pubkey,
      params.salt
    )
  );
}

/**
 * Generate a fresh mix note with random salt, ready to be posted as a
 * commitment in a CoinJoin round.
 */
export function generateMixNote(params: {
  mint: PublicKey;
  denomination: bigint;
  pubkey: ElGamalPublicKey;
}): MixNote {
  const salt = randomBytes(32);
  const commitment = computeNoteCommitment({
    mint: params.mint,
    denomination: params.denomination,
    pubkey: params.pubkey,
    salt
  });
  return {
    salt,
    pubkey: params.pubkey,
    denomination: params.denomination,
    commitment
  };
}

/**
 * Domain-separated sha512 that returns the full 64-byte output. Used for
 * Fiat-Shamir challenges inside proof components.
 */
export function domainHashSha512(
  domain: string,
  ...messages: Array<Uint8Array | Buffer>
): Uint8Array {
  const dom = new TextEncoder().encode(domain);
  return sha512(concatBytes(dom, ...messages));
}

/**
 * Domain-separated sha256 returning 32 bytes.
 */
export function domainHashSha256(
  domain: string,
  ...messages: Array<Uint8Array | Buffer>
): Uint8Array {
  const dom = new TextEncoder().encode(domain);
  return sha256(concatBytes(dom, ...messages));
}

/**
 * Best-effort short display form for a commitment; returns first 4 + last 4
 * hex characters.
 */
export function commitmentShortForm(commitment: Uint8Array): string {
  const hex = hexEncode(commitment);
  return `${hex.slice(0, 4)}..${hex.slice(-4)}`;
}

/**
 * Encode a commitment as base64 for compact display in logs and TX memos.
 */
export function commitmentToBase64(commitment: Uint8Array): string {
  return toBase64(commitment);
}

/**
 * Randomly generate a 32-byte reveal signal. The reveal signal is the public
 * witness a participant unveils to prove they committed honestly; it is
 * intentionally opaque and carries no semantic meaning.
 */
export function randomRevealSignal(): Uint8Array {
  return randomBytes(32);
}
