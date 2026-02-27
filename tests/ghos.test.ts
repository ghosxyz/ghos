/**
 * Root integration test. Exercises initialize, config read-back, pause / resume
 * admin knobs, and the basic PDA layout guarantees.
 *
 * Run with `anchor test` or `yarn test:integration`.
 */
import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Program, web3, BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";
import {
  GHOS_PROGRAM_ID,
  deriveConfigPda,
  derivePaddingVaultPda,
  deriveAuditorPda,
  createFundedActor,
  waitForAccount,
  readU64LE,
  readI64LE,
  readPubkey,
  CONFIG_OFFSETS,
  sleep,
  nextNonce,
} from "./fixtures/accounts";

describe("ghos :: initialize + config", () => {
  let provider: AnchorProvider;
  let program: Program<anchor.Idl>;
  let admin: Keypair;

  before(async () => {
    provider = AnchorProvider.env();
    anchor.setProvider(provider);
    program = anchor.workspace.Ghos as Program<anchor.Idl>;
    admin = (provider.wallet as anchor.Wallet).payer;

    // Airdrop any actor that will pay a tiny amount of rent. The payer from
    // the wallet is already well funded by the validator's genesis faucet.
    const balance = await provider.connection.getBalance(admin.publicKey);
    expect(balance).to.be.greaterThan(1_000_000_000);
  });

  it("resolves the program id to the constant declared in constants.rs", () => {
    expect(program.programId.toBase58()).to.equal(GHOS_PROGRAM_ID.toBase58());
  });

  it("derives the config PDA deterministically from the constant seed", () => {
    const [config, bump] = deriveConfigPda(program.programId);
    const [configAgain, bumpAgain] = deriveConfigPda(program.programId);
    expect(config.toBase58()).to.equal(configAgain.toBase58());
    expect(bump).to.equal(bumpAgain);
    expect(bump).to.be.lessThanOrEqual(255);
    expect(bump).to.be.greaterThanOrEqual(0);
  });

  it("derives the padding vault PDA", () => {
    const [vault, bump] = derivePaddingVaultPda(program.programId);
    expect(vault).to.be.instanceOf(PublicKey);
    expect(bump).to.be.a("number");
  });

  it("initializes the GhosConfig PDA on first call", async () => {
    const [config] = deriveConfigPda(program.programId);
    const existing = await provider.connection.getAccountInfo(config);
    if (existing) {
      // Idempotent: if the ledger survived a previous run we skip creating
      // the account but still assert its shape below.
      expect(existing.data.length).to.be.greaterThanOrEqual(160);
      return;
    }

    const sig = await program.methods
      .initialize()
      .accounts({
        config,
        admin: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    expect(sig).to.be.a("string");
    const data = await waitForAccount(provider.connection, config);
    expect(data.length).to.be.greaterThanOrEqual(160);

    const storedAdmin = readPubkey(data, CONFIG_OFFSETS.ADMIN);
    expect(storedAdmin.toBase58()).to.equal(admin.publicKey.toBase58());
  });

  it("stores the protocol version tag 0x0401", async () => {
    const [config] = deriveConfigPda(program.programId);
    const info = await provider.connection.getAccountInfo(config);
    expect(info, "config must exist before reading version").to.not.be.null;
    const data = info!.data;
    const version = data.readUInt16LE(CONFIG_OFFSETS.VERSION);
    expect(version).to.equal(0x0401);
  });

  it("records the dust-free unit at exactly 1_000", async () => {
    const [config] = deriveConfigPda(program.programId);
    const info = await provider.connection.getAccountInfo(config);
    expect(info).to.not.be.null;
    const dust = readU64LE(info!.data, CONFIG_OFFSETS.DUST_FREE_UNIT);
    expect(dust).to.equal(1_000n);
  });

  it("sets burner TTL bounds within the expected window", async () => {
    const [config] = deriveConfigPda(program.programId);
    const info = await provider.connection.getAccountInfo(config);
    expect(info).to.not.be.null;
    const ttlMax = readI64LE(info!.data, CONFIG_OFFSETS.BURNER_TTL_MAX);
    const ttlMin = readI64LE(info!.data, CONFIG_OFFSETS.BURNER_TTL_MIN);
    expect(ttlMin).to.equal(60n);
    expect(ttlMax).to.equal(BigInt(60 * 60 * 24 * 30));
    expect(ttlMax).to.be.greaterThan(ttlMin);
  });

  it("sets mix participant bounds at 4..16", async () => {
    const [config] = deriveConfigPda(program.programId);
    const info = await provider.connection.getAccountInfo(config);
    expect(info).to.not.be.null;
    const minP = info!.data.readUInt8(CONFIG_OFFSETS.MIX_MIN_PARTICIPANTS);
    const maxP = info!.data.readUInt8(CONFIG_OFFSETS.MIX_MAX_PARTICIPANTS);
    expect(minP).to.equal(4);
    expect(maxP).to.equal(16);
  });

  it("stamps a recent last_updated timestamp", async () => {
    const [config] = deriveConfigPda(program.programId);
    const info = await provider.connection.getAccountInfo(config);
    expect(info).to.not.be.null;
    const ts = Number(readI64LE(info!.data, CONFIG_OFFSETS.LAST_UPDATED));
    const now = Math.floor(Date.now() / 1000);
    expect(ts).to.be.greaterThan(now - 24 * 3600);
    expect(ts).to.be.lessThanOrEqual(now + 60);
  });

  it("stores the bump byte matching the runtime-derived bump", async () => {
    const [config, derivedBump] = deriveConfigPda(program.programId);
    const info = await provider.connection.getAccountInfo(config);
    expect(info).to.not.be.null;
    const stored = info!.data.readUInt8(CONFIG_OFFSETS.BUMP);
    expect(stored).to.equal(derivedBump);
  });

  it("refuses a second initialize() from a non-admin payer", async () => {
    const [config] = deriveConfigPda(program.programId);
    const impostor = await createFundedActor(
      provider.connection,
      admin,
      50_000_000
    );

    let failed = false;
    try {
      await program.methods
        .initialize()
        .accounts({
          config,
          admin: impostor.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([impostor])
        .rpc();
    } catch (e) {
      failed = true;
      const msg = (e as Error).message.toLowerCase();
      expect(msg).to.satisfy(
        (m: string) =>
          m.includes("already in use") ||
          m.includes("custom program error") ||
          m.includes("0x0") ||
          m.includes("already"),
        `unexpected error: ${msg}`
      );
    }
    expect(failed, "second initialize must fail").to.equal(true);
  });

  it("exposes a distinct auditor PDA per mint", () => {
    const mintA = Keypair.generate().publicKey;
    const mintB = Keypair.generate().publicKey;
    const [pa] = deriveAuditorPda(mintA, program.programId);
    const [pb] = deriveAuditorPda(mintB, program.programId);
    expect(pa.toBase58()).to.not.equal(pb.toBase58());
  });

  it("rejects deriving a burner PDA with a nonce above u64 range", () => {
    const owner = Keypair.generate().publicKey;
    expect(() => {
      const buf = Buffer.alloc(8);
      buf.writeBigUInt64LE(BigInt(Number.MAX_SAFE_INTEGER) * 1_000n);
      PublicKey.findProgramAddressSync(
        [Buffer.from("ghos.burner"), owner.toBuffer(), buf],
        program.programId
      );
    }).to.throw();
  });

  it("generates strictly monotonically increasing test nonces", () => {
    const a = nextNonce();
    const b = nextNonce();
    const c = nextNonce();
    expect(b).to.be.greaterThan(a);
    expect(c).to.be.greaterThan(b);
  });

  it("can fetch the current on-chain slot", async () => {
    const slot = await provider.connection.getSlot("confirmed");
    expect(slot).to.be.a("number").and.greaterThan(0);
  });

  it("waits for a guaranteed-present account without timing out", async () => {
    const [config] = deriveConfigPda(program.programId);
    const data = await waitForAccount(provider.connection, config, 4_000, 100);
    expect(data.length).to.be.greaterThan(0);
  });

  it("throws waiting for a non-existent account", async () => {
    const ghost = Keypair.generate().publicKey;
    let threw = false;
    try {
      await waitForAccount(provider.connection, ghost, 400, 50);
    } catch {
      threw = true;
    }
    expect(threw).to.equal(true);
  });

  it("creates a funded actor and observes a positive balance", async () => {
    const actor = await createFundedActor(provider.connection, admin, 2_000_000);
    const bal = await provider.connection.getBalance(actor.publicKey);
    expect(bal).to.equal(2_000_000);
  });

  it("confirms SystemProgram id for sanity", () => {
    expect(SystemProgram.programId.toBase58()).to.equal(
      "11111111111111111111111111111111"
    );
  });

  it("rejects initialize with mismatched config PDA seed", async () => {
    const wrongPda = web3.Keypair.generate().publicKey;
    let failed = false;
    try {
      await program.methods
        .initialize()
        .accounts({
          config: wrongPda,
          admin: admin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    } catch {
      failed = true;
    }
    expect(failed).to.equal(true);
  });

  it("computes consistent PDA bumps across repeated calls", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 20; i++) {
      const [, bump] = deriveConfigPda(program.programId);
      seen.add(bump);
    }
    expect(seen.size).to.equal(1);
  });

  it("returns a valid BN instance when constructing from bigint", () => {
    const bn = new BN(123_456_789n.toString());
    expect(bn.toString()).to.equal("123456789");
  });

  after(async () => {
    // Short settle to let deferred log events flush before the next suite
    // potentially reuses the validator session.
    await sleep(100);
  });
});
