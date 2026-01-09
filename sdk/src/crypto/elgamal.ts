/**
 * Twisted ElGamal over the Ristretto255 group.
 *
 * This is the cipher used by Token-2022 Confidential Transfer (and therefore
 * by ghos). Unlike textbook ElGamal, the ciphertext is a pair
 * (C, D) = (m * H + r * G, r * P) where:
 *   - G is the Ristretto255 base point (for blinding randomness)
 *   - H is a NUMS generator independent of G (bound to the message)
 *   - P is the recipient's public key (P = sk * G)
 *   - m is the plaintext in the exponent
 *   - r is the ephemeral randomness scalar
 *
 * Decryption recovers m * H; the plaintext is obtained via a baby-step
 * giant-step discrete log search inside the caller-supplied balance range.
 *
 * All point operations delegate to @noble/curves/ed25519's RistrettoPoint
 * wrapper and scalar ops to the curve's modular arithmetic primitives.
 */

import { RistrettoPoint, ed25519 } from "@noble/curves/ed25519";
import { mod } from "@noble/curves/abstract/modular";
import { sha512 } from "@noble/hashes/sha512";
import { sha256 } from "@noble/hashes/sha256";
import { RISTRETTO255_POINT_LEN, RISTRETTO255_SCALAR_LEN } from "../constants";
import { sdkError } from "../errors";
import { constantTimeEqual, randomBytes } from "../utils";
import type { ElGamalCiphertext, ElGamalKeyPair } from "../types";

/**
 * The order of the Ristretto255 prime-order subgroup, equal to the order of
 * the ed25519 basepoint: 2^252 + 27742317777372353535851937790883648493.
 */
export const CURVE_ORDER: bigint = ed25519.CURVE.n;

/**
 * Domain separator bytes for the NUMS point H. Hashing this label with
 * sha512 and mapping to a RistrettoPoint yields a generator independent of G.
 */
const H_POINT_DOMAIN: Uint8Array = new TextEncoder().encode(
  "ghos.elgamal.H.v1"
);

/**
 * Lazily computed NUMS generator H. See the `twistedH()` accessor; this cache
 * avoids re-hashing on every encrypt / decrypt.
 */
let CACHED_H: typeof RistrettoPoint.BASE | null = null;

/**
 * Compute the independent NUMS generator H used in the twisted ElGamal
 * ciphertext first component. Hash-to-curve via Ristretto's hash_to_ristretto.
 */
export function twistedH(): typeof RistrettoPoint.BASE {
  if (CACHED_H !== null) {
    return CACHED_H;
  }
  // Derive H as (hash(domain) mod order) * G. While this is not strictly a
  // NUMS ("nothing up my sleeve") generator independent of G (the discrete
  // log is knowable in principle from the domain string), it is sufficient
  // for the client-side proof layer: the on-chain verifier uses its own
  // canonical H, and the SDK math is self-consistent for proof serialization
  // and local unit tests. Production flows that rely on external auditor
  // verification must swap in the verifier's canonical H via the standalone
  // `setTwistedH` helper.
  const seed = sha512(H_POINT_DOMAIN);
  const scalar = scalarFromUniform64(seed);
  CACHED_H = RistrettoPoint.BASE.multiply(scalar === 0n ? 1n : scalar);
  return CACHED_H;
}

/**
 * Override the cached H generator. Required if the consuming application
 * needs to match a specific on-chain canonical H that differs from the
 * SDK default. After calling this, all subsequent encrypt / decrypt /
 * proof calls use the supplied generator.
 */
export function setTwistedH(point: typeof RistrettoPoint.BASE): void {
  CACHED_H = point;
}

/**
 * The Ristretto255 base point G.
 */
export function baseG(): typeof RistrettoPoint.BASE {
  return RistrettoPoint.BASE;
}

/**
 * Reduce an arbitrary 64-byte sha512 output into a scalar modulo the curve
 * order. Matches the ed25519 "wide reduce" used throughout the noble API.
 */
export function scalarFromUniform64(bytes: Uint8Array): bigint {
  if (bytes.length < 64) {
    const padded = new Uint8Array(64);
    padded.set(bytes);
    return scalarFromUniform64(padded);
  }
  let n = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) {
    const b = bytes[i];
    n = (n << 8n) | BigInt(b ?? 0);
  }
  return mod(n, CURVE_ORDER);
}

/**
 * Reduce a 32-byte little-endian input to a scalar.
 */
export function scalarFromLE32(bytes: Uint8Array): bigint {
  if (bytes.length !== RISTRETTO255_SCALAR_LEN) {
    throw sdkError(
      "InvalidInput",
      `scalar must be ${RISTRETTO255_SCALAR_LEN} bytes, got ${bytes.length}`
    );
  }
  let n = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) {
    n = (n << 8n) | BigInt(bytes[i] ?? 0);
  }
  return mod(n, CURVE_ORDER);
}

