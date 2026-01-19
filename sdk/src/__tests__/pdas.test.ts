import { PublicKey } from "@solana/web3.js";
import {
  deriveAuditorPda,
  deriveBurnerPda,
  deriveConfigPda,
  deriveMixCommitmentPda,
  deriveMixRoundPda,
  deriveOwnerMintBundle,
  derivePaddingVaultPda,
  findPda,
  matchesPda,
  pdaToPlain,
  requireOnCurve,
  toLeByte,
  toLeBytes16,
  toLeBytes64
} from "../pdas";
import { GHOS_PROGRAM_ID } from "../constants";

const TEST_OWNER = new PublicKey("11111111111111111111111111111112");
const TEST_MINT = new PublicKey("So11111111111111111111111111111111111111112");

describe("pda derivation helpers", () => {
  test("deriveConfigPda returns a bump-annotated result", () => {
    const r = deriveConfigPda();
    expect(r.address).toBeInstanceOf(PublicKey);
    expect(typeof r.bump).toBe("number");
    expect(r.bump).toBeGreaterThanOrEqual(0);
    expect(r.bump).toBeLessThanOrEqual(255);
  });

  test("deriveBurnerPda returns distinct addresses per nonce", () => {
    const a = deriveBurnerPda(TEST_OWNER, 1n);
    const b = deriveBurnerPda(TEST_OWNER, 2n);
    expect(a.address.toBase58()).not.toEqual(b.address.toBase58());
  });

  test("deriveMixRoundPda combines host, mint, nonce deterministically", () => {
    const a = deriveMixRoundPda(TEST_OWNER, TEST_MINT, 7n);
    const b = deriveMixRoundPda(TEST_OWNER, TEST_MINT, 7n);
    expect(a.address.toBase58()).toEqual(b.address.toBase58());
  });

  test("deriveMixCommitmentPda binds (round, participant)", () => {
    const round = deriveMixRoundPda(TEST_OWNER, TEST_MINT, 1n).address;
    const a = deriveMixCommitmentPda(round, TEST_OWNER);
    const b = deriveMixCommitmentPda(round, TEST_MINT);
    expect(a.address.toBase58()).not.toEqual(b.address.toBase58());
  });

  test("deriveAuditorPda is stable and derived per mint", () => {
    const a = deriveAuditorPda(TEST_MINT);
    const b = deriveAuditorPda(TEST_MINT);
    expect(a.address.equals(b.address)).toBe(true);
  });

  test("derivePaddingVaultPda produces a PublicKey under the program id", () => {
    const r = derivePaddingVaultPda();
    expect(r.address).toBeInstanceOf(PublicKey);
  });

  test("toLeBytes64 encodes bigint little-endian 8 bytes", () => {
    const out = toLeBytes64(0x0102030405060708n);
    expect(out.length).toBe(8);
    expect(out[0]).toBe(0x08);
    expect(out[7]).toBe(0x01);
  });

  test("toLeBytes16 / toLeByte return correct widths", () => {
    expect(toLeBytes16(0x1234).length).toBe(2);
    expect(toLeByte(0xab).length).toBe(1);
    expect(toLeByte(0xab)[0]).toBe(0xab);
  });

  test("findPda with custom seeds produces a valid address", () => {
    const r = findPda([Buffer.from("ghos.test.seed")], GHOS_PROGRAM_ID);
    expect(r.address).toBeInstanceOf(PublicKey);
  });

  test("matchesPda recognizes a valid PDA and returns the bump", () => {
    const config = deriveConfigPda();
    const bump = matchesPda(config.address, [Buffer.from("ghos.config")]);
    expect(bump).toBe(config.bump);
  });

  test("matchesPda returns null when address does not match", () => {
    const rand = PublicKey.unique();
    const res = matchesPda(rand, [Buffer.from("ghos.config")]);
    expect(res).toBeNull();
  });

  test("deriveOwnerMintBundle exposes all related PDAs", () => {
    const bundle = deriveOwnerMintBundle(TEST_OWNER, TEST_MINT);
    expect(bundle.config.address).toBeInstanceOf(PublicKey);
    expect(bundle.auditor.address).toBeInstanceOf(PublicKey);
    expect(bundle.paddingVault.address).toBeInstanceOf(PublicKey);
    expect(bundle.burnerBase(42n).address).toBeInstanceOf(PublicKey);
    expect(bundle.mixRoundBase(42n).address).toBeInstanceOf(PublicKey);
  });

  test("pdaToPlain converts to a display-friendly object", () => {
    const r = deriveConfigPda();
    const plain = pdaToPlain(r);
    expect(typeof plain.address).toBe("string");
    expect(typeof plain.bump).toBe("number");
  });

  test("requireOnCurve throws for off-curve (PDA) keys", () => {
    const configPda = deriveConfigPda().address;
    expect(() => requireOnCurve(configPda, "config")).toThrow();
  });
});
