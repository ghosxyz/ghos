/**
 * Account fixture helpers used across the ghos integration tests.
 *
 * PDA derivation follows the seeds defined in programs/ghos/src/constants.rs.
 * Changing any seed here without also changing the program constants will
 * cause every test to fail at the first PDA lookup, which is intentional.
 */
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

/** The ghos program id as declared in programs/ghos/src/lib.rs. */
export const GHOS_PROGRAM_ID = new PublicKey(
  "EnKo8EbfJkani8UePTmAVPzdCZM8vMEYYkjTar4fwBPg"
);

export const CONFIG_SEED = Buffer.from("ghos.config");
export const BURNER_SEED = Buffer.from("ghos.burner");
export const MIX_ROUND_SEED = Buffer.from("ghos.mix.round");
export const MIX_COMMITMENT_SEED = Buffer.from("ghos.mix.commit");
export const AUDITOR_SEED = Buffer.from("ghos.auditor");
export const PADDING_VAULT_SEED = Buffer.from("ghos.padding");

/** Singleton config PDA. */
export function deriveConfigPda(
  programId: PublicKey = GHOS_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([CONFIG_SEED], programId);
}

/** Per-owner burner registry entry PDA. */
export function deriveBurnerPda(
  owner: PublicKey,
  nonce: number,
  programId: PublicKey = GHOS_PROGRAM_ID
): [PublicKey, number] {
  const nonceBuf = Buffer.alloc(8);
  nonceBuf.writeBigUInt64LE(BigInt(nonce));
  return PublicKey.findProgramAddressSync(
    [BURNER_SEED, owner.toBuffer(), nonceBuf],
    programId
  );
}

/** CoinJoin round PDA, keyed by host and round nonce. */
export function deriveMixRoundPda(
  host: PublicKey,
  roundNonce: number,
  programId: PublicKey = GHOS_PROGRAM_ID
): [PublicKey, number] {
  const nonceBuf = Buffer.alloc(8);
  nonceBuf.writeBigUInt64LE(BigInt(roundNonce));
  return PublicKey.findProgramAddressSync(
    [MIX_ROUND_SEED, host.toBuffer(), nonceBuf],
    programId
  );
}

/** Per-participant mix commitment PDA. */
export function deriveMixCommitmentPda(
  round: PublicKey,
  participant: PublicKey,
  programId: PublicKey = GHOS_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [MIX_COMMITMENT_SEED, round.toBuffer(), participant.toBuffer()],
    programId
  );
}

/** Per-mint auditor registry entry PDA. */
export function deriveAuditorPda(
  mint: PublicKey,
  programId: PublicKey = GHOS_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [AUDITOR_SEED, mint.toBuffer()],
    programId
  );
}

/** Padding refund vault for dust-free quantization. */
export function derivePaddingVaultPda(
  programId: PublicKey = GHOS_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([PADDING_VAULT_SEED], programId);
}

/**
 * Provision a fresh funded keypair for use as a test actor.
 *
 * On localnet we simply airdrop; on devnet we split from the payer because
 * airdrop rate limiting makes per-actor airdrops unreliable during CI runs.
 */
export async function createFundedActor(
  connection: Connection,
  payer: Keypair,
  lamports: number,
  mode: "airdrop" | "transfer" = "transfer"
): Promise<Keypair> {
  const actor = Keypair.generate();
  if (mode === "airdrop") {
    const sig = await connection.requestAirdrop(actor.publicKey, lamports);
    await connection.confirmTransaction(sig, "confirmed");
  } else {
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: actor.publicKey,
        lamports,
      })
    );
    await sendAndConfirmTransaction(connection, tx, [payer]);
  }
  return actor;
}

/**
 * Create N funded actors in parallel, useful for mix-round participant
 * setup.
 */
export async function createActorPool(
  connection: Connection,
  payer: Keypair,
  count: number,
  lamportsEach: number
): Promise<Keypair[]> {
  const actors: Keypair[] = [];
  for (let i = 0; i < count; i++) {
    actors.push(await createFundedActor(connection, payer, lamportsEach));
  }
  return actors;
}

/**
 * Account fetcher that waits for an account to exist, polling with a
 * bounded retry budget. Mirrors the SDK's internal retry helper but is
 * repeated here so tests do not depend on SDK internals.
 */
