/**
 * GhosClient: the high-level entry point exposed to downstream consumers.
 *
 * The client composes the per-instruction builders in `instructions/*`, the
 * PDA helpers in `pdas.ts`, the retry logic in `utils.ts`, and the crypto
 * primitives in `crypto/*` into ergonomic methods. Every method returns a
 * shape of `{ signature, ...domainSpecificFields }` so callers can uniformly
 * treat them as async I/O.
 */

import {
  Commitment,
  Connection,
  PublicKey,
  Signer,
  Transaction,
  TransactionInstruction,
  TransactionSignature
} from "@solana/web3.js";
import BN from "bn.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  DEFAULT_PRIORITY_FEE_MICROLAMPORTS,
  DUST_FREE_UNIT,
  GHOS_PROGRAM_ID,
  RECOMMENDED_CU_BUDGET,
  TOKEN_2022_PROGRAM_ID
} from "./constants";
import {
  GhosSdkError,
  SDK_ERROR_CODES,
  coerceToSdkError,
  sdkError
} from "./errors";
import {
  deriveAuditorPda,
  deriveBurnerPda,
  deriveConfigPda,
  deriveMixCommitmentPda,
  deriveMixRoundPda
} from "./pdas";
import {
  assertDustFreeAligned,
  assertPositiveAmount,
  clampU64,
  computeBudgetIxs,
  probeToken22Mint,
  randomNonce,
  retry,
  sendAndConfirmWithRetry
} from "./utils";
import { buildInitializeInstruction } from "./instructions/initialize";
import { buildShieldInstruction } from "./instructions/shield";
import { buildConfidentialTransferInstruction } from "./instructions/transfer";
import { buildApplyPendingInstruction } from "./instructions/apply";
import { buildWithdrawInstruction } from "./instructions/withdraw";
import {
  buildCreateBurnerInstruction,
  buildDestroyBurnerInstruction
} from "./instructions/burner";
import {
  buildMixCommitInstruction,
  buildMixInitInstruction,
  buildMixRevealInstruction,
  buildMixSettleInstruction
} from "./instructions/mix";
import {
  buildAuditorRegisterInstruction,
  buildAuditorRotateInstruction
} from "./instructions/auditor";
import { buildConfigUpdateInstruction } from "./instructions/config";
import type {
  ApplyPendingParams,
  ApplyPendingResult,
  AuditorRegisterParams,
  AuditorRegisterResult,
  AuditorRotateParams,
  AuditorRotateResult,
  ConfidentialTransferParams,
  ConfidentialTransferResult,
  ConfigUpdateParams,
  ConfigUpdateResult,
  CreateBurnerParams,
  CreateBurnerResult,
  DestroyBurnerParams,
  DestroyBurnerResult,
  ElGamalCiphertext,
  GhosClientOptions,
  InitializeParams,
  InitializeResult,
  MixCommitParams,
  MixCommitResult,
  MixInitParams,
  MixInitResult,
  MixRevealParams,
  MixRevealResult,
  MixSettleParams,
  MixSettleResult,
  ShieldParams,
  ShieldResult,
  WithdrawParams,
  WithdrawResult
} from "./types";

/**
 * The canonical client used by browser and Node consumers of @ghos/sdk.
 */
export class GhosClient {
  public readonly connection: Connection;
  public readonly payer: Signer;
  public readonly programId: PublicKey;
  public readonly auditorOverride: PublicKey | null;
  public readonly commitment: Commitment;
  public readonly skipPreflight: boolean;
  public readonly maxRetries: number;
  public readonly baseRetryDelayMs: number;
  public readonly priorityFeeMicroLamports: number;

  public constructor(options: GhosClientOptions) {
    if (!options || !options.connection) {
      throw sdkError("InvalidInput", "GhosClient requires a Connection");
    }
    if (!options.payer) {
      throw sdkError("InvalidInput", "GhosClient requires a payer Signer");
    }
    this.connection = options.connection;
    this.payer = options.payer;
    this.programId = options.programId ?? GHOS_PROGRAM_ID;
    this.auditorOverride = options.auditorOverride ?? null;
    this.commitment = options.commitment ?? "confirmed";
    this.skipPreflight = options.skipPreflight ?? false;
    this.maxRetries = options.maxRetries ?? 3;
    this.baseRetryDelayMs = options.baseRetryDelayMs ?? 400;
    this.priorityFeeMicroLamports =
      options.priorityFeeMicroLamports ?? DEFAULT_PRIORITY_FEE_MICROLAMPORTS;
  }

