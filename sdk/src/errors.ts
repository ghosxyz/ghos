/**
 * Error code mirror of the on-chain `GhosError` enum.
 *
 * The numeric values must stay in sync with `programs/ghos/src/errors.rs`. The
 * SDK exposes a single `GhosSdkError` class plus a set of error-code constants.
 * Integrators can narrow on `err.code` to make targeted UI responses without
 * having to parse the program log line by line.
 */

/**
 * Frozen table of on-chain error codes. Anchor assigns codes starting at 6000,
 * incrementing by 1 per variant in declaration order. Any future addition
 * MUST be appended to the end to avoid reshuffling existing numbers.
 */
export const GHOS_ERROR_CODES = {
  AmountBelowDustFloor: 6000,
  AmountNotAligned: 6001,
  MintMissingConfidentialExt: 6002,
  MintWrongProgramOwner: 6003,
  AccountNotConfidential: 6004,
  AccountOwnerMismatch: 6005,
  InvalidCiphertext: 6006,
  RangeProofVerificationFailed: 6007,
  EqualityProofVerificationFailed: 6008,
  PubkeyValidityProofFailed: 6009,
  ZeroBalanceProofFailed: 6010,
  AuditorEntryMissing: 6011,
  AuditorMismatch: 6012,
  AuditorRotationTooSoon: 6013,
  BurnerTtlOutOfRange: 6014,
  BurnerExpired: 6015,
  BurnerAlreadyRegistered: 6016,
  BurnerCapReached: 6017,
  MixBelowMinimum: 6018,
  MixRoundFull: 6019,
  MixNotInCommit: 6020,
  MixNotInReveal: 6021,
  MixRevealMismatch: 6022,
  MixRevealTimeout: 6023,
  MixDenominationMismatch: 6024,
  MixAlreadyCommitted: 6025,
  MixNotCommitted: 6026,
  NotAdmin: 6027,
  Paused: 6028,
  UnexpectedProofContext: 6029,
  ConfidentialTransferDisabled: 6030,
  NothingToApply: 6031,
  WithdrawExceedsAvailable: 6032,
  ProtocolVersionMismatch: 6033
} as const;

export type GhosErrorName = keyof typeof GHOS_ERROR_CODES;
export type GhosErrorCode = (typeof GHOS_ERROR_CODES)[GhosErrorName];

/**
 * Human-readable explanations for each error. These are kept short because the
 * Anchor program also carries its own `#[msg(..)]` strings, but surfacing them
 * client-side means consumers can show a message without waiting for the full
 * log stream.
 */
export const GHOS_ERROR_MESSAGES: Record<GhosErrorName, string> = {
  AmountBelowDustFloor: "amount is below the dust-free quantization unit",
  AmountNotAligned: "amount is not aligned to the dust-free unit",
  MintMissingConfidentialExt:
    "mint does not have the Token-2022 confidential transfer extension",
  MintWrongProgramOwner: "mint owner is not the Token-2022 program",
  AccountNotConfidential:
    "token account is not a confidential account for the given mint",
  AccountOwnerMismatch: "token account owner does not match the signer",
  InvalidCiphertext: "supplied ElGamal ciphertext is malformed",
  RangeProofVerificationFailed:
    "range proof verification failed via zk-token-proof CPI",
  EqualityProofVerificationFailed:
    "equality proof verification failed via zk-token-proof CPI",
  PubkeyValidityProofFailed:
    "pubkey validity proof verification failed via zk-token-proof CPI",
  ZeroBalanceProofFailed:
    "zero balance proof verification failed via zk-token-proof CPI",
  AuditorEntryMissing:
    "auditor registration is required for this mint but was not provided",
  AuditorMismatch: "auditor public key does not match the registered entry",
  AuditorRotationTooSoon:
    "auditor rotation attempted before the cooldown period elapsed",
  BurnerTtlOutOfRange: "burner TTL is outside the allowed range",
  BurnerExpired: "burner has expired and may no longer be used",
  BurnerAlreadyRegistered:
    "burner is already registered for this owner at the requested seed",
  BurnerCapReached: "burner registry cap for this owner has been reached",
  MixBelowMinimum: "mix round requires a minimum number of participants",
  MixRoundFull: "mix round is full, cannot accept more participants",
  MixNotInCommit: "mix round is not in the commit phase",
  MixNotInReveal: "mix round is not in the reveal phase",
  MixRevealMismatch: "mix reveal does not match the prior commitment",
  MixRevealTimeout: "mix round reveal window has elapsed, round aborted",
  MixDenominationMismatch:
    "mix denomination does not match the round configuration",
  MixAlreadyCommitted: "participant already committed in this round",
  MixNotCommitted: "participant never committed, cannot reveal",
  NotAdmin: "the caller is not the protocol admin",
  Paused: "protocol has been paused by the admin",
  UnexpectedProofContext:
    "provided proof context account does not belong to the expected program",
  ConfidentialTransferDisabled:
    "calling instruction requires confidential_transfer feature to be enabled on the mint",
  NothingToApply: "apply pending requires a non-zero pending counter",
  WithdrawExceedsAvailable: "withdraw amount exceeds decrypted available balance",
  ProtocolVersionMismatch:
    "protocol version stored on-chain does not match program expectations"
};

