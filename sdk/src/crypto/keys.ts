/**
 * Deterministic GhosKeypair derivation.
 *
 * The ghos protocol uses per-owner ElGamal keypairs derived from a signer's
 * signature over a fixed challenge message. This allows any wallet
 * (hardware, software, browser) to recover the same confidential-balance
 * secret without storing an additional credential.
 *
 * The derivation pipeline:
 *   1. sign(challenge) -> 64-byte ed25519 signature
 *   2. blake3 / sha512 over (domain || signature || mint) -> 32-byte seed
 *   3. keyPairFromSeed(seed) -> Ristretto255 ElGamal keypair
 *
 * The mint is optionally mixed in so a single signer can hold independent
 * keypairs per Token-2022 mint, matching the Token-2022 convention.
 */

import { PublicKey, Signer } from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import {
  ELGAMAL_DERIVATION_DOMAIN,
  OWNER_DERIVATION_CHALLENGE
} from "../constants";
import { sdkError } from "../errors";
import { concatBytes, hexEncode } from "../utils";
import { keyPairFromSeed } from "./elgamal";
import type { ElGamalKeyPair, ElGamalPublicKey } from "../types";

/**
 * Options for GhosKeypair derivation.
 */
export interface GhosKeypairDerivationOptions {
  /**
   * Optional mint mixed into the derivation so the same signer yields a
   * different keypair per mint.
   */
  mint?: PublicKey;
  /**
   * Optional domain separator. Defaults to `ELGAMAL_DERIVATION_DOMAIN`.
   */
  domain?: string;
  /**
   * Optional challenge message. Defaults to `OWNER_DERIVATION_CHALLENGE`.
   */
  challenge?: Uint8Array;
}

/**
 * Derive a deterministic ElGamal keypair from a Solana signer.
 *
 * The signer's secret key is used to sign the challenge message via nacl
 * ed25519 sign_detached. The resulting signature is hashed with the domain
 * separator (and optional mint) to produce a 32-byte seed.
 */
export function deriveGhosKeypair(
  signer: Signer,
  options: GhosKeypairDerivationOptions = {}
): ElGamalKeyPair {
  const challenge = options.challenge ?? OWNER_DERIVATION_CHALLENGE;
  const domain = new TextEncoder().encode(
    options.domain ?? ELGAMAL_DERIVATION_DOMAIN
  );
  const secretKey = (signer as { secretKey?: Uint8Array }).secretKey;
  if (!secretKey || (secretKey.length !== 64 && secretKey.length !== 32)) {
    throw sdkError(
      "InvalidSigner",
      "signer.secretKey must be a 32 or 64 byte ed25519 key"
    );
  }
  const seed = secretKey.length === 64 ? secretKey.slice(0, 32) : secretKey;
  const signed = ed25519.sign(new Uint8Array(challenge), seed);
  if (signed.length !== 64) {
    throw sdkError(
      "InvalidSigner",
      "signer.secretKey does not produce a 64-byte ed25519 signature"
    );
  }
  const mintBytes = options.mint
    ? options.mint.toBytes()
    : new Uint8Array(32);
  const seed = sha512(concatBytes(domain, signed, mintBytes)).slice(0, 32);
  return keyPairFromSeed(seed);
}

/**
 * Derive a GhosKeypair from a pre-computed signature. Useful when the SDK
 * is driven from a hardware wallet where the secret never leaves the device;
 * the UI instead asks the device to sign the challenge and hands the
 * resulting signature back in.
 */
export function deriveGhosKeypairFromSignature(
  signature: Uint8Array,
  options: Omit<GhosKeypairDerivationOptions, "challenge"> = {}
): ElGamalKeyPair {
  if (signature.length !== 64) {
    throw sdkError(
      "InvalidSigner",
      `signature must be 64 bytes, got ${signature.length}`
    );
  }
  const domain = new TextEncoder().encode(
    options.domain ?? ELGAMAL_DERIVATION_DOMAIN
  );
  const mintBytes = options.mint
    ? options.mint.toBytes()
    : new Uint8Array(32);
  const seed = sha512(concatBytes(domain, signature, mintBytes)).slice(0, 32);
  return keyPairFromSeed(seed);
}

/**
 * A typed wrapper around ElGamalKeyPair that adds labeled accessors and
 * safe serialization helpers. Instances are produced via the factory
 * functions in this module; never construct one directly.
 */
export class GhosKeypair {
  public readonly publicKey: ElGamalPublicKey;
  private readonly secretKey: Uint8Array;
  private readonly derivedFromMint: PublicKey | null;

  public constructor(keypair: ElGamalKeyPair, mint: PublicKey | null = null) {
    this.publicKey = keypair.publicKey;
    this.secretKey = keypair.secretKey;
    this.derivedFromMint = mint;
  }

  /**
   * Static factory that derives from a Solana Signer.
   */
  public static fromSigner(
    signer: Signer,
    options: GhosKeypairDerivationOptions = {}
  ): GhosKeypair {
    return new GhosKeypair(
      deriveGhosKeypair(signer, options),
      options.mint ?? null
    );
  }

  /**
   * Static factory that derives from an externally-provided signature.
   */
  public static fromSignature(
    signature: Uint8Array,
    options: Omit<GhosKeypairDerivationOptions, "challenge"> = {}
  ): GhosKeypair {
    return new GhosKeypair(
      deriveGhosKeypairFromSignature(signature, options),
      options.mint ?? null
    );
  }

  /**
   * Return the raw 32-byte scalar. Callers should treat this as secret and
   * zeroize it after use.
   */
  public exposeSecretKey(): Uint8Array {
    return new Uint8Array(this.secretKey);
  }

  /**
   * Public key as a lowercase hex string.
   */
  public publicKeyHex(): string {
    return hexEncode(this.publicKey);
  }

  /**
   * The mint this keypair was derived for, if any.
   */
  public boundMint(): PublicKey | null {
    return this.derivedFromMint;
  }

  /**
   * Produce a short human-readable fingerprint for display purposes.
   */
  public fingerprint(): string {
    const hex = this.publicKeyHex();
    return `${hex.slice(0, 6)}..${hex.slice(-6)}`;
  }
}

/**
 * Utility: given an ed25519 keypair's 32-byte seed (the private key half),
 * reconstruct a full 64-byte secret the way @solana/web3.js's Keypair does.
 * Useful when tests want to build a Signer manually.
 */
export function seedToEd25519Full(seed: Uint8Array): Uint8Array {
  if (seed.length !== 32) {
    throw sdkError(
      "InvalidKeyDerivation",
      `seed must be 32 bytes, got ${seed.length}`
    );
  }
  const pubkey = ed25519.getPublicKey(seed);
  const out = new Uint8Array(64);
  out.set(seed, 0);
  out.set(pubkey, 32);
  return out;
}

/**
 * Convenience: synchronously sign the ghos challenge with a Signer and return
 * the 64-byte signature. Splits out the low-level nacl call so callers that
 * already have a signature avoid re-signing.
 */
export function signGhosChallenge(signer: Signer): Uint8Array {
  const secret = (signer as { secretKey?: Uint8Array }).secretKey;
  if (!secret || (secret.length !== 64 && secret.length !== 32)) {
    throw sdkError(
      "InvalidSigner",
      "signer does not expose a 32 or 64 byte ed25519 secret key"
    );
  }
  const seed = secret.length === 64 ? secret.slice(0, 32) : secret;
  return ed25519.sign(new Uint8Array(OWNER_DERIVATION_CHALLENGE), seed);
}
