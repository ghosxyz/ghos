/**
 * Utility helpers: retry with exponential backoff, BN conversion, Token-2022
 * mint probing, confirmation strategy, microlamport budgeting helpers.
 */

import {
  Commitment,
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  Signer,
  Transaction,
  TransactionInstruction,
  TransactionSignature,
  sendAndConfirmTransaction
} from "@solana/web3.js";
import BN from "bn.js";
import {
  DEFAULT_PRIORITY_FEE_MICROLAMPORTS,
  DEFAULT_RETRY_POLICY,
  RECOMMENDED_CU_BUDGET,
  TOKEN_2022_PROGRAM_ID
} from "./constants";
import { GhosSdkError, SDK_ERROR_CODES, coerceToSdkError, sdkError } from "./errors";

/**
 * Sleep helper. Implemented with `setTimeout`, no external deps.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry policy configuration consumed by the `retry` helper.
 */
export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitter?: boolean;
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
}

/**
 * Predicate used by default: returns true for obviously transient RPC errors
 * (blockhash-not-found, rate-limited, timeouts). Callers can override.
 */
export function defaultShouldRetry(err: unknown): boolean {
  const message = extractMessage(err).toLowerCase();
  if (message.includes("blockhash not found")) {
    return true;
  }
  if (message.includes("429")) {
    return true;
  }
  if (message.includes("too many requests")) {
    return true;
  }
  if (message.includes("socket hang up")) {
    return true;
  }
  if (message.includes("econnreset")) {
    return true;
  }
  if (message.includes("etimedout")) {
    return true;
  }
  if (message.includes("enotfound")) {
    return true;
  }
  if (message.includes("503")) {
    return true;
  }
  if (message.includes("502")) {
    return true;
  }
  if (message.includes("timeout")) {
    return true;
  }
  return false;
}

/**
 * Best-effort message extractor for unknown thrown objects.
 */
export function extractMessage(err: unknown): string {
  if (err === null || err === undefined) {
    return "";
  }
  if (typeof err === "string") {
    return err;
  }
  if (err instanceof Error) {
    return err.message;
  }
  const maybe = err as { message?: unknown };
  if (typeof maybe.message === "string") {
    return maybe.message;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/**
 * Run an async operation with exponential backoff retry. The first retry waits
 * `baseDelayMs`, subsequent retries double each time up to `maxDelayMs`. When
 * `jitter` is true we add 0..1x random spread to avoid thundering herds across
 * a crowded RPC.
 */
export async function retry<T>(
  op: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? DEFAULT_RETRY_POLICY.maxRetries;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_RETRY_POLICY.baseDelayMs;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_RETRY_POLICY.maxDelayMs;
  const jitter = options.jitter ?? DEFAULT_RETRY_POLICY.jitter;
  const shouldRetry = options.shouldRetry ?? defaultShouldRetry;

  let attempt = 0;
  let lastError: unknown;
  while (attempt <= maxRetries) {
    try {
      return await op();
    } catch (err) {
      lastError = err;
      if (attempt === maxRetries || !shouldRetry(err, attempt)) {
        break;
      }
      const exp = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt));
      const delayMs = jitter ? Math.floor(exp * (0.5 + Math.random() / 2)) : exp;
      if (options.onRetry) {
        options.onRetry(err, attempt, delayMs);
      }
      await sleep(delayMs);
      attempt += 1;
    }
  }
  throw new GhosSdkError(
    SDK_ERROR_CODES.RetryExhausted,
    `retry exhausted after ${attempt + 1} attempt(s): ${extractMessage(lastError)}`,
    { cause: lastError }
  );
}

/**
 * Convert a bigint to an Anchor BN instance.
 */
export function toBN(value: bigint | number | BN): BN {
  if (BN.isBN(value)) {
    return value;
  }
  if (typeof value === "bigint") {
    return new BN(value.toString());
  }
  return new BN(value);
}

/**
 * Convert an Anchor BN instance back to a bigint.
 */
export function bnToBig(value: BN): bigint {
  return BigInt(value.toString());
}

/**
 * Safely clamp a bigint into the 64-bit unsigned range. Used when the caller
 * passes something that comes from JSON where leniency is expected.
 */
