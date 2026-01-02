/**
 * Strict TypeScript types mirroring the on-chain account layouts defined in
 * `programs/ghos/src/state.rs`. These types are what the SDK hands to consumers
 * after decoding; the wire-format decoding happens in `client.ts`.
 *
 * Nothing here uses `any`. Byte arrays are `Uint8Array`. Large numbers are
 * `bigint` when they represent token amounts or timestamps.
 */

import type { Connection, PublicKey, Signer, TransactionSignature } from "@solana/web3.js";
import type BN from "bn.js";

/**
 * On-chain singleton configuration. A decoded, friendly representation of
 * `GhosConfig` from state.rs.
 */
export interface GhosConfigAccount {
  admin: PublicKey;
  version: number;
  paused: boolean;
  dustFreeUnit: bigint;
  burnerTtlMax: bigint;
  burnerTtlMin: bigint;
  burnerRegistryCap: number;
  mixMinParticipants: number;
  mixMaxParticipants: number;
  mixRevealWindow: bigint;
  auditorCosignLamports: bigint;
  lastUpdated: bigint;
  bump: number;
  reserved: Uint8Array;
}

/**
 * On-chain per-mint auditor entry.
 */
export interface AuditorEntryAccount {
  mint: PublicKey;
  auditorPubkey: Uint8Array;
  registeredAt: bigint;
  lastRotatedAt: bigint;
  rotationCooldown: bigint;
  admin: PublicKey;
  bump: number;
  reserved: Uint8Array;
}

/**
 * On-chain per-owner burner entry.
 */
export interface BurnerAccount {
  owner: PublicKey;
  burnerPubkey: PublicKey;
  createdAt: bigint;
  expiresAt: bigint;
  nonce: bigint;
  revoked: boolean;
  usageCount: number;
  bump: number;
  reserved: Uint8Array;
}

/**
 * Enum mirror of `MixPhase`.
 */
export enum MixPhase {
  Open = 0,
  Commit = 1,
  Reveal = 2,
  Settling = 3,
  Settled = 4,
  Aborted = 5
}

/**
 * On-chain mix round account.
 */
export interface MixRoundAccount {
  mint: PublicKey;
  denomination: bigint;
  host: PublicKey;
  capacity: number;
  committed: number;
  revealed: number;
  phase: MixPhase;
  openedAt: bigint;
  commitCloseAt: bigint;
  revealCloseAt: bigint;
  settledAt: bigint;
  bump: number;
  reserved: Uint8Array;
}

/**
 * On-chain mix commitment entry.
 */
export interface MixCommitmentAccount {
  round: PublicKey;
  participant: PublicKey;
  commitment: Uint8Array;
  revealed: boolean;
  revealSignal: Uint8Array;
  index: number;
  committedAt: bigint;
  revealedAt: bigint;
  bump: number;
  reserved: Uint8Array;
}

/**
 * Represents a twisted ElGamal ciphertext pair (C1, C2), each a Ristretto255
 * compressed point.
 */
export interface ElGamalCiphertext {
  c1: Uint8Array;
  c2: Uint8Array;
}

/**
 * A twisted ElGamal public key, a 32-byte Ristretto255 compressed point.
 */
export type ElGamalPublicKey = Uint8Array;

/**
 * A twisted ElGamal secret key, a 32-byte Ristretto255 scalar.
 */
export type ElGamalSecretKey = Uint8Array;

/**
 * A derived keypair for a single owner. Keys are never serialized or sent over
 * the wire; only the public key is revealed.
 */
export interface ElGamalKeyPair {
  publicKey: ElGamalPublicKey;
  secretKey: ElGamalSecretKey;
}

/**
 * A client-generated range proof with its public inputs, ready for submission
 * to the zk-token-proof program.
 */
export interface RangeProof {
  proofBytes: Uint8Array;
  commitment: Uint8Array;
  bitLength: number;
}

/**
 * Equality proof object.
 */
export interface EqualityProof {
  proofBytes: Uint8Array;
  sourceCommitment: Uint8Array;
  destCommitment: Uint8Array;
}

/**
 * Pubkey validity proof, attesting that a Ristretto255 point is in the
 * prime-order subgroup.
 */
export interface PubkeyValidityProof {
  proofBytes: Uint8Array;
  pubkey: ElGamalPublicKey;
}

/**
 * Zero-balance proof, attesting that a given ciphertext encrypts zero.
 */
export interface ZeroBalanceProof {
  proofBytes: Uint8Array;
  ciphertext: ElGamalCiphertext;
}

/**
 * Union of every sigma proof type the SDK generates.
 */
export type SigmaProof = EqualityProof | PubkeyValidityProof | ZeroBalanceProof;

/**
 * Client-side model of the decrypted confidential balance. Both `pending` and
 * `available` are bigints because token amounts can exceed 2^53.
 */
export interface DecryptedBalance {
  available: bigint;
  pending: bigint;
}

/**
 * A fully formed "shield" instruction call.
 */
export interface ShieldParams {
  mint: PublicKey;
  amount: bigint;
  owner?: Signer;
  sourceAta?: PublicKey;
  computeUnits?: number;
  priorityFeeMicroLamports?: number;
}

export interface ShieldResult {
  signature: TransactionSignature;
  commitment: "confidential";
  pending: string;
}

export interface ConfidentialTransferParams {
  mint: PublicKey;
  toOwner: PublicKey;
  amount: bigint;
  owner?: Signer;
  auditor?: ElGamalPublicKey;
  computeUnits?: number;
  priorityFeeMicroLamports?: number;
}

export interface ConfidentialTransferResult {
  signature: TransactionSignature;
  verdict: "SUBMITTED";
  proof: "range+equality";
  proofContext: PublicKey;
}