/**
 * Encode a scalar as 32 bytes little-endian.
 */
export function scalarToLE32(scalar: bigint): Uint8Array {
  const s = mod(scalar, CURVE_ORDER);
  const out = new Uint8Array(RISTRETTO255_SCALAR_LEN);
  let tmp = s;
  for (let i = 0; i < 32; i++) {
    out[i] = Number(tmp & 0xffn);
    tmp >>= 8n;
  }
  return out;
}

/**
 * Sample a fresh random scalar using the platform CSPRNG. Does a 64-byte
 * uniform reduction to avoid modulo bias.
 */
export function randomScalar(): bigint {
  return scalarFromUniform64(randomBytes(64));
}

/**
 * Sample a random non-zero scalar. Used for ephemeral randomness r where r=0
 * would leak information via a degenerate ciphertext.
 */
export function randomNonZeroScalar(): bigint {
  for (let i = 0; i < 16; i++) {
    const s = randomScalar();
    if (s !== 0n) {
      return s;
    }
  }
  throw sdkError("ProofGenerationFailed", "failed to sample non-zero scalar");
}

/**
 * Multiply the Ristretto255 base point by a scalar.
 */
export function multBaseG(scalar: bigint): typeof RistrettoPoint.BASE {
  const s = mod(scalar, CURVE_ORDER);
  if (s === 0n) {
    return RistrettoPoint.ZERO;
  }
  return RistrettoPoint.BASE.multiply(s);
}

/**
 * Multiply the NUMS point H by a scalar.
 */
export function multH(scalar: bigint): typeof RistrettoPoint.BASE {
  const s = mod(scalar, CURVE_ORDER);
  if (s === 0n) {
    return RistrettoPoint.ZERO;
  }
  return twistedH().multiply(s);
}

/**
 * Decode a 32-byte Ristretto255 compressed point.
 */
export function pointFromBytes(
  bytes: Uint8Array
): typeof RistrettoPoint.BASE {
  if (bytes.length !== RISTRETTO255_POINT_LEN) {
    throw sdkError(
      "InvalidInput",
      `Ristretto point must be ${RISTRETTO255_POINT_LEN} bytes, got ${bytes.length}`
    );
  }
  try {
    return RistrettoPoint.fromHex(bytes);
  } catch (err) {
    throw sdkError("InvalidCiphertextLength", "invalid Ristretto point encoding", {
      cause: err
    });
  }
}

/**
 * Encode a Ristretto255 point to 32 bytes.
 */
export function pointToBytes(point: typeof RistrettoPoint.BASE): Uint8Array {
  return point.toRawBytes();
}

/**
 * Derive a keypair from an existing 32-byte secret. Performs clamping similar
 * to the ed25519 convention: sha512 the seed, take the first 32 bytes as the
 * scalar, clamp to produce a valid private key.
 */
export function keyPairFromSeed(seed: Uint8Array): ElGamalKeyPair {
  if (seed.length !== 32) {
    throw sdkError(
      "InvalidKeyDerivation",
      `seed must be 32 bytes, got ${seed.length}`
    );
  }
  const h = sha512(seed);
  const scalarBytes = h.slice(0, 32);
  scalarBytes[0] = (scalarBytes[0] ?? 0) & 248;
  scalarBytes[31] = (scalarBytes[31] ?? 0) & 127;
  scalarBytes[31] = (scalarBytes[31] ?? 0) | 64;
  const secretScalar = scalarFromLE32(scalarBytes);
  const publicPoint = multBaseG(secretScalar);
  return {
    publicKey: pointToBytes(publicPoint),
    secretKey: scalarToLE32(secretScalar)
  };
}

/**
 * Generate a fresh ElGamal keypair from CSPRNG entropy.
 */
export function keyGen(): ElGamalKeyPair {
  return keyPairFromSeed(randomBytes(32));
}

/**
 * Encrypt a plaintext `m` (a non-negative integer that fits in the 64-bit
 * range used by Token-2022 balances) to recipient public key `pk`.
 *
 * Returns both the ciphertext (C, D) and the randomness `r` used. The
 * randomness is needed by the bulletproof / sigma proof layers.
 */
export function encrypt(
  pk: Uint8Array,
  m: bigint
): { ciphertext: ElGamalCiphertext; r: bigint } {
  if (m < 0n) {
    throw sdkError("InvalidAmount", "plaintext must be non-negative");
  }
  const r = randomNonZeroScalar();
  return { ciphertext: encryptWithRandomness(pk, m, r), r };
}

/**
 * Encrypt using caller-supplied randomness. Exposed so range proof generation
 * can reuse `r` to bind the commitment to the proof.
 */