/**
 * Sentinel base code used to identify program-level errors from Anchor.
 */
export const PROGRAM_ERROR_BASE = 6000;

/**
 * SDK-specific error codes that exist only client-side. They are assigned
 * numbers outside the program range (>= 9000) so they never collide with
 * on-chain variants.
 */
export const SDK_ERROR_CODES = {
  InvalidInput: 9000,
  InvalidPublicKey: 9001,
  InvalidAmount: 9002,
  AmountOverflow: 9003,
  InvalidMint: 9004,
  AccountNotFound: 9005,
  ProofGenerationFailed: 9006,
  DecodingFailed: 9007,
  NetworkError: 9008,
  Timeout: 9009,
  InvalidSigner: 9010,
  UnsupportedCluster: 9011,
  InvalidCiphertextLength: 9012,
  InvalidCommitmentLength: 9013,
  InvalidRangeProof: 9014,
  InvalidEqualityProof: 9015,
  RetryExhausted: 9016,
  InvalidKeyDerivation: 9017,
  MixRoundBusy: 9018,
  AuditorNotRegistered: 9019,
  BalanceOutOfRange: 9020,
  DecryptionFailed: 9021
} as const;

export type SdkErrorName = keyof typeof SDK_ERROR_CODES;
export type SdkErrorCode = (typeof SDK_ERROR_CODES)[SdkErrorName];

/**
 * Combined error code type, either a program code (>= 6000) or an SDK code
 * (>= 9000).
 */
export type GhosAnyErrorCode = GhosErrorCode | SdkErrorCode;

/**
 * The canonical error thrown by the SDK. It carries both the code and the
 * originating cause when one exists.
 */
export class GhosSdkError extends Error {
  public readonly code: GhosAnyErrorCode;
  public readonly name: string;
  public readonly cause?: unknown;
  public readonly details?: Record<string, unknown>;

  public constructor(
    code: GhosAnyErrorCode,
    message: string,
    options: { cause?: unknown; details?: Record<string, unknown> } = {}
  ) {
    super(message);
    this.code = code;
    this.name = "GhosSdkError";
    this.cause = options.cause;
    this.details = options.details;
    Object.setPrototypeOf(this, GhosSdkError.prototype);
  }

  public toJSON(): {
    name: string;
    code: GhosAnyErrorCode;
    message: string;
    details?: Record<string, unknown>;
  } {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details
    };
  }
}

/**
 * Construct a new `GhosSdkError` for an SDK-side validation failure.
 */
export function sdkError(
  name: SdkErrorName,
  message?: string,
  details?: Record<string, unknown>
): GhosSdkError {
  const code = SDK_ERROR_CODES[name];
  return new GhosSdkError(code, message ?? name, { details });
}

/**
 * Construct a `GhosSdkError` for a program-level error raised via Anchor.
 */
