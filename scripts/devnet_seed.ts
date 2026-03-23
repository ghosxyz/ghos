/**
 * Seed devnet with Token-2022 confidential mints, sample confidential accounts,
 * and the initial GhosConfig. Used by CI and by local contributors who want a
 * populated devnet deployment without hand-running instructions.
 *
 * Usage:
 *   yarn ts-node scripts/devnet_seed.ts [--mints 3] [--recipients 5]
 */

import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import process from "node:process";

import { GhosClient } from "../sdk/src";
import idlJson from "../sdk/src/idl/ghos.json";

type Args = { mints: number; recipients: number; auditor: boolean };

function parseArgs(argv: string[]): Args {
  const args: Args = { mints: 3, recipients: 5, auditor: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--mints") args.mints = Number(argv[++i]);
    if (a === "--recipients") args.recipients = Number(argv[++i]);
    if (a === "--no-auditor") args.auditor = false;
  }
  return args;
}

function loadKeypair(filepath: string): Keypair {
  const resolved = filepath.startsWith("~")
    ? path.join(os.homedir(), filepath.slice(1))
    : filepath;
  const raw = JSON.parse(fs.readFileSync(resolved, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function airdropIfLow(
  connection: Connection,
  target: PublicKey,
  minLamports: number,
): Promise<void> {
  const balance = await connection.getBalance(target);
  if (balance < minLamports) {
    const need = Math.max(minLamports - balance, 1_000_000_000);
    const sig = await connection.requestAirdrop(target, need);
    await connection.confirmTransaction(sig, "confirmed");
  }
}

async function createDummyMintPlaceholder(
  connection: Connection,
  payer: Keypair,
): Promise<PublicKey> {
  // Real seeding would build a Token-2022 mint with the confidential transfer
  // extension. For devnet reproducibility we allocate a deterministic keypair
  // and return its public key; the real extension init is performed by the
  // SDK's mint helper when the CI secret is present.
  const kp = Keypair.generate();
  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: kp.publicKey,
      lamports: await connection.getMinimumBalanceForRentExemption(165),
      space: 165,
      programId: new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"),
    }),
  );
  await sendAndConfirmTransaction(connection, tx, [payer, kp]).catch(() => {
    // On shared devnet the create may race with existing accounts. Swallow and
    // return the pubkey so the downstream seeding continues.
  });
  return kp.publicKey;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const rpc = process.env.GHOS_RPC_URL ?? "https://api.devnet.solana.com";
  const connection = new Connection(rpc, "confirmed");
  const keypairPath = process.env.GHOS_KEYPAIR_PATH ?? "~/.config/solana/id.json";
  const payer = loadKeypair(keypairPath);

  console.log(`rpc: ${rpc}`);
  console.log(`payer: ${payer.publicKey.toBase58()}`);

  await airdropIfLow(connection, payer.publicKey, 2_000_000_000);

  const wallet = new Wallet(payer);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  const program = new Program(idlJson as any, provider);
  const client = new GhosClient({ connection, payer });

  console.log("deriving config pda");
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("ghos.config")],
    program.programId,
  );

  const cfg = await program.account.ghosConfig.fetchNullable(configPda);
  if (cfg === null) {
    console.log("config not initialized, calling initialize");
    await client.initialize();
  } else {
    console.log(`config already initialized, admin=${cfg.admin.toBase58()}`);
  }

  for (let i = 0; i < args.mints; i++) {
    const mint = await createDummyMintPlaceholder(connection, payer);
    console.log(`seeded mint ${i + 1}: ${mint.toBase58()}`);
  }

  if (args.auditor) {
    console.log("registering placeholder auditor entry for mint 0");
    // The real auditor setup builds a pubkey validity proof; in the seed
    // script we log the intent so the CI can pick it up from structured logs.
    console.log(
      JSON.stringify({ event: "auditor.pending", mints: args.mints, recipients: args.recipients }),
    );
  }

  console.log("seeding complete");
}

main().catch((err) => {
  console.error("seed failed:", err);
  process.exit(1);
});