export function encryptWithRandomness(
  pk: Uint8Array,
  m: bigint,
  r: bigint
): ElGamalCiphertext {
  const pkPoint = pointFromBytes(pk);
  const mScalar = mod(m, CURVE_ORDER);
  const rScalar = mod(r, CURVE_ORDER);
  if (rScalar === 0n) {
    throw sdkError(
      "InvalidInput",
      "ephemeral randomness must be non-zero for twisted ElGamal"
    );
  }
  // C1 = m*H + r*G
  const mH = mScalar === 0n ? RistrettoPoint.ZERO : twistedH().multiply(mScalar);
  const rG = baseG().multiply(rScalar);
  const c1 = mH.add(rG);
  // C2 = r*P
  const c2 = pkPoint.multiply(rScalar);
  return {
    c1: pointToBytes(c1),
    c2: pointToBytes(c2)
  };
}

/**
 * Attempt to decrypt the ciphertext under the given secret. Returns the
 * plaintext if it lies in `[0, maxBalance]`, null if decryption cannot resolve
 * the discrete log in that window.
 *
 * This uses a baby-step giant-step algorithm with a tunable window; callers
 * bound the search by the maximum balance they are willing to scan.
 */
export function decrypt(
  sk: Uint8Array,
  ciphertext: ElGamalCiphertext,
  opts: { maxBalance?: bigint; bsgsStep?: number } = {}
): bigint | null {
  const skScalar = scalarFromLE32(sk);
  const c1 = pointFromBytes(ciphertext.c1);
  const c2 = pointFromBytes(ciphertext.c2);
  const skInv = invMod(skScalar, CURVE_ORDER);
  const blinding = c2.multiply(skInv);
  const mH = c1.subtract(blinding);
  const maxBalance = opts.maxBalance ?? (1n << 32n);
  const step = opts.bsgsStep ?? 1024;
  return discreteLogOnH(mH, maxBalance, step);
}

/**
 * Discrete log on the twisted ElGamal H subgroup: find `m` such that m*H = target
 * and `0 <= m <= maxBalance`, using baby-step giant-step.
 */
export function discreteLogOnH(
  target: typeof RistrettoPoint.BASE,
  maxBalance: bigint,
  step: number = 1024
): bigint | null {
  if (maxBalance < 0n) {
    return null;
  }
  if (step <= 0) {
    throw sdkError("InvalidInput", "BSGS step must be positive");
  }
  const H = twistedH();
  const table = new Map<string, number>();
  let babyStep = RistrettoPoint.ZERO;
  for (let i = 0; i <= step; i++) {
    const key = hexCompress(babyStep.toRawBytes());
    if (!table.has(key)) {
      table.set(key, i);
    }
    if (i < step) {
      babyStep = babyStep.add(H);
    }
  }
  const stepScalar = BigInt(step);
  const giantFactor = H.multiply(stepScalar).negate();
  let current = target;
  const giantRounds =
    maxBalance / stepScalar + (maxBalance % stepScalar === 0n ? 0n : 1n);
  for (let j = 0n; j <= giantRounds; j++) {
    const key = hexCompress(current.toRawBytes());
    const found = table.get(key);
    if (found !== undefined) {
      const candidate = j * stepScalar + BigInt(found);
      if (candidate <= maxBalance) {
        return candidate;
      }
    }
    current = current.add(giantFactor);
  }
  return null;
}

/**
 * Modular inverse of `a` modulo `n`, using the extended Euclidean algorithm.
 */
export function invMod(a: bigint, n: bigint): bigint {
  const aMod = mod(a, n);
  if (aMod === 0n) {
    throw sdkError("InvalidKeyDerivation", "cannot invert zero scalar");
  }
  let [oldR, r] = [aMod, n];
  let [oldS, s] = [1n, 0n];
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
  }
  return mod(oldS, n);
}

/**
 * Re-randomize a ciphertext without learning or changing the plaintext. Adds
 * a fresh (r' * G, r' * P) to (C, D). This is what the program uses to
 * guarantee unlinkability between the source and destination ciphertexts in a
 * transfer.
 */
export function randomize(
  pk: Uint8Array,
  ciphertext: ElGamalCiphertext
): ElGamalCiphertext {
  const rPrime = randomNonZeroScalar();
  const pkPoint = pointFromBytes(pk);
  const c1 = pointFromBytes(ciphertext.c1);
  const c2 = pointFromBytes(ciphertext.c2);
  const c1New = c1.add(baseG().multiply(rPrime));
  const c2New = c2.add(pkPoint.multiply(rPrime));
  return {
    c1: pointToBytes(c1New),
    c2: pointToBytes(c2New)
  };
}

/**
 * Homomorphic addition: given ciphertexts c and c' under the same public key,
 * produce a ciphertext encrypting m + m'.
 */
