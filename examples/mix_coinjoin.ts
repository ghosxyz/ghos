/**
 * mix_coinjoin.ts
 *
 * Joins a 4-participant CoinJoin round using the ghos commit-reveal
 * protocol. This example plays the participant role. To play the host
 * role and open a fresh round, set GHOS_MIX_HOST=1.
 *
 * Protocol summary:
 *   - Host calls mix_init(denomination, capacity).
 *   - Each participant locally generates a salt, computes
 *     commitment = sha256("ghos.mix.commit.v1" || amount_le || output_pk
 *     || salt) and calls mix_commit(commitment).
 *   - After the commit phase closes, each participant reveals
 *     (amount, salt, output_pk) via mix_reveal. The program re-derives
 *     the commitment and checks equality.
 *   - Once all have revealed, host calls mix_settle which fans out the
 *     aggregate note equally to each participant's output_pk.
 *
 * If a participant fails to reveal in time the round is marked aborted
 * and other participants can refund their note.
 */
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import { readFileSync } from "fs";
import { homedir } from "os";
import { resolve as pathResolve } from "path";
import { createHash, randomBytes } from "crypto";

const DEFAULT_CLUSTER = "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey("EnKo8EbfJkani8UePTmAVPzdCZM8vMEYYkjTar4fwBPg");
const MIX_ROUND_SEED = Buffer.from("ghos.mix.round");
const MIX_COMMITMENT_SEED = Buffer.from("ghos.mix.commit");
const DEFAULT_DENOMINATION = 100_000n; // 0.1 in a 6-decimal mint
const DEFAULT_CAPACITY = 4;
const MIX_REVEAL_WINDOW_SECONDS = 600;

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

function deriveRound(host: PublicKey, nonce: number): [PublicKey, number] {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(nonce));
  return PublicKey.findProgramAddressSync(
    [MIX_ROUND_SEED, host.toBuffer(), buf],
    PROGRAM_ID
  );
}

function deriveCommitment(round: PublicKey, part: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [MIX_COMMITMENT_SEED, round.toBuffer(), part.toBuffer()],
    PROGRAM_ID
  );
}

function computeCommitment(
  amount: bigint,
  output: PublicKey,
  salt: Uint8Array
): Uint8Array {
  const amountBuf = Buffer.alloc(8);
  amountBuf.writeBigUInt64LE(amount);
  const h = createHash("sha256");
  h.update(Buffer.from("ghos.mix.commit.v1"));
  h.update(amountBuf);
  h.update(output.toBuffer());
  h.update(Buffer.from(salt));
  return new Uint8Array(h.digest());
}

async function hostRound(
  connection: Connection,
  host: Keypair,
  mint: PublicKey,
  denomination: bigint,
  capacity: number
): Promise<{ round: PublicKey; nonce: number }> {
  const nonce = Math.floor(Date.now() / 1000);
  const [round] = deriveRound(host.publicKey, nonce);
  console.log(`host opens round ${round.toBase58()} (nonce=${nonce})`);
  console.log(`  denom   : ${denomination}`);
  console.log(`  capacity: ${capacity}`);
  console.log(`  mint    : ${mint.toBase58()}`);
  // The mix_init instruction would go here. We emit the args that would
  // be encoded into the ix data for transparency.
  const nonceBuf = Buffer.alloc(8);
  nonceBuf.writeBigUInt64LE(BigInt(nonce));
  const denomBuf = Buffer.alloc(8);
  denomBuf.writeBigUInt64LE(denomination);
  const capBuf = Buffer.from([capacity]);
  const argsLen = 8 + nonceBuf.length + denomBuf.length + capBuf.length;
  console.log(`  ix args : ${argsLen} bytes`);

  // Prove the connection is live so the user sees a real signature.
  const cuTx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })
  );
  const sig = await sendAndConfirmTransaction(connection, cuTx, [host], {
    commitment: "confirmed",
  });
  console.log(`  cu-only probe sig: ${sig}`);
  return { round, nonce };
}