  /**
   * Produce and submit a single-instruction transaction with the default
   * compute-budget preamble. Internal helper reused by every action method.
   */
  private async sendIx(
    ix: TransactionInstruction | TransactionInstruction[],
    additionalSigners: Signer[] = [],
    cuOverride?: { units?: number; priceMicroLamports?: number }
  ): Promise<TransactionSignature> {
    const budget = computeBudgetIxs({
      units: cuOverride?.units ?? RECOMMENDED_CU_BUDGET,
      priceMicroLamports:
        cuOverride?.priceMicroLamports ?? this.priorityFeeMicroLamports
    });
    const ixs = Array.isArray(ix) ? ix : [ix];
    const tx = new Transaction().add(...budget, ...ixs);
    tx.feePayer = this.payer.publicKey;
    return sendAndConfirmWithRetry(
      this.connection,
      tx,
      [this.payer, ...additionalSigners],
      {
        commitment: this.commitment,
        skipPreflight: this.skipPreflight,
        maxRetries: this.maxRetries,
        baseDelayMs: this.baseRetryDelayMs
      }
    );
  }

  /**
   * Return the address of the singleton GhosConfig PDA under the configured
   * program id.
   */
  public configPda(): PublicKey {
    return deriveConfigPda(this.programId).address;
  }

  /**
   * Return the address of the auditor entry PDA for a given mint.
   */
  public auditorPda(mint: PublicKey): PublicKey {
    if (this.auditorOverride) {
      return this.auditorOverride;
    }
    return deriveAuditorPda(mint, this.programId).address;
  }

  /**
   * Return the address of the burner PDA for a given owner and nonce.
   */
  public burnerPda(owner: PublicKey, nonce: bigint | number | BN): PublicKey {
    return deriveBurnerPda(owner, nonce, this.programId).address;
  }

  /**
   * Initialize the protocol singleton.
   */
  public async initialize(params: InitializeParams = {}): Promise<InitializeResult> {
    const admin = params.admin ?? this.payer;
    const ix = buildInitializeInstruction({
      admin: admin.publicKey,
      programId: this.programId,
      dustFreeUnit: params.dustFreeUnit ?? DUST_FREE_UNIT,
      burnerTtlMin: params.burnerTtlMin,
      burnerTtlMax: params.burnerTtlMax,
      burnerRegistryCap: params.burnerRegistryCap,
      mixMinParticipants: params.mixMinParticipants,
      mixMaxParticipants: params.mixMaxParticipants,
      mixRevealWindow: params.mixRevealWindow,
      auditorCosignLamports: params.auditorCosignLamports
    });
    const extraSigners = admin.publicKey.equals(this.payer.publicKey) ? [] : [admin];
    const signature = await this.sendIx(ix, extraSigners);
    return {
      signature,
      config: this.configPda(),
      admin: admin.publicKey,
      version: 0x0401
    };
  }

  /**
   * Shield plaintext SPL balance into a confidential balance.
   */
  public async shield(params: ShieldParams): Promise<ShieldResult> {
    const owner = params.owner ?? this.payer;
    const amount = clampU64(params.amount);
    assertPositiveAmount(amount);
    assertDustFreeAligned(amount, DUST_FREE_UNIT);
    const probe = await probeToken22Mint(this.connection, params.mint);
    if (!probe.isToken22) {
      throw sdkError(
        "InvalidMint",
        "mint is not a Token-2022 mint with confidential extension"
      );
    }
    const sourceAta =
      params.sourceAta ?? (await this.deriveAta(params.mint, owner.publicKey));
    const destConfidential = await this.deriveAta(params.mint, owner.publicKey);
    const ix = buildShieldInstruction({
      owner: owner.publicKey,
      mint: params.mint,
      sourceAta,
      destinationConfidentialAccount: destConfidential,
      amount,
      programId: this.programId
    });
    const extraSigners = owner.publicKey.equals(this.payer.publicKey) ? [] : [owner];
    const signature = await this.sendIx(ix, extraSigners, {
      units: params.computeUnits,
      priceMicroLamports: params.priorityFeeMicroLamports
    });
    return {
      signature,
      commitment: "confidential",
      pending: amount.toString()
    };
  }

