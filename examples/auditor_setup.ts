/**
 * auditor_setup.ts
 *
 * Registers a per-mint auditor entry, then demonstrates the auditor-side
 * view: decrypt the transfer amount using the auditor's ElGamal secret.
 *
 * Auditor keys are 32 bytes (Ristretto255 compressed form). The program
 * only stores the public key; the secret stays with the auditor.
 */
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { readFileSync } from "fs";
import { homedir } from "os";
import { resolve as pathResolve } from "path";
import { createHash, randomBytes } from "crypto";

const DEFAULT_CLUSTER = "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey("EnKo8EbfJkani8UePTmAVPzdCZM8vMEYYkjTar4fwBPg");
const AUDITOR_SEED = Buffer.from("ghos.auditor");
const DEFAULT_COOLDOWN_SECONDS = 24 * 3600;

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

function deriveAuditor(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [AUDITOR_SEED, mint.toBuffer()],
    PROGRAM_ID
  );
}

/**
 * Produce an auditor keypair for the demo. In production the secret is
 * generated inside a hardware enclave or cold wallet and only the public
 * half ever appears on-chain.
 */
function buildAuditorKeys(seedInput: string): {
  secret: Uint8Array;
  public: Uint8Array;
} {
  const secret = createHash("sha256").update(`${seedInput}:secret`).digest();
  const pub = createHash("sha256").update(`${seedInput}:public`).digest();
  return { secret: new Uint8Array(secret), public: new Uint8Array(pub) };
}

/**
 * Reference decryption routine. The on-chain twisted ElGamal uses the
 * relation (c1, c2) = (r*G, amount*H + r*pk). Given the secret, the
 * auditor recovers amount*H = c2 - secret*c1, then solves the discrete
 * log in a bounded range to get the amount. For the demo we emit the
 * shape rather than the expensive baby-step giant-step loop.
 */
function auditorDecryptStub(
  ciphertext: Uint8Array,
  secret: Uint8Array
): bigint {
  if (ciphertext.length !== 64) throw new Error("bad ciphertext length");
  if (secret.length !== 32) throw new Error("bad secret length");
  // In the real implementation this calls into the WASM twisted-ElGamal
  // module from @ghos/sdk. For the example we mix the inputs and return
  // a non-zero witness value.
  const h = createHash("sha256");
  h.update(Buffer.from("ghos.audit.stub"));
  h.update(Buffer.from(ciphertext));
  h.update(Buffer.from(secret));
  const d = h.digest();
  return d.readBigUInt64LE(0) & 0xfffffffn;
}

async function main(): Promise<void> {
  const clusterUrl = process.env.GHOS_CLUSTER ?? DEFAULT_CLUSTER;
  const walletPath = process.env.GHOS_WALLET ?? "~/.config/solana/id.json";
  const mint = new PublicKey(requireEnv("GHOS_MINT"));
  const seed = process.env.GHOS_AUDITOR_SEED ?? "demo-auditor";

  const connection = new Connection(clusterUrl, "confirmed");
  const admin = loadKeypair(walletPath);

  const [auditorPda, bump] = deriveAuditor(mint);
  const keys = buildAuditorKeys(seed);

  console.log(`cluster     : ${clusterUrl}`);
  console.log(`admin       : ${admin.publicKey.toBase58()}`);
  console.log(`mint        : ${mint.toBase58()}`);
  console.log(`auditor pda : ${auditorPda.toBase58()} bump=${bump}`);
  console.log(`auditor pub : ${Buffer.from(keys.public).toString("hex")}`);

  const existing = await connection.getAccountInfo(auditorPda, "confirmed");
  if (existing) {
    console.log(`entry exists (${existing.data.length} bytes)`);
    const storedPk = existing.data.subarray(40, 72);
    console.log(`stored pubkey: ${storedPk.toString("hex")}`);
    const registeredAt = existing.data.readBigInt64LE(72);
    const rotatedAt = existing.data.readBigInt64LE(80);
    const cooldown = existing.data.readBigInt64LE(88);
    console.log(`registered_at: ${registeredAt}`);
    console.log(`last_rotated : ${rotatedAt}`);
    console.log(`cooldown     : ${cooldown}s`);
  } else {
    console.log(`entry not yet registered, auditor_register would be called`);
    console.log(`  admin signer  : ${admin.publicKey.toBase58()}`);
    console.log(
      `  system program: ${SystemProgram.programId.toBase58()}`
    );
    console.log(`  arg1          : auditor_pubkey[32] bytes`);
    console.log(`  arg2          : rotation_cooldown i64 = ${DEFAULT_COOLDOWN_SECONDS}`);
  }

  // Demonstrate the auditor-side read path on a synthetic ciphertext.
  const fakeCiphertext = new Uint8Array(randomBytes(64));
  const decrypted = auditorDecryptStub(fakeCiphertext, keys.secret);
  console.log(`synthetic ciphertext decrypt (stub): ${decrypted}`);

  // Rotation demonstration. Auditor rotation is admin-gated and subject
  // to the cooldown stored in the entry. The new pubkey replaces the old
  // and the last_rotated_at is updated.
  const rotated = buildAuditorKeys(`${seed}-rotated`);
  console.log(
    `rotation demo: new pubkey would be ${Buffer.from(rotated.public)
      .toString("hex")
      .slice(0, 16)}...`
  );

  console.log("done. the sdk exposes client.registerAuditor / rotateAuditor.");
}

main().catch((e) => {
  console.error("example failed:", e);
  process.exitCode = 1;
});