export interface ApplyPendingParams {
  mint: PublicKey;
  owner?: Signer;
}

export interface ApplyPendingResult {
  signature: TransactionSignature;
  applied: bigint;
}

export interface WithdrawParams {
  mint: PublicKey;
  amount: bigint;
  destinationAta?: PublicKey;
  owner?: Signer;
  requireAuditor?: boolean;
}

export interface WithdrawResult {
  signature: TransactionSignature;
  withdrawn: bigint;
  auditorCosigned: boolean;
}

export interface CreateBurnerParams {
  ttlSeconds: number;
  owner?: Signer;
  nonce?: bigint;
}

export interface CreateBurnerResult {
  signature: TransactionSignature;
  burner: PublicKey;
  expiresAt: bigint;
}

export interface DestroyBurnerParams {
  burner: PublicKey;
  owner?: Signer;
}

export interface DestroyBurnerResult {
  signature: TransactionSignature;
  revokedAt: bigint;
}

export interface MixInitParams {
  mint: PublicKey;
  denomination: bigint;
  capacity: number;
  host?: Signer;
  commitWindowSeconds?: number;
}

export interface MixInitResult {
  signature: TransactionSignature;
  round: PublicKey;
  capacity: number;
  opensAt: bigint;
}

export interface MixCommitParams {
  round: PublicKey;
  participant?: Signer;
  commitment: Uint8Array;
  index: number;
}

export interface MixCommitResult {
  signature: TransactionSignature;
  commitment: PublicKey;
  index: number;
}

export interface MixRevealParams {
  round: PublicKey;
  participant?: Signer;
  revealSignal: Uint8Array;
  salt: Uint8Array;
}

export interface MixRevealResult {
  signature: TransactionSignature;
  revealedAt: bigint;
}

export interface MixSettleParams {
  round: PublicKey;
  host?: Signer;
  participantIndices: number[];
}

export interface MixSettleResult {
  signature: TransactionSignature;
  participants: number;
}

export interface AuditorRegisterParams {
  mint: PublicKey;
  auditorPubkey: ElGamalPublicKey;
  rotationCooldown?: number;
  admin?: Signer;
}

export interface AuditorRegisterResult {
  signature: TransactionSignature;
  auditor: PublicKey;
}

export interface AuditorRotateParams {
  mint: PublicKey;
  newAuditorPubkey: ElGamalPublicKey;
  admin?: Signer;
}

export interface AuditorRotateResult {
  signature: TransactionSignature;
  oldPubkey: ElGamalPublicKey;
  newPubkey: ElGamalPublicKey;
}

export interface InitializeParams {
  admin?: Signer;
  dustFreeUnit?: bigint;
  burnerTtlMax?: number;
  burnerTtlMin?: number;
  burnerRegistryCap?: number;
  mixMinParticipants?: number;
  mixMaxParticipants?: number;
  mixRevealWindow?: number;
  auditorCosignLamports?: bigint;
}

export interface InitializeResult {
  signature: TransactionSignature;
  config: PublicKey;
  admin: PublicKey;
  version: number;
}

export interface ConfigUpdateParams {
  admin?: Signer;
  paused?: boolean;
  dustFreeUnit?: bigint;
  burnerTtlMax?: number;
  burnerTtlMin?: number;
  burnerRegistryCap?: number;
  mixMinParticipants?: number;
  mixMaxParticipants?: number;
  mixRevealWindow?: number;
  auditorCosignLamports?: bigint;
}

export interface ConfigUpdateResult {
  signature: TransactionSignature;
  updatedField: string;
}

/**
 * Options accepted by the GhosClient constructor.
 */
export interface GhosClientOptions {
  connection: Connection;
  payer: Signer;
  programId?: PublicKey;
  auditorOverride?: PublicKey;
  commitment?: "processed" | "confirmed" | "finalized";
  skipPreflight?: boolean;
  maxRetries?: number;
  baseRetryDelayMs?: number;
  priorityFeeMicroLamports?: number;
}

/**
 * Descriptor used by the event watcher module.
 */
export interface WatcherSubscription {
  id: number;
  name: string;
  unsubscribe: () => Promise<void>;
}

/**
 * Handler invoked per emitted event.
 */
export type EventHandler<T> = (event: T, slot: number, signature: string) => void | Promise<void>;

/**
 * A convenient alias for BN instances used when calling into Anchor.
 */
export type AnchorBn = BN;

/**
 * The shape returned by `GhosClient.fetchBurners` when paginating through a
 * single owner's burner registry entries.
 */
export interface BurnerQueryResult {
  owner: PublicKey;
  entries: Array<{ pda: PublicKey; account: BurnerAccount }>;
  total: number;
  active: number;
}

/**
 * Parameters used when decrypting balances locally. Exposed so the SDK can be
 * driven in offline mode (compose a proof, hand it to a hardware wallet, sign,
 * then submit).
 */
export interface DecryptBalanceParams {
  mint: PublicKey;
  owner: PublicKey;
  secret?: ElGamalSecretKey;
  maxBalance?: bigint;
}

/**
 * Simulation-only output produced before a transfer hits the RPC.
 */
export interface TransferSimulation {
  sourceCommitmentAfter: ElGamalCiphertext;
  destinationCommitmentAfter: ElGamalCiphertext;
  rangeProof: RangeProof;
  equalityProof: EqualityProof;
  auditorCiphertext?: ElGamalCiphertext;
}

/**
 * Metadata for a CoinJoin participant generated locally before commit.
 */
export interface MixNote {
  salt: Uint8Array;
  pubkey: ElGamalPublicKey;
  denomination: bigint;
  commitment: Uint8Array;
}

/**
 * A convenient type alias for the `Signer` concept, so user code can import it
 * directly from `@ghos/sdk`.
 */
export type GhosSigner = Signer;