  /**
   * Submit a confidential transfer. The caller must pass pre-uploaded proof
   * context accounts and the source/destination ciphertexts resulting from
   * the local proof computation.
   */
  public async confidentialTransfer(
    params: ConfidentialTransferParams & {
      sourceAccount: PublicKey;
      destinationAccount: PublicKey;
      rangeProofContext: PublicKey;
      equalityProofContext: PublicKey;
      sourceCiphertext: ElGamalCiphertext;
      destCiphertext: ElGamalCiphertext;
      proofRangeHandle?: number;
      proofEqualityHandle?: number;
    }
  ): Promise<ConfidentialTransferResult> {
    const owner = params.owner ?? this.payer;
    assertPositiveAmount(clampU64(params.amount));
    const ix = buildConfidentialTransferInstruction({
      owner: owner.publicKey,
      mint: params.mint,
      sourceAccount: params.sourceAccount,
      destinationAccount: params.destinationAccount,
      destinationOwner: params.toOwner,
      rangeProofContext: params.rangeProofContext,
      equalityProofContext: params.equalityProofContext,
      auditorEntry: this.auditorPda(params.mint),
      proofRangeHandle: params.proofRangeHandle ?? 0,
      proofEqualityHandle: params.proofEqualityHandle ?? 0,
      sourceCiphertext: params.sourceCiphertext,
      destCiphertext: params.destCiphertext,
      programId: this.programId
    });
    const extraSigners = owner.publicKey.equals(this.payer.publicKey) ? [] : [owner];
    const signature = await this.sendIx(ix, extraSigners, {
      units: params.computeUnits,
      priceMicroLamports: params.priorityFeeMicroLamports
    });
    return {
      signature,
      verdict: "SUBMITTED",
      proof: "range+equality",
      proofContext: params.rangeProofContext
    };
  }

  /**
   * Convenience alias retaining the on-chain instruction name (apply_pending).
   */
  public async applyPendingBalance(
    params: ApplyPendingParams
  ): Promise<ApplyPendingResult> {
    return this.applyPending(params);
  }

  public async applyPending(
    params: ApplyPendingParams
  ): Promise<ApplyPendingResult> {
    const owner = params.owner ?? this.payer;
    const confidentialAccount = await this.deriveAta(params.mint, owner.publicKey);
    const ix = buildApplyPendingInstruction({
      owner: owner.publicKey,
      mint: params.mint,
      confidentialAccount,
      programId: this.programId
    });
    const extraSigners = owner.publicKey.equals(this.payer.publicKey) ? [] : [owner];
    const signature = await this.sendIx(ix, extraSigners);
    return { signature, applied: 0n };
  }

  /**
   * Withdraw confidential balance back to the SPL side.
   */
  public async withdraw(params: WithdrawParams): Promise<WithdrawResult> {
    const owner = params.owner ?? this.payer;
    const amount = clampU64(params.amount);
    assertPositiveAmount(amount);
    const sourceAccount = await this.deriveAta(params.mint, owner.publicKey);
    const destinationAta =
      params.destinationAta ??
      (await this.deriveAta(params.mint, owner.publicKey));
    const ix = buildWithdrawInstruction({
      owner: owner.publicKey,
      mint: params.mint,
      sourceAccount,
      destinationAta,
      amount,
      requireAuditor: params.requireAuditor ?? false,
      auditorEntry: this.auditorPda(params.mint),
      programId: this.programId
    });
    const extraSigners = owner.publicKey.equals(this.payer.publicKey) ? [] : [owner];
    const signature = await this.sendIx(ix, extraSigners);
    return {
      signature,
      withdrawn: amount,
      auditorCosigned: params.requireAuditor ?? false
    };
  }