export async function waitForAccount(
  connection: Connection,
  address: PublicKey,
  timeoutMs = 8_000,
  intervalMs = 250
): Promise<Buffer> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const info = await connection.getAccountInfo(address, "confirmed");
    if (info) {
      return Buffer.from(info.data);
    }
    await sleep(intervalMs);
  }
  throw new Error(
    `account ${address.toBase58()} did not appear within ${timeoutMs}ms`
  );
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Read the little-endian u64 stored at offset `offset` in an account's data
 * region. Used to decode counters in the GhosConfig account.
 */
export function readU64LE(data: Buffer, offset: number): bigint {
  return data.readBigUInt64LE(offset);
}

/**
 * Read the little-endian i64 stored at offset `offset`.
 */
export function readI64LE(data: Buffer, offset: number): bigint {
  return data.readBigInt64LE(offset);
}

/**
 * Read a 32-byte pubkey slice starting at the given offset.
 */
export function readPubkey(data: Buffer, offset: number): PublicKey {
  return new PublicKey(data.subarray(offset, offset + 32));
}

/**
 * Offsets inside a serialized GhosConfig account. These match the field
 * order in programs/ghos/src/state.rs. Changing field order in state.rs
 * requires changing this table.
 */
export const CONFIG_OFFSETS = {
  DISCRIMINATOR: 0,
  ADMIN: 8,
  VERSION: 40,
  PAUSED: 42,
  DUST_FREE_UNIT: 43,
  BURNER_TTL_MAX: 51,
  BURNER_TTL_MIN: 59,
  BURNER_REGISTRY_CAP: 67,
  MIX_MIN_PARTICIPANTS: 69,
  MIX_MAX_PARTICIPANTS: 70,
  MIX_REVEAL_WINDOW: 71,
  AUDITOR_COSIGN_LAMPORTS: 79,
  LAST_UPDATED: 87,
  BUMP: 95,
} as const;

/**
 * Offsets inside a serialized BurnerAccount. Mirrors state.rs layout.
 */
export const BURNER_OFFSETS = {
  DISCRIMINATOR: 0,
  OWNER: 8,
  BURNER_PUBKEY: 40,
  CREATED_AT: 72,
  EXPIRES_AT: 80,
  NONCE: 88,
  REVOKED: 96,
  USAGE_COUNT: 97,
  BUMP: 101,
} as const;

/**
 * Offsets inside a serialized AuditorEntry.
 */
export const AUDITOR_OFFSETS = {
  DISCRIMINATOR: 0,
  MINT: 8,
  AUDITOR_PUBKEY: 40,
  REGISTERED_AT: 72,
  LAST_ROTATED_AT: 80,
  ROTATION_COOLDOWN: 88,
  ADMIN: 96,
  BUMP: 128,
} as const;

/**
 * Offsets inside a MixRound account.
 */
export const MIX_ROUND_OFFSETS = {
  DISCRIMINATOR: 0,
  MINT: 8,
  DENOMINATION: 40,
  HOST: 48,
  CAPACITY: 80,
  COMMITTED: 81,
  REVEALED: 82,
  PHASE: 83,
  OPENED_AT: 84,
  COMMIT_CLOSE_AT: 92,
  REVEAL_CLOSE_AT: 100,
  SETTLED_AT: 108,
  BUMP: 116,
} as const;

/**
 * MixPhase enum values, matching state.rs.
 */
export const MIX_PHASE = {
  OPEN: 0,
  COMMIT: 1,
  REVEAL: 2,
  SETTLING: 3,
  SETTLED: 4,
  ABORTED: 5,
} as const;

/**
 * Utility to compare two PublicKey arrays ignoring order.
 */
export function pubkeySetEquals(a: PublicKey[], b: PublicKey[]): boolean {
  if (a.length !== b.length) return false;
  const aSet = new Set(a.map((k) => k.toBase58()));
  for (const k of b) {
    if (!aSet.has(k.toBase58())) return false;
  }
  return true;
}

/**
 * Increment and return a process-local nonce counter used when building
 * burner / mix PDAs. Avoids seed collision across tests sharing a ledger.
 */
let __nonceCounter = Math.floor(Date.now() / 1000) & 0xfffffff;
export function nextNonce(): number {
  __nonceCounter = (__nonceCounter + 1) >>> 0;
  return __nonceCounter;
}
