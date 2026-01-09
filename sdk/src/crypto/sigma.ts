/**
 * Sigma protocols used by ghos: equality of plaintexts, public-key validity,
 * and zero-balance attestations.
 *
 * Each function here produces a real Sigma-style proof of the relation it
 * claims. The construction follows the Token-2022 confidential-transfer
 * reference:
 *   - EqualityProof: prove two ElGamal ciphertexts under different public
 *     keys encrypt the same plaintext.
 *   - PubkeyValidityProof: prove a Ristretto255 point has a known discrete
 *     log relative to G (i.e. was produced by the keygen procedure).
 *   - ZeroBalanceProof: prove a ciphertext encrypts zero.
 *
 * The transcripts are deterministic Fiat-Shamir via sha512.
 */

import { RistrettoPoint } from "@noble/curves/ed25519";
import { mod } from "@noble/curves/abstract/modular";
import { sha512 } from "@noble/hashes/sha512";
import {
  CURVE_ORDER,
  baseG,
  multBaseG,
  pointFromBytes,
  pointToBytes,
  scalarFromLE32,
  scalarFromUniform64,
  scalarToLE32,
  twistedH
} from "./elgamal";
import { sdkError } from "../errors";
import { concatBytes, constantTimeEqual, randomBytes } from "../utils";
import type {
  ElGamalCiphertext,
  ElGamalPublicKey,
  ElGamalSecretKey,
  EqualityProof,
  PubkeyValidityProof,
  ZeroBalanceProof
} from "../types";

/** Domain-separator for equality proofs. */
const EQUALITY_DOMAIN = new TextEncoder().encode("ghos.sigma.equality.v1");

/** Domain-separator for pubkey-validity proofs. */
const PUBKEY_VALIDITY_DOMAIN = new TextEncoder().encode(
  "ghos.sigma.pkvalid.v1"
);

/** Domain-separator for zero-balance proofs. */
const ZERO_BALANCE_DOMAIN = new TextEncoder().encode("ghos.sigma.zero.v1");

/**
 * Compute a Fiat-Shamir challenge from a list of labeled messages. Uses sha512
 * then reduces mod curve order.
 */
function transcriptChallenge(
  domain: Uint8Array,
  messages: Uint8Array[]
): bigint {
  const buf = concatBytes(domain, ...messages);
  return scalarFromUniform64(sha512(buf));
}

/**
 * Prove that a transfer ciphertext under `sourcePk` encrypts the same value
 * as a transfer ciphertext under `destPk`. The prover knows the plaintext
 * `v`, the source randomness `rS` and the destination randomness `rD`.
 *
 * Produces a 3-move Sigma proof collapsed via Fiat-Shamir:
 *   - Commit: pick (t1, t2, t3), compute (A1, A2, A3).
 *   - Challenge: c = H(inputs || A1 || A2 || A3).
 *   - Response: z1 = t1 + c*v, z2 = t2 + c*rS, z3 = t3 + c*rD.
 * The verifier checks the corresponding linear equations.
 */
export function proveEquality(params: {
  sourcePk: ElGamalPublicKey;
  destPk: ElGamalPublicKey;
  v: bigint;
  rS: bigint;
  rD: bigint;
}): EqualityProof {
  const { sourcePk, destPk, v, rS, rD } = params;
  const sourcePoint = pointFromBytes(sourcePk);
  const destPoint = pointFromBytes(destPk);

  const vScalar = mod(v, CURVE_ORDER);
  const rSScalar = mod(rS, CURVE_ORDER);
  const rDScalar = mod(rD, CURVE_ORDER);

  const t1 = scalarFromUniform64(randomBytes(64));
  const t2 = scalarFromUniform64(randomBytes(64));
  const t3 = scalarFromUniform64(randomBytes(64));

  // Commitments:
  //   A1 = t1 * H + t2 * G     (matches C1 structure for source)
  //   A2 = t1 * H + t3 * G     (matches C1 structure for destination)
  //   A3 = t2 * sourcePk       (matches C2 of source)
  //   A4 = t3 * destPk         (matches C2 of destination)
  const A1 = twistedH().multiply(t1).add(baseG().multiply(t2));
  const A2 = twistedH().multiply(t1).add(baseG().multiply(t3));
  const A3 = sourcePoint.multiply(t2);
  const A4 = destPoint.multiply(t3);

  const c1Source = pedersenC1(vScalar, rSScalar);
  const c1Dest = pedersenC1(vScalar, rDScalar);
  const c2Source = sourcePoint.multiply(rSScalar);
  const c2Dest = destPoint.multiply(rDScalar);

  const challenge = transcriptChallenge(EQUALITY_DOMAIN, [
    sourcePk,
    destPk,
    pointToBytes(c1Source),
    pointToBytes(c2Source),
    pointToBytes(c1Dest),
    pointToBytes(c2Dest),
    pointToBytes(A1),
    pointToBytes(A2),
    pointToBytes(A3),
    pointToBytes(A4)
  ]);

  const z1 = mod(t1 + mod(challenge * vScalar, CURVE_ORDER), CURVE_ORDER);
  const z2 = mod(t2 + mod(challenge * rSScalar, CURVE_ORDER), CURVE_ORDER);
  const z3 = mod(t3 + mod(challenge * rDScalar, CURVE_ORDER), CURVE_ORDER);

  const proofBytes = concatBytes(
    pointToBytes(A1),
    pointToBytes(A2),
    pointToBytes(A3),
    pointToBytes(A4),
    scalarToLE32(z1),
    scalarToLE32(z2),
    scalarToLE32(z3)
  );

  return {
    proofBytes,
    sourceCommitment: pointToBytes(c1Source),
    destCommitment: pointToBytes(c1Dest)
  };
}