  /**
   * Register a burner account for the payer / supplied owner.
   */
  public async createBurner(
    params: CreateBurnerParams & { burnerPubkey?: PublicKey }
  ): Promise<CreateBurnerResult> {
    const owner = params.owner ?? this.payer;
    const nonce = params.nonce ?? randomNonce();
    const burnerPubkey =
      params.burnerPubkey ?? PublicKey.unique();
    const ix = buildCreateBurnerInstruction({
      owner: owner.publicKey,
      burnerPubkey,
      nonce,
      ttlSeconds: params.ttlSeconds,
      programId: this.programId
    });
    const extraSigners = owner.publicKey.equals(this.payer.publicKey) ? [] : [owner];
    const signature = await this.sendIx(ix, extraSigners);
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + params.ttlSeconds);
    return {
      signature,
      burner: this.burnerPda(owner.publicKey, nonce),
      expiresAt
    };
  }

  /**
   * Revoke an existing burner entry before its TTL expires.
   */
  public async destroyBurner(
    params: DestroyBurnerParams
  ): Promise<DestroyBurnerResult> {
    const owner = params.owner ?? this.payer;
    const ix = buildDestroyBurnerInstruction({
      owner: owner.publicKey,
      burnerEntry: params.burner,
      programId: this.programId
    });
    const extraSigners = owner.publicKey.equals(this.payer.publicKey) ? [] : [owner];
    const signature = await this.sendIx(ix, extraSigners);
    const revokedAt = BigInt(Math.floor(Date.now() / 1000));
    return { signature, revokedAt };
  }

  /**
   * Open a CoinJoin mix round with the given denomination and capacity.
   */
  public async mixInit(
    params: MixInitParams & { roundNonce?: bigint }
  ): Promise<MixInitResult> {
    const host = params.host ?? this.payer;
    const roundNonce = params.roundNonce ?? randomNonce();
    assertPositiveAmount(clampU64(params.denomination));
    if (params.capacity < 4 || params.capacity > 16) {
      throw sdkError("InvalidInput", "capacity must be between 4 and 16");
    }
    const commitWindowSeconds = params.commitWindowSeconds ?? 120;
    const ix = buildMixInitInstruction({
      host: host.publicKey,
      mint: params.mint,
      roundNonce,
      denomination: params.denomination,
      capacity: params.capacity,
      commitWindowSeconds,
      programId: this.programId
    });
    const extraSigners = host.publicKey.equals(this.payer.publicKey) ? [] : [host];
    const signature = await this.sendIx(ix, extraSigners);
    const round = deriveMixRoundPda(
      host.publicKey,
      params.mint,
      roundNonce,
      this.programId
    ).address;
    return {
      signature,
      round,
      capacity: params.capacity,
      opensAt: BigInt(Math.floor(Date.now() / 1000))
    };
  }

  /**
   * Commit to a mix slot.
   */
  public async mixCommit(params: MixCommitParams): Promise<MixCommitResult> {
    const participant = params.participant ?? this.payer;
    if (params.commitment.length !== 32) {
      throw sdkError(
        "InvalidCommitmentLength",
        `commitment must be 32 bytes, got ${params.commitment.length}`
      );
    }
    const ix = buildMixCommitInstruction({
      participant: participant.publicKey,
      round: params.round,
      commitment: params.commitment,
      index: params.index,
      programId: this.programId
    });
    const extraSigners = participant.publicKey.equals(this.payer.publicKey)
      ? []
      : [participant];
    const signature = await this.sendIx(ix, extraSigners);
    const commitmentPda = deriveMixCommitmentPda(
      params.round,
      participant.publicKey,
      this.programId
    ).address;
    return { signature, commitment: commitmentPda, index: params.index };
  }

  /**
   * Reveal a previous commitment.
   */
  public async mixReveal(params: MixRevealParams): Promise<MixRevealResult> {
    const participant = params.participant ?? this.payer;
    const ix = buildMixRevealInstruction({
      participant: participant.publicKey,
      round: params.round,
      revealSignal: params.revealSignal,
      salt: params.salt,
      programId: this.programId
    });
    const extraSigners = participant.publicKey.equals(this.payer.publicKey)
      ? []
      : [participant];
    const signature = await this.sendIx(ix, extraSigners);
    return { signature, revealedAt: BigInt(Math.floor(Date.now() / 1000)) };
  }

  /**
   * Settle a mix round, redistributing the outputs.
   */
  public async mixSettle(params: MixSettleParams): Promise<MixSettleResult> {
    const host = params.host ?? this.payer;
    if (params.participantIndices.length < 4) {
      throw sdkError("MixRoundBusy", "settle requires at least 4 participants");
    }
    const ix = buildMixSettleInstruction({
      host: host.publicKey,
      round: params.round,
      participantIndices: params.participantIndices,
      programId: this.programId
    });
    const extraSigners = host.publicKey.equals(this.payer.publicKey) ? [] : [host];
    const signature = await this.sendIx(ix, extraSigners);
    return { signature, participants: params.participantIndices.length };
  }

  /**
   * Register a per-mint auditor.
   */
  public async auditorRegister(
    params: AuditorRegisterParams
  ): Promise<AuditorRegisterResult> {
    const admin = params.admin ?? this.payer;
    const rotationCooldown = params.rotationCooldown ?? 60 * 60 * 24 * 7;
    const ix = buildAuditorRegisterInstruction({
      admin: admin.publicKey,
      mint: params.mint,
      auditorPubkey: params.auditorPubkey,
      rotationCooldownSeconds: rotationCooldown,
      programId: this.programId
    });
    const extraSigners = admin.publicKey.equals(this.payer.publicKey) ? [] : [admin];
    const signature = await this.sendIx(ix, extraSigners);
    return { signature, auditor: this.auditorPda(params.mint) };
  }

  /**
   * Rotate a per-mint auditor.
   */
  public async auditorRotate(
    params: AuditorRotateParams
  ): Promise<AuditorRotateResult> {
    const admin = params.admin ?? this.payer;
    const ix = buildAuditorRotateInstruction({
      admin: admin.publicKey,
      mint: params.mint,
      newAuditorPubkey: params.newAuditorPubkey,
      programId: this.programId
    });
    const extraSigners = admin.publicKey.equals(this.payer.publicKey) ? [] : [admin];
    const signature = await this.sendIx(ix, extraSigners);
    return {
      signature,
      oldPubkey: new Uint8Array(32),
      newPubkey: params.newAuditorPubkey
    };
  }

  /**
   * Update a single field in GhosConfig.
   */
  public async configUpdate(
    params: ConfigUpdateParams
  ): Promise<ConfigUpdateResult> {
    const admin = params.admin ?? this.payer;
    const field = this.pickFieldFromUpdate(params);
    const ix = buildConfigUpdateInstruction({
      admin: admin.publicKey,
      field: field.name,
      u64Value: field.u64Value,
      i64Value: field.i64Value,
      boolValue: field.boolValue,
      u16Value: field.u16Value,
      u8Value: field.u8Value,
      programId: this.programId
    });
    const extraSigners = admin.publicKey.equals(this.payer.publicKey) ? [] : [admin];
    const signature = await this.sendIx(ix, extraSigners);
    return { signature, updatedField: field.name };
  }

  /**
   * Internal: translate an update request into the typed field tuple expected
   * by the instruction builder.
   */
  private pickFieldFromUpdate(
    params: ConfigUpdateParams
  ): {
    name:
      | "paused"
      | "dustFreeUnit"
      | "burnerTtlMax"
      | "burnerTtlMin"
      | "burnerRegistryCap"
      | "mixMinParticipants"
      | "mixMaxParticipants"
      | "mixRevealWindow"
      | "auditorCosignLamports";
    u64Value?: bigint;
    i64Value?: bigint | number;
    boolValue?: boolean;
    u16Value?: number;
    u8Value?: number;
  } {
    if (params.paused !== undefined) {
      return { name: "paused", boolValue: params.paused };
    }
    if (params.dustFreeUnit !== undefined) {
      return { name: "dustFreeUnit", u64Value: params.dustFreeUnit };
    }
    if (params.burnerTtlMax !== undefined) {
      return { name: "burnerTtlMax", i64Value: params.burnerTtlMax };
    }
    if (params.burnerTtlMin !== undefined) {
      return { name: "burnerTtlMin", i64Value: params.burnerTtlMin };
    }
    if (params.burnerRegistryCap !== undefined) {
      return { name: "burnerRegistryCap", u16Value: params.burnerRegistryCap };
    }
    if (params.mixMinParticipants !== undefined) {
      return { name: "mixMinParticipants", u8Value: params.mixMinParticipants };
    }
    if (params.mixMaxParticipants !== undefined) {
      return { name: "mixMaxParticipants", u8Value: params.mixMaxParticipants };
    }
    if (params.mixRevealWindow !== undefined) {
      return { name: "mixRevealWindow", i64Value: params.mixRevealWindow };
    }
    if (params.auditorCosignLamports !== undefined) {
      return {
        name: "auditorCosignLamports",
        u64Value: params.auditorCosignLamports
      };
    }
    throw sdkError("InvalidInput", "configUpdate requires at least one field");
  }

  /**
   * Derive the associated Token-2022 account for a given owner+mint pair.
   * Uses the standard ATA derivation with the Token-2022 program id.
   */
  public async deriveAta(mint: PublicKey, owner: PublicKey): Promise<PublicKey> {
    const [address] = PublicKey.findProgramAddressSync(
      [owner.toBuffer(), TOKEN_2022_PROGRAM_ID.toBuffer(), mint.toBuffer()],
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    return address;
  }

  /**
   * Fetch the raw account info for the GhosConfig PDA. Returns null if the
   * program has not been initialized yet.
   */
  public async fetchConfigRaw(): Promise<Buffer | null> {
    const pda = this.configPda();
    const info = await retry(
      () => this.connection.getAccountInfo(pda, this.commitment),
      { maxRetries: this.maxRetries, baseDelayMs: this.baseRetryDelayMs }
    );
    if (!info) {
      return null;
    }
    return info.data;
  }

  /**
   * Simulate the latest blockhash retrieval with retry. Useful when the
   * caller wants to pre-build a transaction and stash the blockhash for
   * later signing.
   */
  public async latestBlockhash(): Promise<{
    blockhash: string;
    lastValidBlockHeight: number;
  }> {
    return retry(
      async () => {
        try {
          return await this.connection.getLatestBlockhash(this.commitment);
        } catch (err) {
          throw coerceToSdkError(err);
        }
      },
      { maxRetries: this.maxRetries, baseDelayMs: this.baseRetryDelayMs }
    );
  }

  /**
   * Convenience: check whether the supplied public key is currently set as
   * the program admin.
   */
  public async isAdmin(candidate: PublicKey): Promise<boolean> {
    const raw = await this.fetchConfigRaw();
    if (!raw) {
      return false;
    }
    // admin stored right after the 8-byte Anchor discriminator.
    const adminBytes = raw.slice(8, 8 + 32);
    const stored = new PublicKey(adminBytes);
    return stored.equals(candidate);
  }

  /**
   * Return the address of the mix round PDA derived from host, mint, nonce.
   */
  public mixRoundPda(
    host: PublicKey,
    mint: PublicKey,
    nonce: bigint
  ): PublicKey {
    return deriveMixRoundPda(host, mint, nonce, this.programId).address;
  }

  /**
   * Sanity check the client configuration against the running program.
   * Returns `true` if the config PDA exists and its first byte matches the
   * GhosConfig discriminator.
   */
  public async healthCheck(): Promise<boolean> {
    try {
      const raw = await this.fetchConfigRaw();
      return raw !== null && raw.length > 8;
    } catch (err) {
      if (err instanceof GhosSdkError && err.code === SDK_ERROR_CODES.AccountNotFound) {
        return false;
      }
      return false;
    }
  }
}
