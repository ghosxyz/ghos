/**
 * Instruction builder for `initialize`.
 *
 * Creates the singleton GhosConfig PDA and seeds it with the protocol's
 * default knobs. Only callable once per program deployment; subsequent
 * attempts fail with `account already in use` at the system-program level.
 */

import {
  PublicKey,
  SystemProgram,
  TransactionInstruction
} from "@solana/web3.js";
import BN from "bn.js";
import ghosIdl from "../idl/ghos.json";
import { deriveConfigPda } from "../pdas";
import {
  AUDITOR_COSIGN_LAMPORTS,
  BURNER_REGISTRY_CAP_PER_OWNER,
  BURNER_TTL_MAX_SECONDS,
  BURNER_TTL_MIN_SECONDS,
  DUST_FREE_UNIT,
  GHOS_PROGRAM_ID,
  MIX_MAX_PARTICIPANTS,
  MIX_MIN_PARTICIPANTS,
  MIX_REVEAL_WINDOW_SECONDS
} from "../constants";
import { concatBytes } from "../utils";

/**
 * Parameters accepted by `buildInitializeInstruction`.
 */
export interface BuildInitializeParams {
  admin: PublicKey;
  programId?: PublicKey;
  dustFreeUnit?: bigint;
  burnerTtlMin?: number;
  burnerTtlMax?: number;
  burnerRegistryCap?: number;
  mixMinParticipants?: number;
  mixMaxParticipants?: number;
  mixRevealWindow?: number;
  auditorCosignLamports?: bigint;
}

/** Lookup the 8-byte Anchor discriminator for a given instruction name. */
export function discriminatorFor(name: string): Uint8Array {
  const ixDef = ghosIdl.instructions.find((i) => i.name === name);
  if (!ixDef) {
    throw new Error(`unknown instruction in IDL: ${name}`);
  }
  return new Uint8Array(ixDef.discriminator as number[]);
}

/**
 * Encode a bigint as little-endian 8 bytes.
 */
function u64Le(value: bigint | number | BN): Uint8Array {
  const bn =
    BN.isBN(value) ? value :
    typeof value === "bigint" ? new BN(value.toString()) :
    new BN(value);
  return new Uint8Array(bn.toArrayLike(Buffer, "le", 8));
}

/**
 * Encode a signed bigint as little-endian 8 bytes (two's complement).
 */
function i64Le(value: bigint | number | BN): Uint8Array {
  let bn: BN;
  if (BN.isBN(value)) {
    bn = value;
  } else if (typeof value === "bigint") {
    bn = new BN(value.toString());
  } else {
    bn = new BN(value);
  }
  return new Uint8Array(bn.toTwos(64).toArrayLike(Buffer, "le", 8));
}

/**
 * Encode a u16 little-endian.
 */
function u16Le(value: number): Uint8Array {
  const buf = new Uint8Array(2);
  new DataView(buf.buffer).setUint16(0, value, true);
  return buf;
}

/**
 * Encode a u8.
 */
function u8Le(value: number): Uint8Array {
  return new Uint8Array([value & 0xff]);
}

/**
 * Build the `initialize` instruction.
 */
export function buildInitializeInstruction(
  params: BuildInitializeParams
): TransactionInstruction {
  const programId = params.programId ?? GHOS_PROGRAM_ID;
  const config = deriveConfigPda(programId).address;
  const disc = discriminatorFor("initialize");

  const data = concatBytes(
    disc,
    u64Le(params.dustFreeUnit ?? DUST_FREE_UNIT),
    i64Le(params.burnerTtlMin ?? BURNER_TTL_MIN_SECONDS),
    i64Le(params.burnerTtlMax ?? BURNER_TTL_MAX_SECONDS),
    u16Le(params.burnerRegistryCap ?? BURNER_REGISTRY_CAP_PER_OWNER),
    u8Le(params.mixMinParticipants ?? MIX_MIN_PARTICIPANTS),
    u8Le(params.mixMaxParticipants ?? MIX_MAX_PARTICIPANTS),
    i64Le(params.mixRevealWindow ?? MIX_REVEAL_WINDOW_SECONDS),
    u64Le(params.auditorCosignLamports ?? AUDITOR_COSIGN_LAMPORTS)
  );

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: params.admin, isSigner: true, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
    ],
    data: Buffer.from(data)
  });
}

export { u64Le as encodeU64Le, i64Le as encodeI64Le, u16Le as encodeU16Le, u8Le as encodeU8Le };
