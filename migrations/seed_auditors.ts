/**
 * migrations/seed_auditors.ts
 *
 * Post-deploy auditor registration. Reads a JSON file containing one
 * record per mint and registers the auditor entry on-chain via the
 * ghos `auditor_register` instruction.
 *
 * Auditor file shape:
 *   [
 *     {
 *       "mint": "<mint-pubkey>",
 *       "auditorPubkey": "<hex-32-bytes>",
 *       "rotationCooldownSeconds": 86400
 *     },
 *     ...
 *   ]
 *
 * Usage:
 *   GHOS_AUDITOR_FILE=./migrations/auditors.devnet.json \
 *   yarn ts-node migrations/seed_auditors.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
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
import { BN } from "bn.js";

const AUDITOR_SEED = Buffer.from("ghos.auditor");
const GHOS_PROGRAM_ID = new PublicKey(
  "EnKo8EbfJkani8UePTmAVPzdCZM8vMEYYkjTar4fwBPg"
);

interface AuditorRecord {
  mint: PublicKey;
  auditorPubkey: Uint8Array;
  rotationCooldownSeconds: number;
}

interface SeedResult {
  mint: string;
  auditorPubkey: string;
  pda: string;
  alreadyRegistered: boolean;
  txSignature?: string;
}

function expandHome(p: string): string {
  if (p.startsWith("~/")) return pathResolve(homedir(), p.slice(2));
  return pathResolve(p);
}

function loadKeypair(path: string): Keypair {
  const p = expandHome(path);
  if (!existsSync(p)) throw new Error(`wallet not found: ${p}`);
  const raw = JSON.parse(readFileSync(p, "utf-8"));
  return Keypair.fromSecretKey(new Uint8Array(raw));
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, "");
  if (clean.length !== 64) {
    throw new Error(`expected 32-byte hex, got ${clean.length / 2} bytes`);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function loadAuditorFile(path: string): AuditorRecord[] {
  const full = expandHome(path);
  if (!existsSync(full)) throw new Error(`auditor file not found: ${full}`);
  const raw = JSON.parse(readFileSync(full, "utf-8"));
  if (!Array.isArray(raw)) throw new Error("auditor file must be an array");
  return raw.map((entry, i) => {
    if (typeof entry.mint !== "string") {
      throw new Error(`entry ${i} missing mint`);
    }
    if (typeof entry.auditorPubkey !== "string") {
      throw new Error(`entry ${i} missing auditorPubkey`);
    }
    if (typeof entry.rotationCooldownSeconds !== "number") {
      throw new Error(`entry ${i} missing rotationCooldownSeconds`);
    }
    return {
      mint: new PublicKey(entry.mint),
      auditorPubkey: hexToBytes(entry.auditorPubkey),
      rotationCooldownSeconds: entry.rotationCooldownSeconds,
    };
  });
}

function deriveAuditorPda(mint: PublicKey, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [AUDITOR_SEED, mint.toBuffer()],
    programId
  );
}

function resolveProvider(): AnchorProvider {
  try {
    return AnchorProvider.env();
  } catch {
    const url = process.env.GHOS_CLUSTER ?? clusterApiUrl("devnet");
    const walletPath = process.env.GHOS_WALLET ?? "~/.config/solana/id.json";
    const conn = new Connection(url, "confirmed");
    const payer = loadKeypair(walletPath);
    return new AnchorProvider(conn, new anchor.Wallet(payer), {
      commitment: "confirmed",
    });
  }
}

async function seedOne(
  program: Program<anchor.Idl>,
  provider: AnchorProvider,
  record: AuditorRecord
): Promise<SeedResult> {
  const [pda] = deriveAuditorPda(record.mint, program.programId);
  const existing = await provider.connection.getAccountInfo(pda, "confirmed");
  if (existing && existing.data.length > 0) {
    return {
      mint: record.mint.toBase58(),
      auditorPubkey: Buffer.from(record.auditorPubkey).toString("hex"),
      pda: pda.toBase58(),
      alreadyRegistered: true,
    };
  }

  const admin = (provider.wallet as anchor.Wallet).payer;
  let signature: string | undefined;
  try {
    signature = await program.methods
      .auditorRegister(
        Array.from(record.auditorPubkey),
        new BN(record.rotationCooldownSeconds)
      )
      .accounts({
        entry: pda,
        mint: record.mint,
        admin: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    await provider.connection.confirmTransaction(signature, "confirmed");
  } catch (e) {
    process.stderr.write(
      `[seed] register failed for ${record.mint.toBase58()}: ${(e as Error).message}\n`
    );
  }
  return {
    mint: record.mint.toBase58(),
    auditorPubkey: Buffer.from(record.auditorPubkey).toString("hex"),
    pda: pda.toBase58(),
    alreadyRegistered: false,
    txSignature: signature,
  };
}

async function main(): Promise<void> {
  const filePath = process.env.GHOS_AUDITOR_FILE;
  if (!filePath) {
    throw new Error("GHOS_AUDITOR_FILE is required");
  }
  const records = loadAuditorFile(filePath);
  process.stdout.write(
    `[seed] loaded ${records.length} auditor records from ${filePath}\n`
  );

  const provider = resolveProvider();
  anchor.setProvider(provider);
  const program = anchor.workspace.Ghos as Program<anchor.Idl> | undefined;
  if (!program) {
    throw new Error("anchor.workspace.Ghos unavailable. Run `anchor build`.");
  }

  const results: SeedResult[] = [];
  for (const r of records) {
    const result = await seedOne(program, provider, r);
    results.push(result);
    const tag = result.alreadyRegistered
      ? "skip (exists)"
      : result.txSignature
      ? `ok ${result.txSignature.slice(0, 8)}...`
      : "fail";
    process.stdout.write(`  ${r.mint.toBase58()} -> ${tag}\n`);
  }

  process.stdout.write(JSON.stringify(results, null, 2) + "\n");
}

main().catch((e) => {
  process.stderr.write(`[seed] fatal: ${(e as Error).message}\n`);
  process.exit(1);
});

export { hexToBytes, deriveAuditorPda, loadAuditorFile, seedOne };