export function programError(
  name: GhosErrorName,
  cause?: unknown
): GhosSdkError {
  const code = GHOS_ERROR_CODES[name];
  const message = GHOS_ERROR_MESSAGES[name];
  return new GhosSdkError(code, message, { cause });
}

/**
 * Best-effort mapping of a numeric on-chain error code back to the canonical
 * name. Returns `null` if the code is outside the known range.
 */
export function programErrorName(code: number): GhosErrorName | null {
  const entries = Object.entries(GHOS_ERROR_CODES) as Array<
    [GhosErrorName, number]
  >;
  for (const [name, value] of entries) {
    if (value === code) {
      return name;
    }
  }
  return null;
}

/**
 * Best-effort conversion of any thrown object into a `GhosSdkError`. If the
 * input is already a `GhosSdkError` it is returned unmodified. If the input
 * carries a numeric `code` that matches a known on-chain variant, a rich
 * program error is returned. Otherwise the error is wrapped as a generic
 * network error.
 */
export function coerceToSdkError(input: unknown): GhosSdkError {
  if (input instanceof GhosSdkError) {
    return input;
  }
  if (input instanceof Error) {
    const maybeCode = extractErrorCode(input);
    if (maybeCode !== null) {
      const name = programErrorName(maybeCode);
      if (name !== null) {
        return programError(name, input);
      }
    }
    return new GhosSdkError(SDK_ERROR_CODES.NetworkError, input.message, {
      cause: input
    });
  }
  return new GhosSdkError(SDK_ERROR_CODES.NetworkError, String(input));
}

/**
 * Scan a thrown value for numeric error codes embedded in Anchor / RPC shapes.
 * Returns null if nothing parses.
 */
export function extractErrorCode(input: unknown): number | null {
  if (input === null || input === undefined) {
    return null;
  }
  if (typeof input === "number") {
    return Number.isFinite(input) ? input : null;
  }
  const candidate = input as {
    code?: unknown;
    error?: { errorCode?: { number?: number; code?: number | string } };
    errorCode?: number | string;
    logs?: string[];
    message?: string;
  };
  if (typeof candidate.code === "number") {
    return candidate.code;
  }
  if (candidate.error?.errorCode) {
    const ec = candidate.error.errorCode;
    if (typeof ec.number === "number") {
      return ec.number;
    }
    if (typeof ec.code === "number") {
      return ec.code;
    }
    if (typeof ec.code === "string") {
      const parsed = parseInt(ec.code, 10);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
  }
  if (typeof candidate.errorCode === "number") {
    return candidate.errorCode;
  }
  if (Array.isArray(candidate.logs)) {
    for (const line of candidate.logs) {
      const m = line.match(/custom program error: (0x[0-9a-fA-F]+|\d+)/);
      if (m && m[1]) {
        const raw = m[1].startsWith("0x") ? parseInt(m[1], 16) : parseInt(m[1], 10);
        if (!Number.isNaN(raw)) {
          return raw;
        }
      }
    }
  }
  if (typeof candidate.message === "string") {
    const m = candidate.message.match(/custom program error: (0x[0-9a-fA-F]+|\d+)/);
    if (m && m[1]) {
      const raw = m[1].startsWith("0x") ? parseInt(m[1], 16) : parseInt(m[1], 10);
      if (!Number.isNaN(raw)) {
        return raw;
      }
    }
  }
  return null;
}

/**
 * Type guard for `GhosSdkError`.
 */
export function isGhosSdkError(input: unknown): input is GhosSdkError {
  return input instanceof GhosSdkError;
}

/**
 * Type guard for on-chain program errors specifically.
 */
export function isProgramError(input: unknown): input is GhosSdkError {
  if (!isGhosSdkError(input)) {
    return false;
  }
  return input.code >= PROGRAM_ERROR_BASE && input.code < PROGRAM_ERROR_BASE + 1000;
}

/**
 * Type guard for SDK-level errors.
 */
export function isSdkClientError(input: unknown): input is GhosSdkError {
  if (!isGhosSdkError(input)) {
    return false;
  }
  return input.code >= 9000;
}
