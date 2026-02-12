import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  GHOS_PROGRAM_ID,
  GhosClient,
  GhosKeypair,
  deriveGhosKeypair,
  sdkError
} from "../index";
import { GhosSdkError } from "../errors";

function makeStubConnection(): Connection {
  return new Connection("http://127.0.0.1:8899", "confirmed");
}

describe("GhosClient construction and PDA accessors", () => {
  test("constructor requires both connection and payer", () => {
    const conn = makeStubConnection();
    expect(
      () =>
        new GhosClient({
          connection: conn,
          payer: undefined as unknown as Keypair
        })
    ).toThrow();
  });

  test("constructor sets defaults for optional fields", () => {
    const conn = makeStubConnection();
    const payer = Keypair.generate();
    const client = new GhosClient({ connection: conn, payer });
    expect(client.programId.equals(GHOS_PROGRAM_ID)).toBe(true);
    expect(client.commitment).toBe("confirmed");
    expect(client.skipPreflight).toBe(false);
    expect(client.maxRetries).toBe(3);
  });

  test("configPda is derived deterministically", () => {
    const conn = makeStubConnection();
    const payer = Keypair.generate();
    const client = new GhosClient({ connection: conn, payer });
    const pda1 = client.configPda();
    const pda2 = client.configPda();
    expect(pda1.equals(pda2)).toBe(true);
  });

  test("auditorOverride takes precedence over derivation", () => {
    const conn = makeStubConnection();
    const payer = Keypair.generate();
    const override = PublicKey.unique();
    const client = new GhosClient({
      connection: conn,
      payer,
      auditorOverride: override
    });
    const mint = PublicKey.unique();
    expect(client.auditorPda(mint).equals(override)).toBe(true);
  });

  test("burnerPda is derived with the client's programId", () => {
    const conn = makeStubConnection();
    const payer = Keypair.generate();
    const client = new GhosClient({ connection: conn, payer });
    const pda = client.burnerPda(payer.publicKey, 42n);
    expect(pda).toBeInstanceOf(PublicKey);
  });

  test("mixRoundPda is deterministic given host+mint+nonce", () => {
    const conn = makeStubConnection();
    const payer = Keypair.generate();
    const client = new GhosClient({ connection: conn, payer });
    const mint = PublicKey.unique();
    const a = client.mixRoundPda(payer.publicKey, mint, 1n);
    const b = client.mixRoundPda(payer.publicKey, mint, 1n);
    expect(a.equals(b)).toBe(true);
  });
});

describe("GhosKeypair derivation", () => {
  test("deriveGhosKeypair returns a 32 byte public key", () => {
    const signer = Keypair.generate();
    const kp = deriveGhosKeypair(signer);
    expect(kp.publicKey.length).toBe(32);
    expect(kp.secretKey.length).toBe(32);
  });

  test("same signer produces the same keypair", () => {
    const signer = Keypair.generate();
    const a = deriveGhosKeypair(signer);
    const b = deriveGhosKeypair(signer);
    expect(a.publicKey).toEqual(b.publicKey);
  });

  test("different mints produce different keypairs", () => {
    const signer = Keypair.generate();
    const m1 = PublicKey.unique();
    const m2 = PublicKey.unique();
    const a = deriveGhosKeypair(signer, { mint: m1 });
    const b = deriveGhosKeypair(signer, { mint: m2 });
    expect(a.publicKey).not.toEqual(b.publicKey);
  });

  test("GhosKeypair.fromSigner exposes a fingerprint", () => {
    const signer = Keypair.generate();
    const kp = GhosKeypair.fromSigner(signer);
    expect(typeof kp.fingerprint()).toBe("string");
  });

  test("exposeSecretKey returns a 32-byte copy", () => {
    const signer = Keypair.generate();
    const kp = GhosKeypair.fromSigner(signer);
    const secret = kp.exposeSecretKey();
    expect(secret.length).toBe(32);
  });
});

describe("SDK error system", () => {
  test("sdkError produces a typed error with a code", () => {
    const e = sdkError("InvalidInput", "oops");
    expect(e).toBeInstanceOf(GhosSdkError);
    expect(e.code).toBeGreaterThanOrEqual(9000);
  });

  test("GhosSdkError.toJSON serializes code and message", () => {
    const e = sdkError("InvalidInput", "oops");
    const plain = e.toJSON();
    expect(plain.code).toBe(e.code);
    expect(plain.message).toBe("oops");
  });
});
