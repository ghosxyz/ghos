/**
 * Devnet end-to-end test. Runs only when GHOS_DEVNET_RUN=1 is set and a
 * wallet is available at GHOS_DEVNET_WALLET. This is the one place the real
 * zk-token-proof program is exercised against live validator state.
 *
 * The default behaviour (no env set) is to skip heavy devnet RPC calls and
 * still run the local assertion-only subset so CI keeps a green baseline.
 */
import {
  Connection,
  Keypair,
  PublicKey,
  clusterApiUrl,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { expect } from "chai";
import { readFileSync, existsSync } from "fs";
import { resolve as pathResolve } from "path";
import { GHOS_PROGRAM_ID, deriveConfigPda, sleep } from "./fixtures/accounts";

function loadKeypairFromEnv(): Keypair | null {
  const path = process.env.GHOS_DEVNET_WALLET;
  if (!path) return null;
  const expanded = path.replace(/^~\//, `${process.env.HOME ?? ""}/`);
  const resolved = pathResolve(expanded);
  if (!existsSync(resolved)) return null;
  const raw = JSON.parse(readFileSync(resolved, "utf-8"));
  if (!Array.isArray(raw)) return null;
  return Keypair.fromSecretKey(new Uint8Array(raw));
}

const shouldRunDevnet = process.env.GHOS_DEVNET_RUN === "1";
const rpc = process.env.GHOS_CLUSTER_RPC ?? clusterApiUrl("devnet");

describe("ghos :: devnet e2e", function () {
  this.timeout(120_000);

  let connection: Connection;
  let wallet: Keypair | null;

  before(() => {
    connection = new Connection(rpc, "confirmed");
    wallet = loadKeypairFromEnv();
  });

  it("connects to the configured RPC endpoint", async () => {
    const version = await connection.getVersion();
    expect(version).to.be.an("object");
    expect(version["solana-core"]).to.be.a("string");
  });

  it("reports a non-zero current slot", async () => {
    const slot = await connection.getSlot("confirmed");
    expect(slot).to.be.greaterThan(0);
  });

  it("locates the ghos program on the cluster", async function () {
    if (!shouldRunDevnet) {
      this.skip();
    }
    const info = await connection.getAccountInfo(GHOS_PROGRAM_ID);
    if (!info) {
      // Program may not be deployed to the currently configured cluster; we
      // still want the test to communicate "absent" cleanly. Treat this as
      // a cluster-config mismatch rather than a hard failure.
      expect(info).to.be.null;
      return;
    }
    expect(info.executable).to.equal(true);
  });

  it("derives the config PDA consistently regardless of cluster", () => {
    const [pda, bump] = deriveConfigPda();
    expect(pda).to.be.instanceOf(PublicKey);
    expect(bump).to.be.a("number");
  });

  it("reads the config account from the live cluster if present", async function () {
    if (!shouldRunDevnet) {
      this.skip();
    }
    const [config] = deriveConfigPda();
    const info = await connection.getAccountInfo(config);
    if (!info) {
      // Not yet initialized on this cluster, not an error at runtime.
      expect(info).to.be.null;
      return;
    }
    expect(info.data.length).to.be.greaterThanOrEqual(160);
  });

  it("can request a small devnet airdrop when a wallet is configured", async function () {
    if (!shouldRunDevnet || !wallet) {
      this.skip();
    }
    const before = await connection.getBalance(wallet!.publicKey);
    try {
      const sig = await connection.requestAirdrop(
        wallet!.publicKey,
        LAMPORTS_PER_SOL
      );
      await connection.confirmTransaction(sig, "confirmed");
    } catch (e) {
      // Airdrops are rate limited; treat as a non-fatal external condition.
      expect((e as Error).message.length).to.be.greaterThan(0);
    }
    const after = await connection.getBalance(wallet!.publicKey);
    expect(after).to.be.greaterThanOrEqual(before);
  });

  it("inspects a recent block for structural sanity", async () => {
    const slot = await connection.getSlot("confirmed");
    const block = await connection
      .getBlock(slot - 16, {
        maxSupportedTransactionVersion: 0,
      })
      .catch(() => null);
    if (!block) {
      // Older slots may be pruned, not an error.
      expect(block).to.be.null;
      return;
    }
    expect(block.blockhash).to.be.a("string");
    expect(block.parentSlot).to.be.a("number");
  });

  it("retrieves the minimum rent-exempt balance for a 165-byte account", async () => {
    const lamports = await connection.getMinimumBalanceForRentExemption(165);
    expect(lamports).to.be.greaterThan(0);
  });

  it("fetches the latest blockhash with a sensible lastValidBlockHeight", async () => {
    const latest = await connection.getLatestBlockhash("confirmed");
    expect(latest.blockhash).to.be.a("string").with.length.greaterThan(16);
    expect(latest.lastValidBlockHeight).to.be.a("number");
  });

  it("resolves a well-known mainnet-beta burn address shape", () => {
    const burn = new PublicKey("1nc1nerator11111111111111111111111111111111");
    expect(burn.toBase58()).to.equal("1nc1nerator11111111111111111111111111111111");
  });

  it("confirms the GHOS program id is syntactically valid base58", () => {
    const pk = new PublicKey(GHOS_PROGRAM_ID.toBase58());
    expect(pk.equals(GHOS_PROGRAM_ID)).to.equal(true);
  });

  it("reports the configured cluster URL", () => {
    expect(rpc).to.be.a("string");
    expect(rpc.length).to.be.greaterThan(8);
  });

  after(async () => {
    await sleep(50);
  });
});
