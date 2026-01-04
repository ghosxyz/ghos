/**
 * Public API surface of @ghos/sdk.
 *
 * Everything re-exported here is considered stable within the 0.4.x release
 * line. Internal helpers live in the submodules and may change without
 * notice.
 */

import {
  Connection,
  Keypair,
  Signer
} from "@solana/web3.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export { GhosClient } from "./client";
export * from "./types";
export * from "./constants";
export * from "./errors";
export * from "./pdas";
export * from "./utils";

export {
  buildInitializeInstruction,
  discriminatorFor
} from "./instructions/initialize";
export { buildShieldInstruction } from "./instructions/shield";
export { buildConfidentialTransferInstruction } from "./instructions/transfer";
export { buildApplyPendingInstruction } from "./instructions/apply";
export { buildWithdrawInstruction } from "./instructions/withdraw";
export {
  buildCreateBurnerInstruction,
  buildDestroyBurnerInstruction
} from "./instructions/burner";
export {
  buildMixCommitInstruction,
  buildMixInitInstruction,
  buildMixRevealInstruction,
  buildMixSettleInstruction
} from "./instructions/mix";
export {
  buildAuditorRegisterInstruction,
  buildAuditorRotateInstruction
} from "./instructions/auditor";
export {
  CONFIG_FIELD_CODES,
  buildConfigUpdateInstruction
} from "./instructions/config";

export {
  CURVE_ORDER,
  addCiphertexts,
  baseG,
  ciphertextEquals,
  decrypt,
  derivePrivateKeyFromSignature,
  deserializeCiphertext,
  discreteLogOnH,
  encrypt,
  encryptWithRandomness,
  invMod,
  keyGen,
  keyPairFromSeed,
  multBaseG,
  multH,
  pedersenCommit,
  pointFromBytes,
  pointToBytes,
  randomize,
  randomScalar,
  randomNonZeroScalar,
  scaleCiphertext,
  scalarFromLE32,
  scalarFromUniform64,
  scalarToLE32,
  serializeCiphertext,
  subCiphertexts,
  twistedH,
  zeroCiphertext
} from "./crypto/elgamal";

export {
  RANGE_BIT_LENGTH,
  Transcript,
  aggregate as aggregateRangeProofs,
  prove as proveRange,
  proveBoundToKey as proveRangeBoundToKey,
  proofSize as rangeProofSize,
  verify as verifyRangeProof
} from "./crypto/bulletproof";

export {
  proveEquality,
  provePubkeyValidity,
  proveZeroBalance,
  verifyEquality,
  verifyPubkeyValidity,
  verifyZeroBalance
} from "./crypto/sigma";

export {
  GhosKeypair,
  deriveGhosKeypair,
  deriveGhosKeypairFromSignature,
  seedToEd25519Full,
  signGhosChallenge
} from "./crypto/keys";

export {
  commitmentShortForm,
  commitmentToBase64,
  computeMixCommitment,
  computeNoteCommitment,
  domainHashSha256,
  domainHashSha512,
  generateMixNote,
  randomRevealSignal,
  verifyMixCommitment
} from "./crypto/hash";

export {
  decodeEvent,
  extractProgramData,
  matchEventDiscriminator,
  subscribe as subscribeToEvent,
  subscribeAll as subscribeToAllEvents
} from "./watcher";

export { default as ghosIdl } from "./idl/ghos.json";

/**
 * Load a local Solana keypair JSON file (the default format produced by
 * `solana-keygen new`). Accepts a tilde-expanded path. Returns a `Keypair`
 * usable as a `Signer`.
 *
 * This is a convenience import, not a security recommendation. Production
 * deployments should pull keys from a hardware wallet or HSM.
 */
export function loadKeypair(pathExpr: string): Keypair {
  const expanded = pathExpr.startsWith("~")
    ? path.join(os.homedir(), pathExpr.slice(1))
    : pathExpr;
  const raw = fs.readFileSync(expanded, "utf8");
  const parsed = JSON.parse(raw) as number[];
  if (!Array.isArray(parsed) || parsed.length !== 64) {
    throw new Error(`expected 64-byte keypair file, got ${typeof parsed}`);
  }
  return Keypair.fromSecretKey(Uint8Array.from(parsed));
}

/**
 * Create a local `Connection` against the canonical devnet endpoint with a
 * sensible commitment level. Handy for example scripts.
 */
export function defaultDevnetConnection(): Connection {
  return new Connection("https://api.devnet.solana.com", "confirmed");
}

/**
 * A minimal helper that turns a `Keypair` into a `Signer` without requiring
 * consumers to import from `@solana/web3.js` directly.
 */
export function toSigner(keypair: Keypair): Signer {
  return keypair;
}

/**
 * Semver triple for the SDK, matching `package.json`.
 */
export const SDK_VERSION = "0.4.1" as const;

/**
 * Human-readable banner used by CLI wrappers when they want to greet the user.
 */
export const SDK_BANNER = "ghos SDK v0.4.1 (Solana privacy OS)";
