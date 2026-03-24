/**
 * migrations/deploy.ts
 *
 * Post-deploy hook. Runs after `anchor deploy`. Responsibilities:
 *
 *   1. Initialize the GhosConfig PDA with the admin that signs this script.
 *   2. Verify the on-chain protocol version matches the expected constant.
 *   3. Emit a JSON summary to stdout for CI consumption.
 *
 * This script is idempotent: if the config PDA already exists, it reads
 * the current state instead of re-initializing.
 *
 * Usage:
 *   anchor migrate                          # reads Anchor.toml provider
 *   yarn ts-node migrations/deploy.ts       # direct invocation
 */
import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Program, web3 } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  clusterApiUrl,
} from "@solana/web3.js";
import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { resolve as pathResolve } from "path";

const GHOS_PROGRAM_ID = new PublicKey(
  "EnKo8EbfJkani8UePTmAVPzdCZM8vMEYYkjTar4fwBPg"
);
const EXPECTED_VERSION = 0x0401;
const CONFIG_SEED = Buffer.from("ghos.config");
const CONFIG_OFFSETS = {
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
};

interface DeploySummary {
  cluster: string;
  programId: string;
  config: string;
  configBump: number;
  admin: string;
  version: number;
  paused: boolean;
  dustFreeUnit: string;
  burnerTtlMax: string;
  burnerTtlMin: string;
  burnerRegistryCap: number;
  mixMinParticipants: number;
  mixMaxParticipants: number;
  mixRevealWindow: string;
  auditorCosignLamports: string;
  alreadyInitialized: boolean;
  txSignature?: string;
}

function expandHome(p: string): string {
  if (p.startsWith("~/")) return pathResolve(homedir(), p.slice(2));
  return pathResolve(p);
}

function loadKeypair(path: string): Keypair {
  const expanded = expandHome(path);
  if (!existsSync(expanded)) {
    throw new Error(`wallet not found: ${expanded}`);
  }
  const raw = JSON.parse(readFileSync(expanded, "utf-8"));
  return Keypair.fromSecretKey(new Uint8Array(raw));
}

function resolveProvider(): AnchorProvider {
  try {
    return AnchorProvider.env();
  } catch {
    const cluster = process.env.GHOS_CLUSTER ?? clusterApiUrl("devnet");
    const walletPath = process.env.GHOS_WALLET ?? "~/.config/solana/id.json";
    const connection = new Connection(cluster, "confirmed");
    const payer = loadKeypair(walletPath);
    return new AnchorProvider(connection, new anchor.Wallet(payer), {
      commitment: "confirmed",
    });
  }
}

function deriveConfig(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([CONFIG_SEED], programId);
}

async function ensureConfigInitialized(
  provider: AnchorProvider,
  program: Program<anchor.Idl>
): Promise<{ signature?: string; alreadyInitialized: boolean }> {
  const [config] = deriveConfig(program.programId);
  const info = await provider.connection.getAccountInfo(config, "confirmed");
  if (info && info.data.length > 0) {
    return { alreadyInitialized: true };
  }

  const admin = (provider.wallet as anchor.Wallet).payer;
  const sig = await program.methods
    .initialize()
    .accounts({
      config,
      admin: admin.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  await provider.connection.confirmTransaction(sig, "confirmed");
  return { signature: sig, alreadyInitialized: false };
}

function readConfigAccount(data: Buffer): Omit<
  DeploySummary,
  | "cluster"
  | "programId"
  | "config"
  | "configBump"
  | "alreadyInitialized"
  | "txSignature"
> {
  return {
    admin: new PublicKey(
      data.subarray(CONFIG_OFFSETS.ADMIN, CONFIG_OFFSETS.ADMIN + 32)
    ).toBase58(),
    version: data.readUInt16LE(CONFIG_OFFSETS.VERSION),
    paused: data.readUInt8(CONFIG_OFFSETS.PAUSED) === 1,
    dustFreeUnit: data.readBigUInt64LE(CONFIG_OFFSETS.DUST_FREE_UNIT).toString(),
    burnerTtlMax: data
      .readBigInt64LE(CONFIG_OFFSETS.BURNER_TTL_MAX)
      .toString(),
    burnerTtlMin: data
      .readBigInt64LE(CONFIG_OFFSETS.BURNER_TTL_MIN)
      .toString(),
    burnerRegistryCap: data.readUInt16LE(CONFIG_OFFSETS.BURNER_REGISTRY_CAP),
    mixMinParticipants: data.readUInt8(CONFIG_OFFSETS.MIX_MIN_PARTICIPANTS),
    mixMaxParticipants: data.readUInt8(CONFIG_OFFSETS.MIX_MAX_PARTICIPANTS),
    mixRevealWindow: data
      .readBigInt64LE(CONFIG_OFFSETS.MIX_REVEAL_WINDOW)
      .toString(),
    auditorCosignLamports: data
      .readBigUInt64LE(CONFIG_OFFSETS.AUDITOR_COSIGN_LAMPORTS)
      .toString(),
  };
}

async function main(): Promise<void> {
  const provider = resolveProvider();
  anchor.setProvider(provider);

  const program =
    (anchor.workspace.Ghos as Program<anchor.Idl> | undefined) ??
    (() => {
      throw new Error(
        "ghos program not available in anchor.workspace. run `anchor build` first."
      );
    })();

  const [config, configBump] = deriveConfig(program.programId);

  const { signature, alreadyInitialized } = await ensureConfigInitialized(
    provider,
    program
  );

  const info = await provider.connection.getAccountInfo(config, "confirmed");
  if (!info) {
    throw new Error("config PDA did not appear after initialize");
  }
  const readBack = readConfigAccount(info.data);
  if (readBack.version !== EXPECTED_VERSION) {
    throw new Error(
      `version mismatch: on-chain=${readBack.version.toString(16)} expected=${EXPECTED_VERSION.toString(
        16
      )}`
    );
  }

  const summary: DeploySummary = {
    cluster: provider.connection.rpcEndpoint,
    programId: program.programId.toBase58(),
    config: config.toBase58(),
    configBump,
    alreadyInitialized,
    txSignature: signature,
    ...readBack,
  };

  process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
}

main().catch((e) => {
  process.stderr.write(`[deploy] fatal: ${(e as Error).message}\n`);
  process.exit(1);
});

// Re-export internals for test harness consumption.
export {
  GHOS_PROGRAM_ID,
  EXPECTED_VERSION,
  CONFIG_SEED,
  CONFIG_OFFSETS,
  deriveConfig,
  readConfigAccount,
  ensureConfigInitialized,
};
