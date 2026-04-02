/**
 * batch_airdrop.ts
 *
 * Shield-then-transfer to many recipients in batches. Useful for payroll,
 * quadratic-funding distributions, and any scenario where the amounts
 * should be hidden but the recipient set is known up-front.
 *
 * Input: a JSON file at GHOS_AIRDROP_PATH with shape
 *   [{ "recipient": "<pubkey>", "amount": <atomic-bigint-string> }, ...]
 *
 * Example file:
 *   [
 *     { "recipient": "7xKX...Qm", "amount": "1000000" },
 *     { "recipient": "9Kfg...Xr", "amount": "2500000" }
 *   ]
 */
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  ComputeBudgetProgram,
  sendAndConfirmTransaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { readFileSync } from "fs";
import { homedir } from "os";
import { resolve as pathResolve } from "path";

const DEFAULT_CLUSTER = "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey("EnKo8EbfJkani8UePTmAVPzdCZM8vMEYYkjTar4fwBPg");
const MAX_BATCH = 5; // confidential transfers are heavy; 5 per tx is safe

interface AirdropEntry {
  recipient: PublicKey;
  amount: bigint;
}

function expandHome(p: string): string {
  if (p.startsWith("~/")) return pathResolve(homedir(), p.slice(2));
  return pathResolve(p);
}

function loadKeypair(path: string): Keypair {
  const raw = JSON.parse(readFileSync(expandHome(path), "utf-8"));
  return Keypair.fromSecretKey(new Uint8Array(raw));
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var ${name}`);
  return v;
}

function loadAirdropFile(path: string): AirdropEntry[] {
  const raw = JSON.parse(readFileSync(expandHome(path), "utf-8"));
  if (!Array.isArray(raw)) {
    throw new Error(`airdrop file must be an array, got ${typeof raw}`);
  }
  return raw.map((entry, i) => {
    if (typeof entry !== "object" || entry === null) {
      throw new Error(`entry ${i} is not an object`);
    }
    if (typeof entry.recipient !== "string") {
      throw new Error(`entry ${i} has missing recipient`);
    }
    if (typeof entry.amount !== "string") {
      throw new Error(`entry ${i} has missing amount string`);
    }
    const amount = BigInt(entry.amount);
    if (amount <= 0n) {
      throw new Error(`entry ${i} amount must be positive`);
    }
    if (amount % 1_000n !== 0n) {
      throw new Error(
        `entry ${i} amount ${amount} not aligned to dust-free unit 1000`
      );
    }
    return {
      recipient: new PublicKey(entry.recipient),
      amount,
    };
  });
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * Build a single batch transaction. In production each confidential
 * transfer ix requires a proof-context account plus the range/equality
 * proof CPI. Here we emit a single compute-budget prelude plus a marker
 * instruction per entry so the example stays self-contained.
 */
function buildBatchTx(
  connection: Connection,
  sender: Keypair,
  mint: PublicKey,
  entries: AirdropEntry[]
): Transaction {
  const tx = new Transaction();
  tx.add(
    ComputeBudgetProgram.setComputeUnitLimit({
      units: 600_000 + entries.length * 100_000,
    }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10 })
  );

  for (const entry of entries) {
    // Marker transfer of 0 lamports so the transaction structure is valid
    // without any ghos-specific instructions loaded.
    const marker = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: sender.publicKey, isSigner: true, isWritable: true },
        { pubkey: entry.recipient, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
      ],
      data: encodeTransferArgs(entry.amount),
    });
    tx.add(marker);
  }

  return tx;
}

function encodeTransferArgs(amount: bigint): Buffer {
  // Anchor discriminator placeholder + u64 LE amount. Real args include
  // source_ciphertext[64], dest_ciphertext[64], range_proof[672],
  // equality_proof[192], pubkey_validity_proof[64]. Size computed below.
  const discriminator = Buffer.from([
    0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x00, 0x11,
  ]);
  const amountBuf = Buffer.alloc(8);
  amountBuf.writeBigUInt64LE(amount);
  const sourceCt = Buffer.alloc(64);
  const destCt = Buffer.alloc(64);
  const rangeProof = Buffer.alloc(672);
  const equalityProof = Buffer.alloc(192);
  const pubkeyValidity = Buffer.alloc(64);
  return Buffer.concat([
    discriminator,
    amountBuf,
    sourceCt,
    destCt,
    rangeProof,
    equalityProof,
    pubkeyValidity,
  ]);
}

async function main(): Promise<void> {
  const clusterUrl = process.env.GHOS_CLUSTER ?? DEFAULT_CLUSTER;
  const walletPath = process.env.GHOS_WALLET ?? "~/.config/solana/id.json";
  const mint = new PublicKey(requireEnv("GHOS_MINT"));
  const airdropPath = requireEnv("GHOS_AIRDROP_PATH");

  const connection = new Connection(clusterUrl, "confirmed");
  const sender = loadKeypair(walletPath);
  const entries = loadAirdropFile(airdropPath);

  console.log(`cluster   : ${clusterUrl}`);
  console.log(`sender    : ${sender.publicKey.toBase58()}`);
  console.log(`mint      : ${mint.toBase58()}`);
  console.log(`entries   : ${entries.length}`);
  const total = entries.reduce((acc, e) => acc + e.amount, 0n);
  console.log(`total atom: ${total}`);

  const batches = chunk(entries, MAX_BATCH);
  console.log(`batches   : ${batches.length} (max ${MAX_BATCH} per tx)`);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    console.log(`batch ${i + 1}/${batches.length}: ${batch.length} recipients`);
    const tx = buildBatchTx(connection, sender, mint, batch);

    // Each ix byte layout previewed so the operator can see the expected
    // size before submission.
    const ixBytes = tx.instructions.reduce(
      (acc, ix) => acc + (ix.data?.length ?? 0),
      0
    );
    console.log(`  tx ix data total: ${ixBytes} bytes`);
    console.log(`  tx signer count : ${tx.instructions[0]?.keys.length ?? 0}`);

    // Skip real submission unless GHOS_SUBMIT=1 so casual runs do not burn
    // SOL on the marker transaction.
    if (process.env.GHOS_SUBMIT !== "1") {
      console.log("  GHOS_SUBMIT!=1, skipping send");
      continue;
    }

    try {
      const sig = await sendAndConfirmTransaction(connection, tx, [sender], {
        commitment: "confirmed",
      });
      console.log(`  signature: ${sig}`);
    } catch (e) {
      console.error(`  batch ${i + 1} failed: ${(e as Error).message}`);
    }
  }

  console.log("done.");
}

main().catch((e) => {
  console.error("example failed:", e);
  process.exitCode = 1;
});
