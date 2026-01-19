import {
  CURVE_ORDER,
  addCiphertexts,
  baseG,
  ciphertextEquals,
  decrypt,
  deserializeCiphertext,
  encrypt,
  encryptWithRandomness,
  invMod,
  keyGen,
  keyPairFromSeed,
  multBaseG,
  multH,
  pedersenCommit,
  pointFromBytes,
  pointToBytes,
  randomize,
  randomNonZeroScalar,
  scalarFromLE32,
  scalarFromUniform64,
  scalarToLE32,
  serializeCiphertext,
  subCiphertexts,
  twistedH
} from "../crypto/elgamal";
import {
  proveEquality,
  provePubkeyValidity,
  proveZeroBalance,
  verifyEquality,
  verifyPubkeyValidity,
  verifyZeroBalance
} from "../crypto/sigma";
import {
  Transcript,
  proveRange,
  rangeProofSize,
  verifyRangeProof
} from "../index";
import {
  computeMixCommitment,
  computeNoteCommitment,
  randomRevealSignal,
  verifyMixCommitment
} from "../crypto/hash";
import { PublicKey } from "@solana/web3.js";

describe("elgamal primitives", () => {
  test("keyGen produces a 32-byte public key and secret key", () => {
    const kp = keyGen();
    expect(kp.publicKey.length).toBe(32);
    expect(kp.secretKey.length).toBe(32);
  });

  test("scalarToLE32 is the inverse of scalarFromLE32", () => {
    const s = randomNonZeroScalar();
    const bytes = scalarToLE32(s);
    const back = scalarFromLE32(bytes);
    expect(back).toBe(s);
  });

  test("twistedH is different from baseG", () => {
    expect(pointToBytes(twistedH())).not.toEqual(pointToBytes(baseG()));
  });

  test("invMod(a) * a == 1 mod n", () => {
    const a = 12345n;
    const inv = invMod(a, CURVE_ORDER);
    const prod = (a * inv) % CURVE_ORDER;
    expect(prod).toBe(1n);
  });

  test("encrypt / decrypt roundtrip for small balance", () => {
    const kp = keyGen();
    const m = 42n;
    const { ciphertext } = encrypt(kp.publicKey, m);
    const decoded = decrypt(kp.secretKey, ciphertext, { maxBalance: 100n, bsgsStep: 16 });
    expect(decoded).toBe(m);
  });

  test("decrypt returns null when plaintext outside range", () => {
    const kp = keyGen();
    const { ciphertext } = encrypt(kp.publicKey, 100000n);
    const decoded = decrypt(kp.secretKey, ciphertext, { maxBalance: 10n, bsgsStep: 4 });
    expect(decoded).toBeNull();
  });

  test("serializeCiphertext / deserializeCiphertext roundtrip", () => {
    const kp = keyGen();
    const { ciphertext } = encrypt(kp.publicKey, 7n);
    const ser = serializeCiphertext(ciphertext);
    expect(ser.length).toBe(64);
    const back = deserializeCiphertext(ser);
    expect(ciphertextEquals(back, ciphertext)).toBe(true);
  });

  test("homomorphic addition and subtraction", () => {
    const kp = keyGen();
    const a = encrypt(kp.publicKey, 10n).ciphertext;
    const b = encrypt(kp.publicKey, 5n).ciphertext;
    const sum = addCiphertexts(a, b);
    const diff = subCiphertexts(a, b);
    const sumDec = decrypt(kp.secretKey, sum, { maxBalance: 100n, bsgsStep: 8 });
    const diffDec = decrypt(kp.secretKey, diff, { maxBalance: 100n, bsgsStep: 8 });
    expect(sumDec).toBe(15n);
    expect(diffDec).toBe(5n);
  });

  test("randomize does not change the decrypted plaintext", () => {
    const kp = keyGen();
    const { ciphertext } = encrypt(kp.publicKey, 9n);
    const rand = randomize(kp.publicKey, ciphertext);
    expect(ciphertextEquals(rand, ciphertext)).toBe(false);
    const decoded = decrypt(kp.secretKey, rand, { maxBalance: 100n, bsgsStep: 8 });
    expect(decoded).toBe(9n);
  });

  test("pedersenCommit is deterministic under fixed (m, r)", () => {
    const a = pedersenCommit(3n, 7n);
    const b = pedersenCommit(3n, 7n);
    expect(a).toEqual(b);
  });

  test("encryptWithRandomness uses the caller-supplied r", () => {
    const kp = keyGen();
    const r = 9999n;
    const c1 = encryptWithRandomness(kp.publicKey, 5n, r);
    const c2 = encryptWithRandomness(kp.publicKey, 5n, r);
    expect(ciphertextEquals(c1, c2)).toBe(true);
  });

  test("multBaseG / multH produce different points for the same scalar", () => {
    const s = 777n;
    expect(pointToBytes(multBaseG(s))).not.toEqual(pointToBytes(multH(s)));
  });

  test("keyPairFromSeed is deterministic for a fixed seed", () => {
    const seed = new Uint8Array(32).fill(1);
    const a = keyPairFromSeed(seed);
    const b = keyPairFromSeed(seed);
    expect(a.publicKey).toEqual(b.publicKey);
  });

  test("scalarFromUniform64 produces a scalar less than CURVE_ORDER", () => {
    const s = scalarFromUniform64(new Uint8Array(64).fill(0xff));
    expect(s < CURVE_ORDER).toBe(true);
  });

  test("pointFromBytes roundtrips through pointToBytes", () => {
    const p = baseG();
    const raw = pointToBytes(p);
    const back = pointFromBytes(raw);
    expect(pointToBytes(back)).toEqual(raw);
  });
});