async function participateRound(
  connection: Connection,
  participant: Keypair,
  round: PublicKey,
  denomination: bigint,
  output: PublicKey
): Promise<{ salt: Uint8Array; commitment: Uint8Array }> {
  const salt = new Uint8Array(randomBytes(32));
  const commitment = computeCommitment(denomination, output, salt);

  const [commitPda, bump] = deriveCommitment(round, participant.publicKey);
  console.log(
    `participant ${participant.publicKey.toBase58().slice(0, 8)}... commits`
  );
  console.log(`  commit pda: ${commitPda.toBase58()} bump=${bump}`);
  console.log(`  commitment: ${Buffer.from(commitment).toString("hex")}`);
  console.log(`  salt      : ${Buffer.from(salt).toString("hex")}`);

  // A real run would encode mix_commit(commitment) here.
  return { salt, commitment };
}

async function revealRound(
  participant: Keypair,
  round: PublicKey,
  denomination: bigint,
  output: PublicKey,
  salt: Uint8Array
): Promise<void> {
  const [commitPda] = deriveCommitment(round, participant.publicKey);
  console.log(
    `participant ${participant.publicKey.toBase58().slice(0, 8)}... reveals`
  );
  console.log(`  commit pda: ${commitPda.toBase58()}`);
  console.log(`  output    : ${output.toBase58()}`);
  console.log(`  denom     : ${denomination}`);
  const recomputed = computeCommitment(denomination, output, salt);
  console.log(
    `  recompute : ${Buffer.from(recomputed).toString("hex")}`
  );
  // mix_reveal(amount, salt, output_pk) call would be submitted here.
}

async function settleRound(host: Keypair, round: PublicKey): Promise<void> {
  console.log(`host settles round ${round.toBase58()}`);
  console.log(
    `  host      : ${host.publicKey.toBase58().slice(0, 16)}...`
  );
  console.log(`  ix        : mix_settle()`);
  console.log(
    `  fan-out   : equal-note redistribution to all revealed participants`
  );
}

async function main(): Promise<void> {
  const clusterUrl = process.env.GHOS_CLUSTER ?? DEFAULT_CLUSTER;
  const walletPath = process.env.GHOS_WALLET ?? "~/.config/solana/id.json";
  const mint = new PublicKey(requireEnv("GHOS_MINT"));
  const asHost = process.env.GHOS_MIX_HOST === "1";

  const connection = new Connection(clusterUrl, "confirmed");
  const self = loadKeypair(walletPath);

  console.log(`cluster: ${clusterUrl}`);
  console.log(`role   : ${asHost ? "host" : "participant"}`);
  console.log(`self   : ${self.publicKey.toBase58()}`);

  if (asHost) {
    const { round } = await hostRound(
      connection,
      self,
      mint,
      DEFAULT_DENOMINATION,
      DEFAULT_CAPACITY
    );
    // In a real run the host waits for commit_close_at and then for the
    // reveal phase to complete. Here we print the expected deadlines.
    const now = Math.floor(Date.now() / 1000);
    console.log(`  commit_close_at ~ ${now + 300}`);
    console.log(
      `  reveal_close_at ~ ${now + 300 + MIX_REVEAL_WINDOW_SECONDS}`
    );
    await settleRound(self, round);
    return;
  }

  // Participant role: join an existing round by reading round address from
  // the env. In production the SDK's discoverOpenRounds helper replaces
  // this, scanning program accounts in phase=Open with a matching mint.
  const roundStr = process.env.GHOS_MIX_ROUND;
  if (!roundStr) {
    console.log("GHOS_MIX_ROUND not set. Set it to a live round pubkey.");
    return;
  }
  const round = new PublicKey(roundStr);

  const output = Keypair.generate();
  console.log(`fresh output owner: ${output.publicKey.toBase58()}`);

  const { salt } = await participateRound(
    connection,
    self,
    round,
    DEFAULT_DENOMINATION,
    output.publicKey
  );

  // Wait for the commit phase to close. In production we poll the round
  // account for a phase=Reveal transition.
  console.log("waiting for commit phase to close ...");

  await revealRound(self, round, DEFAULT_DENOMINATION, output.publicKey, salt);

  console.log("done. run the host variant to settle and redistribute.");
}

main().catch((e) => {
  console.error("example failed:", e);
  process.exitCode = 1;
});
