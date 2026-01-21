import {
  assertDustFreeAligned,
  assertPositiveAmount,
  clampU64,
  concatBytes,
  constantTimeEqual,
  defaultShouldRetry,
  formatAmount,
  fromBase64,
  hexDecode,
  hexEncode,
  parseAmount,
  publicKeyEquals,
  randomBytes,
  randomNonce,
  retry,
  roundDownTo,
  shortKey,
  sleep,
  toBase64,
  toBN,
  bnToBig,
  withTimeout
} from "../utils";
import { PublicKey } from "@solana/web3.js";

describe("utils", () => {
  test("sleep resolves after the requested time", async () => {
    const start = Date.now();
    await sleep(10);
    expect(Date.now() - start).toBeGreaterThanOrEqual(9);
  });

  test("retry returns on first success without delay", async () => {
    let calls = 0;
    const result = await retry(async () => {
      calls += 1;
      return "ok";
    });
    expect(result).toBe("ok");
    expect(calls).toBe(1);
  });

  test("retry retries on transient error and eventually succeeds", async () => {
    let calls = 0;
    const result = await retry(
      async () => {
        calls += 1;
        if (calls < 2) {
          throw new Error("blockhash not found");
        }
        return "ok";
      },
      { baseDelayMs: 1, maxRetries: 3 }
    );
    expect(result).toBe("ok");
    expect(calls).toBe(2);
  });

  test("retry gives up after maxRetries on persistent failure", async () => {
    let calls = 0;
    await expect(
      retry(
        async () => {
          calls += 1;
          throw new Error("blockhash not found");
        },
        { baseDelayMs: 1, maxRetries: 2 }
      )
    ).rejects.toThrow();
    expect(calls).toBe(3);
  });

  test("defaultShouldRetry recognizes common transient errors", () => {
    expect(defaultShouldRetry(new Error("429 too many requests"))).toBe(true);
    expect(defaultShouldRetry(new Error("Blockhash not found"))).toBe(true);
    expect(defaultShouldRetry(new Error("non-transient failure"))).toBe(false);
  });

  test("toBN / bnToBig roundtrip preserves value", () => {
    const original = 12345678901234567890n;
    const bn = toBN(original);
    const back = bnToBig(bn);
    expect(back).toBe(original);
  });

  test("clampU64 rejects negative and overflowing", () => {
    expect(() => clampU64(-1n)).toThrow();
    expect(() => clampU64(2n ** 64n)).toThrow();
    expect(clampU64(0n)).toBe(0n);
  });

  test("roundDownTo produces rounded and remainder", () => {
    const { rounded, remainder } = roundDownTo(1234n, 1000n);
    expect(rounded).toBe(1000n);
    expect(remainder).toBe(234n);
  });

  test("assertPositiveAmount throws on zero", () => {
    expect(() => assertPositiveAmount(0n)).toThrow();
    expect(() => assertPositiveAmount(1n)).not.toThrow();
  });

  test("assertDustFreeAligned accepts multiples", () => {
    expect(() => assertDustFreeAligned(2000n, 1000n)).not.toThrow();
    expect(() => assertDustFreeAligned(1500n, 1000n)).toThrow();
  });

  test("hex encode / decode roundtrip", () => {
    const bytes = new Uint8Array([0x00, 0xab, 0xff]);
    const hex = hexEncode(bytes);
    expect(hex).toBe("00abff");
    const back = hexDecode(hex);
    expect(Array.from(back)).toEqual(Array.from(bytes));
  });

  test("hexDecode handles 0x prefix and odd length", () => {
    const a = hexDecode("0x1");
    expect(a.length).toBe(1);
    expect(a[0]).toBe(1);
  });

  test("constantTimeEqual compares byte arrays structurally", () => {
    expect(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
    expect(constantTimeEqual(new Uint8Array([1]), new Uint8Array([1, 2]))).toBe(false);
  });

  test("concatBytes concatenates multiple sources", () => {
    const out = concatBytes(new Uint8Array([1, 2]), new Uint8Array([3, 4]));
    expect(Array.from(out)).toEqual([1, 2, 3, 4]);
  });

  test("formatAmount renders with decimals, parseAmount parses back", () => {
    expect(formatAmount(1500000n, 6)).toBe("1.5");
    expect(parseAmount("1.5", 6)).toBe(1500000n);
    expect(parseAmount("0", 6)).toBe(0n);
  });

  test("toBase64 / fromBase64 roundtrip", () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const b64 = toBase64(bytes);
    const back = fromBase64(b64);
    expect(Array.from(back)).toEqual(Array.from(bytes));
  });

  test("randomBytes returns the requested length and variable content", () => {
    const a = randomBytes(16);
    const b = randomBytes(16);
    expect(a.length).toBe(16);
    expect(b.length).toBe(16);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  test("randomNonce returns a non-zero 64-bit bigint", () => {
    const n = randomNonce();
    expect(n).toBeGreaterThanOrEqual(0n);
    expect(n < 2n ** 64n).toBe(true);
  });

  test("shortKey produces a compact representation", () => {
    const key = PublicKey.unique();
    const short = shortKey(key);
    expect(short.includes("..")).toBe(true);
  });

  test("publicKeyEquals works both ways", () => {
    const a = PublicKey.unique();
    const b = PublicKey.unique();
    expect(publicKeyEquals(a, a)).toBe(true);
    expect(publicKeyEquals(a, b)).toBe(false);
  });

  test("withTimeout rejects slow promises", async () => {
    let handle: ReturnType<typeof setTimeout> | undefined;
    const slow = new Promise<number>((resolve) => {
      handle = setTimeout(() => resolve(1), 200);
    });
    await expect(withTimeout(slow, 20)).rejects.toThrow();
    if (handle !== undefined) {
      clearTimeout(handle);
    }
  });
});