describe("sigma protocols", () => {
  test("pubkey validity proof verifies", () => {
    const kp = keyGen();
    const proof = provePubkeyValidity(kp.secretKey);
    expect(verifyPubkeyValidity(proof)).toBe(true);
  });

  test("pubkey validity proof rejects tampered pubkey", () => {
    const kp = keyGen();
    const proof = provePubkeyValidity(kp.secretKey);
    const tamperedProof = {
      ...proof,
      pubkey: new Uint8Array(32).fill(0xab)
    };
    expect(verifyPubkeyValidity(tamperedProof)).toBe(false);
  });

  test("zero balance proof verifies for ciphertext of zero", () => {
    const kp = keyGen();
    const r = 12345n;
    const { ciphertext } = encryptWithRandomnessZero(kp.publicKey, r);
    const proof = proveZeroBalance(kp.publicKey, ciphertext, r);
    expect(verifyZeroBalance(kp.publicKey, proof)).toBe(true);
  });

  test("equality proof verifies when source and dest encrypt same plaintext", () => {
    const kpS = keyGen();
    const kpD = keyGen();
    const r1 = 111n;
    const r2 = 222n;
    const v = 5n;
    const proof = proveEquality({
      sourcePk: kpS.publicKey,
      destPk: kpD.publicKey,
      v,
      rS: r1,
      rD: r2
    });
    const sourceCt = encryptWithRandomness(kpS.publicKey, v, r1);
    const destCt = encryptWithRandomness(kpD.publicKey, v, r2);
    const ok = verifyEquality(
      {
        sourcePk: kpS.publicKey,
        destPk: kpD.publicKey,
        sourceCt,
        destCt
      },
      proof
    );
    expect(ok).toBe(true);
  });

  test("equality proof rejects mismatched plaintexts", () => {
    const kpS = keyGen();
    const kpD = keyGen();
    const r1 = 111n;
    const r2 = 222n;
    const v = 5n;
    const proof = proveEquality({
      sourcePk: kpS.publicKey,
      destPk: kpD.publicKey,
      v,
      rS: r1,
      rD: r2
    });
    const sourceCt = encryptWithRandomness(kpS.publicKey, v, r1);
    const destCt = encryptWithRandomness(kpD.publicKey, 6n, r2);
    const ok = verifyEquality(
      {
        sourcePk: kpS.publicKey,
        destPk: kpD.publicKey,
        sourceCt,
        destCt
      },
      proof
    );
    expect(ok).toBe(false);
  });
});

describe("bulletproof range proofs", () => {
  test("prove emits the expected proof size", () => {
    const { proof } = proveRange(12345n, 64);
    expect(proof.proofBytes.length).toBe(rangeProofSize(64));
  });

  test("verify accepts a structurally valid proof", () => {
    const { proof } = proveRange(1n, 64);
    expect(verifyRangeProof(proof)).toBe(true);
  });

  test("verify rejects a truncated proof", () => {
    const { proof } = proveRange(1n, 64);
    const bad = { ...proof, proofBytes: proof.proofBytes.slice(0, 10) };
    expect(verifyRangeProof(bad)).toBe(false);
  });

  test("prove rejects negative values", () => {
    expect(() => proveRange(-1n, 64)).toThrow();
  });

  test("transcript draws deterministic challenges for identical appends", () => {
    const a = new Transcript();
    a.append("x", new Uint8Array([1, 2, 3]));
    const b = new Transcript();
    b.append("x", new Uint8Array([1, 2, 3]));
    const ca = a.challengeScalar("c");
    const cb = b.challengeScalar("c");
    expect(ca).toBe(cb);
  });
});

describe("mix hashes", () => {
  const roundPk = new PublicKey("11111111111111111111111111111112");
  const partPk = new PublicKey("So11111111111111111111111111111111111111112");

  test("computeMixCommitment returns 32 bytes", () => {
    const salt = new Uint8Array(32).fill(7);
    const reveal = randomRevealSignal();
    const c = computeMixCommitment({
      round: roundPk,
      participant: partPk,
      revealSignal: reveal,
      salt
    });
    expect(c.length).toBe(32);
  });

  test("verifyMixCommitment succeeds for the matching inputs", () => {
    const salt = new Uint8Array(32).fill(7);
    const reveal = randomRevealSignal();
    const c = computeMixCommitment({
      round: roundPk,
      participant: partPk,
      revealSignal: reveal,
      salt
    });
    expect(
      verifyMixCommitment({
        round: roundPk,
        participant: partPk,
        revealSignal: reveal,
        salt,
        commitment: c
      })
    ).toBe(true);
  });

  test("verifyMixCommitment fails for mismatched salt", () => {
    const salt = new Uint8Array(32).fill(7);
    const reveal = randomRevealSignal();
    const c = computeMixCommitment({
      round: roundPk,
      participant: partPk,
      revealSignal: reveal,
      salt
    });
    const bad = new Uint8Array(32).fill(8);
    expect(
      verifyMixCommitment({
        round: roundPk,
        participant: partPk,
        revealSignal: reveal,
        salt: bad,
        commitment: c
      })
    ).toBe(false);
  });

  test("computeNoteCommitment includes denomination in its binding", () => {
    const salt = new Uint8Array(32).fill(1);
    const kp = keyGen();
    const a = computeNoteCommitment({
      mint: partPk,
      denomination: 100n,
      pubkey: kp.publicKey,
      salt
    });
    const b = computeNoteCommitment({
      mint: partPk,
      denomination: 200n,
      pubkey: kp.publicKey,
      salt
    });
    expect(a).not.toEqual(b);
  });
});

function encryptWithRandomnessZero(
  pk: Uint8Array,
  r: bigint
): { ciphertext: { c1: Uint8Array; c2: Uint8Array } } {
  return {
    ciphertext: encryptWithRandomness(pk, 0n, r)
  };
}
