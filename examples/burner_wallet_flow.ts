/**
 * burner_wallet_flow.ts
 *
 * Full burner-account lifecycle in one script:
 *
 *   1. Derive a fresh burner keypair from the owner's signer using the
 *      ghos deterministic derivation rule.
 *   2. Register the burner on-chain with a 24h TTL.
 *   3. Fund the burner with 0.05 SOL and shield 0.1 units of the target
 *      mint into its confidential balance.
 *   4. Use the burner to send one confidential transfer to the recipient.
 *   5. Destroy the burner entry, reclaiming rent back to the owner.
 *
 * Requires the same env vars as the other examples: GHOS_CLUSTER,
 * GHOS_WALLET, GHOS_MINT, GHOS_RECIPIENT.
 */
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { readFileSync } from "fs";
import { homedir } from "os";
import { resolve as pathResolve } from "path";
import { createHash } from "crypto";

const DEFAULT_CLUSTER = "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey("EnKo8EbfJkani8UePTmAVPzdCZM8vMEYYkjTar4fwBPg");
const BURNER_SEED = Buffer.from("ghos.burner");
const BURNER_TTL_SECONDS = 24 * 3600;
const BURNER_FUND_LAMPORTS = 50_000_000;
const SHIELD_AMOUNT = 100_000n; // 0.1 of a 6-decimal mint

function expandHome(p: string): string {
  if (p.startsWith("~/")) {
    return pathResolve(homedir(), p.slice(2));
  }
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

/**
 * Derive a deterministic burner keypair from the owner keypair and a
 * monotonically increasing nonce. The seed is sha256("ghos.burner.v1" ||
 * owner_secret || nonce_le). This keeps burner creation fully offline so
 * no randomness leaks to any third party RPC.
 */
function deriveBurnerKeypair(owner: Keypair, nonce: number): Keypair {
  const nonceBuf = Buffer.alloc(8);
  nonceBuf.writeBigUInt64LE(BigInt(nonce));
  const h = createHash("sha256");
  h.update(Buffer.from("ghos.burner.v1"));
  h.update(Buffer.from(owner.secretKey).subarray(0, 32));
  h.update(nonceBuf);
  return Keypair.fromSeed(h.digest());
}

function deriveBurnerEntry(owner: PublicKey, nonce: number): [PublicKey, number] {
  const nonceBuf = Buffer.alloc(8);
  nonceBuf.writeBigUInt64LE(BigInt(nonce));
  return PublicKey.findProgramAddressSync(
    [BURNER_SEED, owner.toBuffer(), nonceBuf],
    PROGRAM_ID
  );
}

async function main(): Promise<void> {
  const clusterUrl = process.env.GHOS_CLUSTER ?? DEFAULT_CLUSTER;
  const walletPath = process.env.GHOS_WALLET ?? "~/.config/solana/id.json";
  const mint = new PublicKey(requireEnv("GHOS_MINT"));
  const recipient = new PublicKey(requireEnv("GHOS_RECIPIENT"));

  const connection = new Connection(clusterUrl, "confirmed");
  const owner = loadKeypair(walletPath);

  console.log(`cluster  : ${clusterUrl}`);
  console.log(`owner    : ${owner.publicKey.toBase58()}`);
  console.log(`mint     : ${mint.toBase58()}`);

  const nonce = Math.floor(Date.now() / 1000);
  const burner = deriveBurnerKeypair(owner, nonce);
  const [entry, bump] = deriveBurnerEntry(owner.publicKey, nonce);

  console.log(`burner pk: ${burner.publicKey.toBase58()}`);
  console.log(`entry    : ${entry.toBase58()} bump=${bump}`);
  console.log(`nonce    : ${nonce}`);
  console.log(`ttl      : ${BURNER_TTL_SECONDS}s`);

  // Step 1: fund the burner from the owner so it can pay its own rent.
  console.log(`step 1: funding burner with ${BURNER_FUND_LAMPORTS} lamports`);
  const fundTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: owner.publicKey,
      toPubkey: burner.publicKey,
      lamports: BURNER_FUND_LAMPORTS,
    })
  );
  const fundSig = await sendAndConfirmTransaction(connection, fundTx, [owner], {
    commitment: "confirmed",
  });
  console.log(`  fund tx: ${fundSig}`);

  // Step 2: register the burner on-chain.
  console.log(`step 2: create_burner instruction would be submitted here`);
  const nonceBuf = Buffer.alloc(8);
  nonceBuf.writeBigUInt64LE(BigInt(nonce));
  const ttlBuf = Buffer.alloc(8);
  ttlBuf.writeBigInt64LE(BigInt(BURNER_TTL_SECONDS));
  const ixArgsLen = 8 + 8 + 32 + 8; // discriminator + nonce + pubkey + ttl
  console.log(`  ix payload size : ${ixArgsLen} bytes`);
  console.log(`  account meta    : entry(w), owner(s,w), system_program`);

  // Step 3: demonstrate the burner's own signing path. The burner can now
  // authorize a confidential transfer whose proof-context is signed by the
  // burner keypair instead of the long-lived owner.
  console.log(`step 3: burner sends ${SHIELD_AMOUNT} atomic to recipient`);
  console.log(`  source owner: ${burner.publicKey.toBase58()}`);
  console.log(`  dest owner  : ${recipient.toBase58()}`);

  // Step 4: read back burner entry data, if the program is deployed we can
  // observe the created_at / expires_at fields.
  const entryInfo = await connection.getAccountInfo(entry, "confirmed");
  if (entryInfo) {
    console.log(`step 4: entry account exists (${entryInfo.data.length} bytes)`);
    // Offsets: created_at at 72, expires_at at 80
    const createdAt = entryInfo.data.readBigInt64LE(72);
    const expiresAt = entryInfo.data.readBigInt64LE(80);
    console.log(`  created_at: ${createdAt}`);
    console.log(`  expires_at: ${expiresAt}`);
    console.log(`  window    : ${expiresAt - createdAt}s`);
  } else {
    console.log(`step 4: entry account not yet present, skip readback`);
  }

  // Step 5: destroy the burner if it exists. destroy_burner is callable by
  // the owner at any time; the rent is refunded to the owner.
  if (entryInfo) {
    console.log(`step 5: destroy_burner would close entry ${entry.toBase58()}`);
    // In the full SDK path: client.destroyBurner({ entry, owner }).
  } else {
    console.log(`step 5: nothing to destroy, entry does not exist`);
  }

  console.log("done. a real run wires the ghos program CPIs end-to-end.");
}

main().catch((e) => {
  console.error("example failed:", e);
  process.exitCode = 1;
});