/**
 * Verify an equality proof. Recomputes the challenge, then checks the three
 * Sigma equations. Returns true on success.
 */
export function verifyEquality(
  params: {
    sourcePk: ElGamalPublicKey;
    destPk: ElGamalPublicKey;
    sourceCt: ElGamalCiphertext;
    destCt: ElGamalCiphertext;
  },
  proof: EqualityProof
): boolean {
  if (proof.proofBytes.length !== 32 * 4 + 32 * 3) {
    return false;
  }
  try {
    const sourcePoint = pointFromBytes(params.sourcePk);
    const destPoint = pointFromBytes(params.destPk);
    const A1 = pointFromBytes(proof.proofBytes.slice(0, 32));
    const A2 = pointFromBytes(proof.proofBytes.slice(32, 64));
    const A3 = pointFromBytes(proof.proofBytes.slice(64, 96));
    const A4 = pointFromBytes(proof.proofBytes.slice(96, 128));
    const z1 = scalarFromLE32(proof.proofBytes.slice(128, 160));
    const z2 = scalarFromLE32(proof.proofBytes.slice(160, 192));
    const z3 = scalarFromLE32(proof.proofBytes.slice(192, 224));

    const c1Source = pointFromBytes(params.sourceCt.c1);
    const c2Source = pointFromBytes(params.sourceCt.c2);
    const c1Dest = pointFromBytes(params.destCt.c1);
    const c2Dest = pointFromBytes(params.destCt.c2);

    const challenge = transcriptChallenge(EQUALITY_DOMAIN, [
      params.sourcePk,
      params.destPk,
      pointToBytes(c1Source),
      pointToBytes(c2Source),
      pointToBytes(c1Dest),
      pointToBytes(c2Dest),
      pointToBytes(A1),
      pointToBytes(A2),
      pointToBytes(A3),
      pointToBytes(A4)
    ]);

    // z1 * H + z2 * G =? A1 + c * C1_source
    const lhs1 = twistedH().multiply(z1).add(baseG().multiply(z2));
    const rhs1 = A1.add(c1Source.multiply(challenge));
    if (!pointsEqual(lhs1, rhs1)) {
      return false;
    }
    // z1 * H + z3 * G =? A2 + c * C1_dest
    const lhs2 = twistedH().multiply(z1).add(baseG().multiply(z3));
    const rhs2 = A2.add(c1Dest.multiply(challenge));
    if (!pointsEqual(lhs2, rhs2)) {
      return false;
    }
    // z2 * sourcePk =? A3 + c * C2_source
    const lhs3 = sourcePoint.multiply(z2);
    const rhs3 = A3.add(c2Source.multiply(challenge));
    if (!pointsEqual(lhs3, rhs3)) {
      return false;
    }
    // z3 * destPk =? A4 + c * C2_dest
    const lhs4 = destPoint.multiply(z3);
    const rhs4 = A4.add(c2Dest.multiply(challenge));
    if (!pointsEqual(lhs4, rhs4)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Prove that a public key was produced via `pk = sk * G` for some secret sk.
 * A classic Schnorr proof of knowledge.
 */
export function provePubkeyValidity(
  secret: ElGamalSecretKey
): PubkeyValidityProof {
  const skScalar = scalarFromLE32(secret);
  if (skScalar === 0n) {
    throw sdkError("InvalidKeyDerivation", "cannot prove validity of zero key");
  }
  const pkPoint = multBaseG(skScalar);
  const r = scalarFromUniform64(randomBytes(64));
  const R = multBaseG(r);

  const challenge = transcriptChallenge(PUBKEY_VALIDITY_DOMAIN, [
    pointToBytes(pkPoint),
    pointToBytes(R)
  ]);
  const z = mod(r + mod(challenge * skScalar, CURVE_ORDER), CURVE_ORDER);

  return {
    proofBytes: concatBytes(pointToBytes(R), scalarToLE32(z)),
    pubkey: pointToBytes(pkPoint)
  };
}

/**
 * Verify a pubkey-validity proof.
 */
export function verifyPubkeyValidity(proof: PubkeyValidityProof): boolean {
  if (proof.proofBytes.length !== 64) {
    return false;
  }
  try {
    const pkPoint = pointFromBytes(proof.pubkey);
    const R = pointFromBytes(proof.proofBytes.slice(0, 32));
    const z = scalarFromLE32(proof.proofBytes.slice(32, 64));
    const challenge = transcriptChallenge(PUBKEY_VALIDITY_DOMAIN, [
      pointToBytes(pkPoint),
      pointToBytes(R)
    ]);
    // z * G =? R + c * pk
    const lhs = baseG().multiply(z);
    const rhs = R.add(pkPoint.multiply(challenge));
    return pointsEqual(lhs, rhs);
  } catch {
    return false;
  }
}

/**
 * Prove that the supplied ciphertext encrypts zero under `pk`. The prover
 * knows the randomness r such that (C1, C2) = (r*G, r*pk).
 *
 * Two-generator Schnorr: commit with (t*G, t*pk), challenge c, respond
 * z = t + c*r. Verifier checks z*G = A1 + c*C1 and z*pk = A2 + c*C2.
 */
export function proveZeroBalance(
  pk: ElGamalPublicKey,
  ciphertext: ElGamalCiphertext,
  r: bigint
): ZeroBalanceProof {
  const pkPoint = pointFromBytes(pk);
  const t = scalarFromUniform64(randomBytes(64));
  const A1 = multBaseG(t);
  const A2 = pkPoint.multiply(t);
  const challenge = transcriptChallenge(ZERO_BALANCE_DOMAIN, [
    pk,
    ciphertext.c1,
    ciphertext.c2,
    pointToBytes(A1),
    pointToBytes(A2)
  ]);
  const z = mod(t + mod(challenge * mod(r, CURVE_ORDER), CURVE_ORDER), CURVE_ORDER);
  return {
    proofBytes: concatBytes(pointToBytes(A1), pointToBytes(A2), scalarToLE32(z)),
    ciphertext
  };
}

/**
 * Verify a zero-balance proof.
 */
export function verifyZeroBalance(
  pk: ElGamalPublicKey,
  proof: ZeroBalanceProof
): boolean {
  if (proof.proofBytes.length !== 32 * 2 + 32) {
    return false;
  }
  try {
    const pkPoint = pointFromBytes(pk);
    const A1 = pointFromBytes(proof.proofBytes.slice(0, 32));
    const A2 = pointFromBytes(proof.proofBytes.slice(32, 64));
    const z = scalarFromLE32(proof.proofBytes.slice(64, 96));
    const c1 = pointFromBytes(proof.ciphertext.c1);
    const c2 = pointFromBytes(proof.ciphertext.c2);
    const challenge = transcriptChallenge(ZERO_BALANCE_DOMAIN, [
      pk,
      proof.ciphertext.c1,
      proof.ciphertext.c2,
      pointToBytes(A1),
      pointToBytes(A2)
    ]);
    // z * G =? A1 + c * C1
    const lhs1 = baseG().multiply(z);
    const rhs1 = A1.add(c1.multiply(challenge));
    if (!pointsEqual(lhs1, rhs1)) {
      return false;
    }
    // z * pk =? A2 + c * C2
    const lhs2 = pkPoint.multiply(z);
    const rhs2 = A2.add(c2.multiply(challenge));
    if (!pointsEqual(lhs2, rhs2)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Helper: construct the C1 half of a twisted ElGamal ciphertext, namely
 * v * H + r * G. Exposed because the equality prover re-derives the value
 * locally from the known plaintext without going through encrypt().
 */
function pedersenC1(
  vScalar: bigint,
  rScalar: bigint
): typeof RistrettoPoint.BASE {
  const vH = vScalar === 0n ? RistrettoPoint.ZERO : twistedH().multiply(vScalar);
  const rG = rScalar === 0n ? RistrettoPoint.ZERO : baseG().multiply(rScalar);
  return vH.add(rG);
}

/**
 * Helper: constant-time Ristretto point equality via serialization compare.
 */
function pointsEqual(
  a: typeof RistrettoPoint.BASE,
  b: typeof RistrettoPoint.BASE
): boolean {
  return constantTimeEqual(a.toRawBytes(), b.toRawBytes());
}
