import { Keypair, PublicKey } from "@solana/web3.js";
import {
  buildApplyPendingInstruction,
  buildAuditorRegisterInstruction,
  buildAuditorRotateInstruction,
  buildConfidentialTransferInstruction,
  buildConfigUpdateInstruction,
  buildCreateBurnerInstruction,
  buildDestroyBurnerInstruction,
  buildInitializeInstruction,
  buildMixCommitInstruction,
  buildMixInitInstruction,
  buildMixRevealInstruction,
  buildMixSettleInstruction,
  buildShieldInstruction,
  buildWithdrawInstruction,
  discriminatorFor
} from "../index";
import { AUDITOR_PUBKEY_LEN, GHOS_PROGRAM_ID } from "../constants";
import { deriveBurnerPda, deriveMixRoundPda } from "../pdas";

const TEST_MINT = new PublicKey("So11111111111111111111111111111111111111112");

describe("instruction builders", () => {
  test("discriminatorFor returns 8 bytes for a known ix", () => {
    const d = discriminatorFor("initialize");
    expect(d.length).toBe(8);
  });

  test("discriminatorFor throws for an unknown ix", () => {
    expect(() => discriminatorFor("bogus")).toThrow();
  });

  test("initialize builder produces 3 keys and correct programId", () => {
    const admin = Keypair.generate();
    const ix = buildInitializeInstruction({ admin: admin.publicKey });
    expect(ix.keys.length).toBe(3);
    expect(ix.programId.equals(GHOS_PROGRAM_ID)).toBe(true);
    expect(ix.data.length).toBeGreaterThanOrEqual(8);
  });

  test("shield builder packs amount into payload", () => {
    const owner = Keypair.generate();
    const ata = Keypair.generate().publicKey;
    const conf = Keypair.generate().publicKey;
    const ix = buildShieldInstruction({
      owner: owner.publicKey,
      mint: TEST_MINT,
      sourceAta: ata,
      destinationConfidentialAccount: conf,
      amount: 5000n
    });
    expect(ix.keys.length).toBe(8);
    expect(ix.data.length).toBe(8 + 8);
  });

  test("confidentialTransfer builder includes auditor slot", () => {
    const owner = Keypair.generate();
    const source = Keypair.generate().publicKey;
    const dest = Keypair.generate().publicKey;
    const destOwner = Keypair.generate().publicKey;
    const rangeCtx = Keypair.generate().publicKey;
    const eqCtx = Keypair.generate().publicKey;
    const ct = { c1: new Uint8Array(32), c2: new Uint8Array(32) };
    const ix = buildConfidentialTransferInstruction({
      owner: owner.publicKey,
      mint: TEST_MINT,
      sourceAccount: source,
      destinationAccount: dest,
      destinationOwner: destOwner,
      rangeProofContext: rangeCtx,
      equalityProofContext: eqCtx,
      proofRangeHandle: 1,
      proofEqualityHandle: 2,
      sourceCiphertext: ct,
      destCiphertext: ct
    });
    expect(ix.keys.length).toBe(11);
  });

  test("applyPending builder has no args in payload", () => {
    const owner = Keypair.generate();
    const conf = Keypair.generate().publicKey;
    const ix = buildApplyPendingInstruction({
      owner: owner.publicKey,
      mint: TEST_MINT,
      confidentialAccount: conf
    });
    expect(ix.data.length).toBe(8);
  });

  test("withdraw builder packs amount and bool", () => {
    const owner = Keypair.generate();
    const source = Keypair.generate().publicKey;
    const destAta = Keypair.generate().publicKey;
    const ix = buildWithdrawInstruction({
      owner: owner.publicKey,
      mint: TEST_MINT,
      sourceAccount: source,
      destinationAta: destAta,
      amount: 1000n,
      requireAuditor: true
    });
    expect(ix.data.length).toBe(8 + 8 + 1);
  });

  test("createBurner derives PDA key in the account set", () => {
    const owner = Keypair.generate();
    const burnerPubkey = Keypair.generate().publicKey;
    const ix = buildCreateBurnerInstruction({
      owner: owner.publicKey,
      burnerPubkey,
      nonce: 1n,
      ttlSeconds: 3600
    });
    const derived = deriveBurnerPda(owner.publicKey, 1n).address;
    const hasDerived = ix.keys.some((k) => k.pubkey.equals(derived));
    expect(hasDerived).toBe(true);
  });

  test("destroyBurner only lists owner + burner entry", () => {
    const owner = Keypair.generate();
    const entry = Keypair.generate().publicKey;
    const ix = buildDestroyBurnerInstruction({
      owner: owner.publicKey,
      burnerEntry: entry
    });
    expect(ix.keys.length).toBe(2);
  });

  test("mixInit encodes capacity, denomination, nonce", () => {
    const host = Keypair.generate();
    const ix = buildMixInitInstruction({
      host: host.publicKey,
      mint: TEST_MINT,
      roundNonce: 7n,
      denomination: 1000n,
      capacity: 4,
      commitWindowSeconds: 60
    });
    const round = deriveMixRoundPda(host.publicKey, TEST_MINT, 7n).address;
    expect(ix.keys.some((k) => k.pubkey.equals(round))).toBe(true);
  });

  test("mixCommit rejects wrong-length commitment", () => {
    const participant = Keypair.generate();
    const round = Keypair.generate().publicKey;
    expect(() =>
      buildMixCommitInstruction({
        participant: participant.publicKey,
        round,
        commitment: new Uint8Array(10),
        index: 0
      })
    ).toThrow();
  });

  test("mixReveal requires 32-byte signal and salt", () => {
    const participant = Keypair.generate();
    const round = Keypair.generate().publicKey;
    expect(() =>
      buildMixRevealInstruction({
        participant: participant.publicKey,
        round,
        revealSignal: new Uint8Array(10),
        salt: new Uint8Array(32)
      })
    ).toThrow();
  });

  test("mixSettle encodes a vec<u8> length prefix", () => {
    const host = Keypair.generate();
    const round = Keypair.generate().publicKey;
    const ix = buildMixSettleInstruction({
      host: host.publicKey,
      round,
      participantIndices: [0, 1, 2, 3]
    });
    expect(ix.data.length).toBeGreaterThan(12);
  });

  test("auditorRegister enforces pubkey length", () => {
    const admin = Keypair.generate();
    expect(() =>
      buildAuditorRegisterInstruction({
        admin: admin.publicKey,
        mint: TEST_MINT,
        auditorPubkey: new Uint8Array(10),
        rotationCooldownSeconds: 3600
      })
    ).toThrow();
    const okIx = buildAuditorRegisterInstruction({
      admin: admin.publicKey,
      mint: TEST_MINT,
      auditorPubkey: new Uint8Array(AUDITOR_PUBKEY_LEN),
      rotationCooldownSeconds: 3600
    });
    expect(okIx.keys.length).toBeGreaterThanOrEqual(4);
  });

  test("auditorRotate enforces new pubkey length", () => {
    const admin = Keypair.generate();
    expect(() =>
      buildAuditorRotateInstruction({
        admin: admin.publicKey,
        mint: TEST_MINT,
        newAuditorPubkey: new Uint8Array(10)
      })
    ).toThrow();
  });

  test("configUpdate can target the paused field", () => {
    const admin = Keypair.generate();
    const ix = buildConfigUpdateInstruction({
      admin: admin.publicKey,
      field: "paused",
      boolValue: true
    });
    expect(ix.keys.length).toBe(2);
  });
});
