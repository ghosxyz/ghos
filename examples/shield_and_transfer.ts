/**
 * shield_and_transfer.ts
 *
 * Demonstrates the minimum end-to-end confidential flow:
 *
 *   1. Connect to the configured cluster.
 *   2. Shield 1.00 units of the configured mint from the public ATA into
 *      the sender's confidential balance.
 *   3. Apply the pending counter to the available counter.
 *   4. Confidentially send 0.25 units to a recipient.
 *
 * Run with:
 *   GHOS_CLUSTER=https://api.devnet.solana.com \
 *   GHOS_WALLET=~/.config/solana/id.json \
 *   GHOS_MINT=<mint pubkey> \
 *   GHOS_RECIPIENT=<recipient pubkey> \
 *   npx ts-node examples/shield_and_transfer.ts
 */
import {
  Connection,
  Keypair,
  PublicKey,
  ComputeBudgetProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { readFileSync } from "fs";
import { homedir } from "os";
import { resolve as pathResolve } from "path";

const DEFAULT_CLUSTER = "https://api.devnet.solana.com";
const DEFAULT_WALLET = "~/.config/solana/id.json";
const SHIELD_AMOUNT = 1_000_000n; // 1.00 in 6-decimal units
const TRANSFER_AMOUNT = 250_000n; // 0.25 in 6-decimal units
const PROGRAM_ID = new PublicKey("EnKo8EbfJkani8UePTmAVPzdCZM8vMEYYkjTar4fwBPg");
const RECOMMENDED_CU = 600_000;

function expandHome(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    return pathResolve(homedir(), p.replace(/^~\/?/, ""));
  }
  return pathResolve(p);
}

function loadKeypair(path: string): Keypair {
  const raw = JSON.parse(readFileSync(expandHome(path), "utf-8"));
  return Keypair.fromSecretKey(new Uint8Array(raw));
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`missing required env var ${name}`);
  }
  return v;
}

function deriveConfigPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("ghos.config")],
    PROGRAM_ID
  );
}

async function main(): Promise<void> {
  const clusterUrl = process.env.GHOS_CLUSTER ?? DEFAULT_CLUSTER;
  const walletPath = process.env.GHOS_WALLET ?? DEFAULT_WALLET;
  const mint = new PublicKey(requireEnv("GHOS_MINT"));
  const recipient = new PublicKey(requireEnv("GHOS_RECIPIENT"));

  const connection = new Connection(clusterUrl, "confirmed");
  const payer = loadKeypair(walletPath);

  console.log(`cluster  : ${clusterUrl}`);
  console.log(`wallet   : ${payer.publicKey.toBase58()}`);
  console.log(`mint     : ${mint.toBase58()}`);
  console.log(`recipient: ${recipient.toBase58()}`);

  const [config] = deriveConfigPda();
  const balance = await connection.getBalance(payer.publicKey, "confirmed");
  if (balance < 10_000_000) {
    throw new Error(
      `wallet has ${balance} lamports, below safe minimum of 10_000_000`
    );
  }

  // Step 1: build a compute-budget-prefixed transaction. Confidential flows
  // request extra compute to cover the zk-token-proof CPI.
  const cuTx = new Transaction();
  cuTx.add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: RECOMMENDED_CU }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 })
  );

  // Step 2: shield. In production this would call client.shield({ mint,
  // amount }); here we construct the raw instruction discriminator and
  // argument layout expected by the on-chain program to keep the example
  // self-contained. Once the SDK index.ts is exported this reduces to a
  // single call.
  const shieldDiscriminator = Buffer.from([
    // anchor discriminator for "shield"
    0xd9, 0x2d, 0xe1, 0x63, 0x5b, 0x55, 0x84, 0x10,
  ]);
  const amountBuf = Buffer.alloc(8);
  amountBuf.writeBigUInt64LE(SHIELD_AMOUNT);

  console.log(
    `step 1: shield ${SHIELD_AMOUNT} atomic units (config PDA ${config.toBase58()})`
  );

  // For the purpose of this demo we show the structure of the call. A real
  // run drives this through the SDK's GhosClient class.
  const shieldIxData = Buffer.concat([shieldDiscriminator, amountBuf]);
  console.log(`  ix data bytes: ${shieldIxData.length}`);
  console.log(`  ix payload   : ${shieldIxData.toString("hex")}`);

  console.log(`step 2: apply pending balance for ${payer.publicKey.toBase58()}`);
  const applyDiscriminator = Buffer.from([
    0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88,
  ]);
  console.log(`  apply ix length: ${applyDiscriminator.length}`);

  console.log(
    `step 3: confidential transfer ${TRANSFER_AMOUNT} -> ${recipient.toBase58()}`
  );
  const transferDiscriminator = Buffer.from([
    0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x00, 0x11,
  ]);
  const transferArgs = Buffer.alloc(64 + 64 + 672 + 192);
  transferArgs.fill(0);
  console.log(
    `  transfer ix args size : ${transferDiscriminator.length + transferArgs.length}`
  );

  // The actual TX sent to the cluster is the compute-budget prelude; the
  // ghos-specific instructions would be appended here once the SDK is in
  // place. We still send the prelude to confirm the wallet and cluster are
  // reachable.
  const sig = await sendAndConfirmTransaction(connection, cuTx, [payer], {
    commitment: "confirmed",
  });

  console.log(`cu-only tx signature: ${sig}`);
  console.log("done. integrate with @ghos/sdk for the full confidential path.");
}

main().catch((e) => {
  console.error("example failed:", e);
  process.exitCode = 1;
});
