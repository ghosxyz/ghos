/**
 * PDA derivation helpers. Every seed string here mirrors a constant in
 * `programs/ghos/src/constants.rs`. The derivations must stay in sync.
 *
 * For any given program id, each of these functions is a pure math operation
 * and the bump is included in the returned tuple so the SDK does not re-derive
 * it for downstream use.
 */

import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import {
  AUDITOR_SEED,
  BURNER_SEED,
  CONFIG_SEED,
  GHOS_PROGRAM_ID,
  MIX_COMMITMENT_SEED,
  MIX_ROUND_SEED,
  PADDING_VAULT_SEED
} from "./constants";

/**
 * A PDA derivation result carrying both the address and the bump byte. The
 * bump must be presented to the program when the PDA is an `init` or `mut`
 * destination, so every helper returns it.
 */
export interface PdaResult {
  address: PublicKey;
  bump: number;
}

/**
 * Helper wrapping `PublicKey.findProgramAddressSync`, assigning both the
 * resolved address and the bump to named fields. Callers should prefer the
 * specialized helpers below, but this is also exported so custom seeds can be
 * composed without duplicating the boilerplate.
 */
export function findPda(
  seeds: Array<Buffer | Uint8Array>,
  programId: PublicKey = GHOS_PROGRAM_ID
): PdaResult {
  const [address, bump] = PublicKey.findProgramAddressSync(seeds, programId);
  return { address, bump };
}

/**
 * Encode a bigint as little-endian 8 bytes, matching the default Borsh layout
 * used by Anchor.
 */
export function toLeBytes64(value: bigint | number | BN): Buffer {
  let bn: BN;
  if (BN.isBN(value)) {
    bn = value;
  } else if (typeof value === "bigint") {
    bn = new BN(value.toString());
  } else {
    bn = new BN(value);
  }
  return bn.toArrayLike(Buffer, "le", 8);
}

/**
 * Encode a u16 as little-endian 2 bytes.
 */
export function toLeBytes16(value: number): Buffer {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(value & 0xffff, 0);
  return buf;
}

/**
 * Encode a u8 as a single byte.
 */
export function toLeByte(value: number): Buffer {
  return Buffer.from([value & 0xff]);
}

/**
 * Derive the singleton `GhosConfig` PDA.
 */
export function deriveConfigPda(
  programId: PublicKey = GHOS_PROGRAM_ID
): PdaResult {
  return findPda([CONFIG_SEED], programId);
}

/**
 * Derive a burner registry PDA for the given owner and nonce. Each owner may
 * hold multiple burners differentiated by nonce; the on-chain program stores a
 * `nonce` field inside the account for collision-free reuse.
 */
export function deriveBurnerPda(
  owner: PublicKey,
  nonce: bigint | number | BN,
  programId: PublicKey = GHOS_PROGRAM_ID
): PdaResult {
  return findPda(
    [BURNER_SEED, owner.toBuffer(), toLeBytes64(nonce)],
    programId
  );
}

/**
 * Derive a mix round PDA for a given host and round nonce.
 */
export function deriveMixRoundPda(
  host: PublicKey,
  mint: PublicKey,
  roundNonce: bigint | number | BN,
  programId: PublicKey = GHOS_PROGRAM_ID
): PdaResult {
  return findPda(
    [
      MIX_ROUND_SEED,
      host.toBuffer(),
      mint.toBuffer(),
      toLeBytes64(roundNonce)
    ],
    programId
  );
}

/**
 * Derive a per-participant commitment PDA under a given round.
 */
export function deriveMixCommitmentPda(
  round: PublicKey,
  participant: PublicKey,
  programId: PublicKey = GHOS_PROGRAM_ID
): PdaResult {
  return findPda(
    [MIX_COMMITMENT_SEED, round.toBuffer(), participant.toBuffer()],
    programId
  );
}

/**
 * Derive the auditor entry PDA for a given mint.
 */
export function deriveAuditorPda(
  mint: PublicKey,
  programId: PublicKey = GHOS_PROGRAM_ID
): PdaResult {
  return findPda([AUDITOR_SEED, mint.toBuffer()], programId);
}

/**
 * Derive the padding vault PDA.
 */
export function derivePaddingVaultPda(
  programId: PublicKey = GHOS_PROGRAM_ID
): PdaResult {
  return findPda([PADDING_VAULT_SEED], programId);
}

/**
 * Convenience: derive the full set of PDAs that touch a particular owner and
 * mint. Useful for building a debug snapshot when something goes wrong.
 */
export function deriveOwnerMintBundle(
  owner: PublicKey,
  mint: PublicKey,
  programId: PublicKey = GHOS_PROGRAM_ID
): {
  config: PdaResult;
  auditor: PdaResult;
  paddingVault: PdaResult;
  burnerBase: (nonce: bigint | number | BN) => PdaResult;
  mixRoundBase: (roundNonce: bigint | number | BN) => PdaResult;
} {
  return {
    config: deriveConfigPda(programId),
    auditor: deriveAuditorPda(mint, programId),
    paddingVault: derivePaddingVaultPda(programId),
    burnerBase: (nonce) => deriveBurnerPda(owner, nonce, programId),
    mixRoundBase: (roundNonce) =>
      deriveMixRoundPda(owner, mint, roundNonce, programId)
  };
}

/**
 * Utility: determine whether a given address matches the configured PDA
 * derivation for a known seed. Returns the bump if it matches, null otherwise.
 * Useful in the watcher to reject fraudulent account-change notifications that
 * reference the ghos program but are not one of our known PDAs.
 */
export function matchesPda(
  address: PublicKey,
  seeds: Array<Buffer | Uint8Array>,
  programId: PublicKey = GHOS_PROGRAM_ID
): number | null {
  try {
    const derived = findPda(seeds, programId);
    if (derived.address.equals(address)) {
      return derived.bump;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * A small internal sanity-check that a given PublicKey is NOT itself a PDA
 * (i.e. it lives on-curve). Used on inputs that must be regular keypair
 * addresses (e.g. burner pubkey, participant pubkey).
 */
export function requireOnCurve(
  key: PublicKey,
  label = "publicKey"
): void {
  if (!PublicKey.isOnCurve(key.toBytes())) {
    throw new Error(`${label} must be an on-curve public key, got a PDA`);
  }
}

/**
 * Serialize a PDA result to a simple plain object, useful for logging.
 */
export function pdaToPlain(result: PdaResult): { address: string; bump: number } {
  return { address: result.address.toBase58(), bump: result.bump };
}