export function clampU64(value: bigint): bigint {
  if (value < 0n) {
    throw sdkError("AmountOverflow", "negative amount rejected");
  }
  const max = (1n << 64n) - 1n;
  if (value > max) {
    throw sdkError("AmountOverflow", "amount exceeds u64::MAX");
  }
  return value;
}

/**
 * Round a bigint down to the nearest multiple of `unit`. Throws if the input
 * is negative. Returns the rounded value and the remainder.
 */
export function roundDownTo(
  value: bigint,
  unit: bigint
): { rounded: bigint; remainder: bigint } {
  if (value < 0n) {
    throw sdkError("InvalidAmount", "cannot round a negative amount");
  }
  if (unit <= 0n) {
    throw sdkError("InvalidAmount", "unit must be positive");
  }
  const remainder = value % unit;
  return { rounded: value - remainder, remainder };
}

/**
 * Hex-encode a Uint8Array.
 */
export function hexEncode(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Hex-decode a string into a Uint8Array.
 */
export function hexDecode(hex: string): Uint8Array {
  let clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) {
    clean = "0" + clean;
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    const slice = clean.slice(i * 2, i * 2 + 2);
    const byte = parseInt(slice, 16);
    if (Number.isNaN(byte)) {
      throw sdkError("DecodingFailed", `invalid hex byte at offset ${i}`);
    }
    out[i] = byte;
  }
  return out;
}

/**
 * Compare two Uint8Arrays for structural equality in constant time.
 */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    const aValue = a[i] ?? 0;
    const bValue = b[i] ?? 0;
    result |= aValue ^ bValue;
  }
  return result === 0;
}

/**
 * Concatenate multiple byte arrays. Small helper that avoids the verbose
 * `Buffer.concat` invocation and works with any `ArrayLike<number>`.
 */
export function concatBytes(...parts: Array<Uint8Array | Buffer>): Uint8Array {
  let total = 0;
  for (const p of parts) {
    total += p.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/**
 * Probe whether a given mint has the Token-2022 confidential transfer
 * extension enabled. The SDK uses this to fail fast before submitting a shield
 * or transfer instruction against a classical SPL mint.
 */
export async function probeToken22Mint(
  connection: Connection,
  mint: PublicKey
): Promise<{
  isToken22: boolean;
  owner: PublicKey;
  lamports: number;
}> {
  const info = await connection.getAccountInfo(mint);
  if (!info) {
    throw sdkError("AccountNotFound", `mint ${mint.toBase58()} not found`);
  }
  const isToken22 = info.owner.equals(TOKEN_2022_PROGRAM_ID);
  return { isToken22, owner: info.owner, lamports: info.lamports };
}

/**
 * Build the compute budget instruction pair (limit + price) used by
 * proof-heavy transactions.
 */
export function computeBudgetIxs(
  opts: { units?: number; priceMicroLamports?: number } = {}
): TransactionInstruction[] {
  const units = opts.units ?? RECOMMENDED_CU_BUDGET;
  const priceMicroLamports =
    opts.priceMicroLamports ?? DEFAULT_PRIORITY_FEE_MICROLAMPORTS;
  const ixs: TransactionInstruction[] = [];
  ixs.push(ComputeBudgetProgram.setComputeUnitLimit({ units }));
  if (priceMicroLamports > 0) {
    ixs.push(
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: priceMicroLamports
      })
    );
  }
  return ixs;
}

/**
 * Wrap the send-and-confirm flow with the SDK's retry policy.
 */
export async function sendAndConfirmWithRetry(
  connection: Connection,
  tx: Transaction,
  signers: Signer[],
  opts: {
    commitment?: Commitment;
    skipPreflight?: boolean;
    maxRetries?: number;
    baseDelayMs?: number;
  } = {}
): Promise<TransactionSignature> {
  const commitment = opts.commitment ?? "confirmed";
  const skipPreflight = opts.skipPreflight ?? false;
  return retry(
    async () => {
      try {
        return await sendAndConfirmTransaction(connection, tx, signers, {
          commitment,
          skipPreflight,
          preflightCommitment: commitment,
          maxRetries: 0
        });
      } catch (err) {
        throw coerceToSdkError(err);
      }
    },
    {
      maxRetries: opts.maxRetries ?? DEFAULT_RETRY_POLICY.maxRetries,
      baseDelayMs: opts.baseDelayMs ?? DEFAULT_RETRY_POLICY.baseDelayMs
    }
  );
}