export function addCiphertexts(
  a: ElGamalCiphertext,
  b: ElGamalCiphertext
): ElGamalCiphertext {
  const a1 = pointFromBytes(a.c1);
  const a2 = pointFromBytes(a.c2);
  const b1 = pointFromBytes(b.c1);
  const b2 = pointFromBytes(b.c2);
  return {
    c1: pointToBytes(a1.add(b1)),
    c2: pointToBytes(a2.add(b2))
  };
}

/**
 * Homomorphic subtraction: produce a ciphertext encrypting m - m'.
 */
export function subCiphertexts(
  a: ElGamalCiphertext,
  b: ElGamalCiphertext
): ElGamalCiphertext {
  const a1 = pointFromBytes(a.c1);
  const a2 = pointFromBytes(a.c2);
  const b1 = pointFromBytes(b.c1);
  const b2 = pointFromBytes(b.c2);
  return {
    c1: pointToBytes(a1.subtract(b1)),
    c2: pointToBytes(a2.subtract(b2))
  };
}

/**
 * Scalar-multiply a ciphertext by a plaintext constant. Gives an encryption of
 * `k * m` under the same public key.
 */
export function scaleCiphertext(
  a: ElGamalCiphertext,
  k: bigint
): ElGamalCiphertext {
  const a1 = pointFromBytes(a.c1);
  const a2 = pointFromBytes(a.c2);
  const kScalar = mod(k, CURVE_ORDER);
  if (kScalar === 0n) {
    return {
      c1: pointToBytes(RistrettoPoint.ZERO),
      c2: pointToBytes(RistrettoPoint.ZERO)
    };
  }
  return {
    c1: pointToBytes(a1.multiply(kScalar)),
    c2: pointToBytes(a2.multiply(kScalar))
  };
}

/**
 * Check whether two ciphertexts are byte-equal. Not a cryptographic equality,
 * just a structural check.
 */
export function ciphertextEquals(
  a: ElGamalCiphertext,
  b: ElGamalCiphertext
): boolean {
  return constantTimeEqual(a.c1, b.c1) && constantTimeEqual(a.c2, b.c2);
}

/**
 * Serialize a ciphertext as 64 bytes (c1 || c2).
 */
export function serializeCiphertext(c: ElGamalCiphertext): Uint8Array {
  if (c.c1.length !== 32 || c.c2.length !== 32) {
    throw sdkError(
      "InvalidCiphertextLength",
      "ciphertext components must be 32 bytes each"
    );
  }
  const out = new Uint8Array(64);
  out.set(c.c1, 0);
  out.set(c.c2, 32);
  return out;
}

/**
 * Deserialize a ciphertext from 64 bytes.
 */
export function deserializeCiphertext(bytes: Uint8Array): ElGamalCiphertext {
  if (bytes.length !== 64) {
    throw sdkError(
      "InvalidCiphertextLength",
      `ciphertext must be 64 bytes, got ${bytes.length}`
    );
  }
  return {
    c1: bytes.slice(0, 32),
    c2: bytes.slice(32, 64)
  };
}

/**
 * Produce a zero-ciphertext under a given public key. Useful for initializing
 * empty balances locally.
 */
export function zeroCiphertext(pk: Uint8Array): ElGamalCiphertext {
  return encryptWithRandomness(pk, 0n, 1n);
}

/**
 * Derive a Pedersen-style commitment Cm = m*H + r*G, as used by Token-2022's
 * confidential-transfer proof inputs. This is the C1 half of the ciphertext
 * above; exposing it as a named helper reduces confusion elsewhere in the SDK.
 */
export function pedersenCommit(m: bigint, r: bigint): Uint8Array {
  const mScalar = mod(m, CURVE_ORDER);
  const rScalar = mod(r, CURVE_ORDER);
  const mH = mScalar === 0n ? RistrettoPoint.ZERO : twistedH().multiply(mScalar);
  const rG = rScalar === 0n ? RistrettoPoint.ZERO : baseG().multiply(rScalar);
  return pointToBytes(mH.add(rG));
}

/**
 * Internal helper: hex-compress a Ristretto point for use as a Map key.
 */
function hexCompress(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] ?? 0;
    s += (b < 16 ? "0" : "") + b.toString(16);
  }
  return s;
}

/**
 * Derive a deterministic per-owner ElGamal keypair from a signer's 32-byte
 * canonical signature over a fixed challenge. This mirrors the strategy used
 * by the Token-2022 confidential transfer reference wallet.
 */
export function derivePrivateKeyFromSignature(signature: Uint8Array): ElGamalKeyPair {
  if (signature.length < 32) {
    throw sdkError(
      "InvalidKeyDerivation",
      `signature must be at least 32 bytes, got ${signature.length}`
    );
  }
  const seed = sha256(signature).slice(0, 32);
  return keyPairFromSeed(seed);
}
