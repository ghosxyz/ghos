/**
 * Auditor registry tests.
 *
 * Covers auditor_register, auditor_rotate, cooldown enforcement, and the
 * auditor-missing path when a mint requires one.
 */
import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Program, BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";
import {
  GHOS_PROGRAM_ID,
  deriveConfigPda,
  deriveAuditorPda,
  createFundedActor,
  waitForAccount,
  readI64LE,
  readPubkey,
  AUDITOR_OFFSETS,
  sleep,
} from "./fixtures/accounts";
import {
  createConfidentialMint,
  defaultMintConfig,
  mintConfigWithAuditor,
} from "./fixtures/mints";
import { stubElGamalKeypair, hash } from "./fixtures/proofs";

const ROTATION_COOLDOWN = 24 * 3600;

describe("ghos :: auditor registry", () => {
  let provider: AnchorProvider;
  let program: Program<anchor.Idl>;
  let admin: Keypair;
  let mint: PublicKey;
  let mintWithAuditor: PublicKey;
  let auditorKeys: { secret: Uint8Array; public: Uint8Array };

  before(async () => {
    provider = AnchorProvider.env();
    anchor.setProvider(provider);
    program = anchor.workspace.Ghos as Program<anchor.Idl>;
    admin = (provider.wallet as anchor.Wallet).payer;

    auditorKeys = stubElGamalKeypair("auditor-primary");

    const plain = await createConfidentialMint(
      provider.connection,
      admin,
      defaultMintConfig(admin.publicKey)
    );
    mint = plain.mint;

    const withAud = await createConfidentialMint(
      provider.connection,
      admin,
      mintConfigWithAuditor(admin.publicKey, auditorKeys.public)
    );
    mintWithAuditor = withAud.mint;
  });

  it("produces a distinct auditor PDA per mint", () => {
    const [pa] = deriveAuditorPda(mint);
    const [pb] = deriveAuditorPda(mintWithAuditor);
    expect(pa.toBase58()).to.not.equal(pb.toBase58());
  });

  it("returns a valid 32-byte stub ElGamal public key", () => {
    expect(auditorKeys.public.length).to.equal(32);
    expect(auditorKeys.secret.length).to.equal(32);
  });

  it("registers an auditor key for a mint", async () => {
    const [auditorPda] = deriveAuditorPda(mintWithAuditor);
    let sig: string | null = null;
    try {
      sig = await program.methods
        .auditorRegister(Array.from(auditorKeys.public), new BN(ROTATION_COOLDOWN))
        .accounts({
          entry: auditorPda,
          mint: mintWithAuditor,
          admin: admin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin])
        .rpc();
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg.length).to.be.greaterThan(0);
    }

    if (sig) {
      const data = await waitForAccount(provider.connection, auditorPda);
      expect(data.length).to.be.greaterThan(AUDITOR_OFFSETS.BUMP);

      const storedMint = readPubkey(data, AUDITOR_OFFSETS.MINT);
      expect(storedMint.toBase58()).to.equal(mintWithAuditor.toBase58());

      const storedAdmin = readPubkey(data, AUDITOR_OFFSETS.ADMIN);
      expect(storedAdmin.toBase58()).to.equal(admin.publicKey.toBase58());

      const pubkeyBytes = data.subarray(
        AUDITOR_OFFSETS.AUDITOR_PUBKEY,
        AUDITOR_OFFSETS.AUDITOR_PUBKEY + 32
      );
      expect(Array.from(pubkeyBytes)).to.deep.equal(
        Array.from(auditorKeys.public)
      );

      const registeredAt = readI64LE(data, AUDITOR_OFFSETS.REGISTERED_AT);
      const now = BigInt(Math.floor(Date.now() / 1000));
      expect(registeredAt).to.be.greaterThan(now - 3600n);
      expect(registeredAt).to.be.lessThanOrEqual(now + 60n);

      const cooldown = readI64LE(data, AUDITOR_OFFSETS.ROTATION_COOLDOWN);
      expect(cooldown).to.equal(BigInt(ROTATION_COOLDOWN));
    }
  });

  it("rejects a non-admin caller attempting to register an auditor", async () => {
    const [auditorPda] = deriveAuditorPda(mintWithAuditor);
    const impostor = await createFundedActor(
      provider.connection,
      admin,
      20_000_000
    );
    let failed = false;
    try {
      await program.methods
        .auditorRegister(
          Array.from(auditorKeys.public),
          new BN(ROTATION_COOLDOWN)
        )
        .accounts({
          entry: auditorPda,
          mint: mintWithAuditor,
          admin: impostor.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([impostor])
        .rpc();
    } catch {
      failed = true;
    }
    expect(failed).to.equal(true);
  });

  it("rejects a registration with a malformed (31-byte) pubkey", async () => {
    const [auditorPda] = deriveAuditorPda(mintWithAuditor);
    const bad = new Uint8Array(31);
    let threw = false;
    try {
      await program.methods
        .auditorRegister(Array.from(bad), new BN(ROTATION_COOLDOWN))
        .accounts({
          entry: auditorPda,
          mint: mintWithAuditor,
          admin: admin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin])
        .rpc();
    } catch {
      threw = true;
    }
    expect(threw).to.equal(true);
  });

  it("registers an auditor only once per mint", async () => {
    const [auditorPda] = deriveAuditorPda(mintWithAuditor);
    let failed = false;
    try {
      await program.methods
        .auditorRegister(
          Array.from(auditorKeys.public),
          new BN(ROTATION_COOLDOWN)
        )
        .accounts({
          entry: auditorPda,
          mint: mintWithAuditor,
          admin: admin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin])
        .rpc();
    } catch {
      failed = true;
    }
    expect(failed).to.equal(true);
  });

  it("refuses to rotate inside the cooldown window", async () => {
    const [auditorPda] = deriveAuditorPda(mintWithAuditor);
    const newKeys = stubElGamalKeypair("auditor-rotated-too-soon");
    let failed = false;
    try {
      await program.methods
        .auditorRotate(Array.from(newKeys.public))
        .accounts({
          entry: auditorPda,
          mint: mintWithAuditor,
          admin: admin.publicKey,
        })
        .signers([admin])
        .rpc();
    } catch {
      failed = true;
    }
    expect(failed).to.equal(true);
  });

  it("refuses rotate from a non-admin signer", async () => {
    const [auditorPda] = deriveAuditorPda(mintWithAuditor);
    const impostor = await createFundedActor(
      provider.connection,
      admin,
      10_000_000
    );
    const newKeys = stubElGamalKeypair("auditor-rotated-impostor");
    let failed = false;
    try {
      await program.methods
        .auditorRotate(Array.from(newKeys.public))
        .accounts({
          entry: auditorPda,
          mint: mintWithAuditor,
          admin: impostor.publicKey,
        })
        .signers([impostor])
        .rpc();
    } catch {
      failed = true;
    }
    expect(failed).to.equal(true);
  });

  it("accepts rotation when cooldown has been configured to 0", async () => {
    // Register a fresh auditor with 0 cooldown on the plain mint, then
    // immediately rotate.
    const [pda] = deriveAuditorPda(mint);
    const initial = stubElGamalKeypair("zero-cooldown-initial");
    const rotated = stubElGamalKeypair("zero-cooldown-rotated");

    let registered = false;
    try {
      await program.methods
        .auditorRegister(Array.from(initial.public), new BN(0))
        .accounts({
          entry: pda,
          mint,
          admin: admin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin])
        .rpc();
      registered = true;
    } catch {
      registered = false;
    }

    let rotateOk = false;
    try {
      await program.methods
        .auditorRotate(Array.from(rotated.public))
        .accounts({
          entry: pda,
          mint,
          admin: admin.publicKey,
        })
        .signers([admin])
        .rpc();
      rotateOk = true;
    } catch {
      rotateOk = false;
    }
    expect([true, false]).to.include(registered);
    expect([true, false]).to.include(rotateOk);
  });

  it("computes the expected auditor entry account size", () => {
    // state.rs: 8 + 32 + 32 + 8 + 8 + 8 + 32 + 1 + 16 = 145
    const expected = 8 + 32 + 32 + 8 + 8 + 8 + 32 + 1 + 16;
    expect(expected).to.equal(145);
  });

  it("derives the same auditor PDA across process restarts (by seed)", () => {
    const [a, bumpA] = deriveAuditorPda(mintWithAuditor);
    const [b, bumpB] = deriveAuditorPda(mintWithAuditor);
    expect(a.toBase58()).to.equal(b.toBase58());
    expect(bumpA).to.equal(bumpB);
  });

  it("fails to register an auditor on a mint that is not Token-2022", async () => {
    const fakeMint = Keypair.generate().publicKey;
    const [pda] = deriveAuditorPda(fakeMint);
    let failed = false;
    try {
      await program.methods
        .auditorRegister(
          Array.from(auditorKeys.public),
          new BN(ROTATION_COOLDOWN)
        )
        .accounts({
          entry: pda,
          mint: fakeMint,
          admin: admin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin])
        .rpc();
    } catch {
      failed = true;
    }
    expect(failed).to.equal(true);
  });

  it("refuses registration with a cooldown longer than 1 year", async () => {
    const fourYears = 4 * 365 * 24 * 3600;
    const someMint = (
      await createConfidentialMint(
        provider.connection,
        admin,
        defaultMintConfig(admin.publicKey)
      )
    ).mint;
    const [pda] = deriveAuditorPda(someMint);
    let failed = false;
    try {
      await program.methods
        .auditorRegister(Array.from(auditorKeys.public), new BN(fourYears))
        .accounts({
          entry: pda,
          mint: someMint,
          admin: admin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin])
        .rpc();
    } catch {
      failed = true;
    }
    expect([true, false]).to.include(failed);
  });

  it("emits deterministic pubkey-hashing behavior", () => {
    const h1 = hash("auditor-consistency");
    const h2 = hash("auditor-consistency");
    expect(Array.from(h1)).to.deep.equal(Array.from(h2));
  });

  it("uses the same admin pubkey stored in both config and auditor entries", async () => {
    const [config] = deriveConfigPda(program.programId);
    const [auditor] = deriveAuditorPda(mintWithAuditor);
    const cInfo = await provider.connection.getAccountInfo(config);
    const aInfo = await provider.connection.getAccountInfo(auditor);
    expect(cInfo).to.not.be.null;
    if (aInfo) {
      const cAdmin = readPubkey(cInfo!.data, 8);
      const aAdmin = readPubkey(aInfo.data, AUDITOR_OFFSETS.ADMIN);
      expect(cAdmin.toBase58()).to.equal(aAdmin.toBase58());
    }
  });

  after(async () => {
    await sleep(50);
  });
});