/**
 * Convert a `bigint` amount expressed in base units into a human decimal
 * string using the given number of decimals. Intended for display only, not
 * for any math.
 */
export function formatAmount(amount: bigint, decimals: number): string {
  if (decimals < 0 || decimals > 20) {
    throw sdkError("InvalidInput", "decimals out of range");
  }
  const scale = 10n ** BigInt(decimals);
  const whole = amount / scale;
  const fractional = amount % scale;
  if (fractional === 0n) {
    return whole.toString();
  }
  const fracStr = fractional
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return fracStr.length > 0 ? `${whole.toString()}.${fracStr}` : whole.toString();
}

/**
 * Parse a human decimal string into a `bigint` base-unit amount.
 */
export function parseAmount(value: string, decimals: number): bigint {
  if (decimals < 0 || decimals > 20) {
    throw sdkError("InvalidInput", "decimals out of range");
  }
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw sdkError("InvalidInput", `cannot parse amount: ${value}`);
  }
  const [wholePart, fracPart = ""] = trimmed.split(".");
  if (fracPart.length > decimals) {
    throw sdkError(
      "InvalidInput",
      `amount has more than ${decimals} decimal places`
    );
  }
  const padded = fracPart.padEnd(decimals, "0");
  const combined = `${wholePart ?? "0"}${padded}`;
  return BigInt(combined);
}

/**
 * Convert a Uint8Array to base64.
 */
export function toBase64(bytes: Uint8Array): string {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return buf.toString("base64");
}

/**
 * Decode a base64 string into a Uint8Array.
 */
export function fromBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64"));
}

/**
 * Convenience: compare two PublicKeys for equality.
 */
export function publicKeyEquals(a: PublicKey, b: PublicKey): boolean {
  return a.equals(b);
}

/**
 * Assert that the amount is greater than zero, throwing `InvalidAmount` if not.
 */
export function assertPositiveAmount(amount: bigint, label = "amount"): void {
  if (amount <= 0n) {
    throw sdkError("InvalidAmount", `${label} must be positive`);
  }
}

/**
 * Assert that the amount is a multiple of the dust-free unit.
 */
export function assertDustFreeAligned(amount: bigint, unit: bigint): void {
  if (amount % unit !== 0n) {
    throw sdkError(
      "InvalidAmount",
      `amount ${amount} is not aligned to dust-free unit ${unit}`
    );
  }
}

/**
 * Produce a short, deterministic identifier string for a public key useful in
 * log output. Returns first 4 + last 4 base58 chars.
 */
export function shortKey(key: PublicKey): string {
  const str = key.toBase58();
  if (str.length <= 8) {
    return str;
  }
  return `${str.slice(0, 4)}..${str.slice(-4)}`;
}

/**
 * Generic guard: throw `sdkError("InvalidInput", ...)` when the predicate is
 * false. Helps keep instruction wrappers linear.
 */
export function requireInput(
  condition: boolean,
  message: string
): asserts condition {
  if (!condition) {
    throw sdkError("InvalidInput", message);
  }
}

/**
 * Simple random scalar for salts and nonces. Uses the platform-provided
 * `crypto.getRandomValues` when available (Node 20+, all modern browsers).
 */
export function randomBytes(len: number): Uint8Array {
  const out = new Uint8Array(len);
  const cryptoObj = (globalThis as { crypto?: { getRandomValues?: (arr: Uint8Array) => void } }).crypto;
  if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
    cryptoObj.getRandomValues(out);
    return out;
  }
  throw sdkError(
    "InvalidInput",
    "no CSPRNG available: globalThis.crypto.getRandomValues is required"
  );
}

/**
 * Generate a random 64-bit nonce suitable for burner / mix round identifiers.
 */
export function randomNonce(): bigint {
  const bytes = randomBytes(8);
  let n = 0n;
  for (let i = 0; i < 8; i++) {
    n = (n << 8n) | BigInt(bytes[i] ?? 0);
  }
  return n;
}

/**
 * Wrap an async function with a timeout, rejecting with `Timeout` if it runs
 * past `ms`. Useful for RPC calls that hang.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label = "operation"
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new GhosSdkError(
            SDK_ERROR_CODES.Timeout,
            `${label} timed out after ${ms}ms`
          )
        ),
      ms
    );
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

// fix: SDK bn.js type import under node 22 strict
