/**
 * Instruction builder for `configUpdate`.
 *
 * The admin can update individual fields of the GhosConfig. The on-chain
 * program uses a tagged dispatch: a `field` byte identifies which field to
 * update, and the payload carries optional typed values; only the one
 * matching `field` is consumed.
 *
 * Field codes (stable across minor versions):
 *   0 => paused (bool)
 *   1 => dustFreeUnit (u64)
 *   2 => burnerTtlMax (i64)
 *   3 => burnerTtlMin (i64)
 *   4 => burnerRegistryCap (u16)
 *   5 => mixMinParticipants (u8)
 *   6 => mixMaxParticipants (u8)
 *   7 => mixRevealWindow (i64)
 *   8 => auditorCosignLamports (u64)
 */

import {
  PublicKey,
  TransactionInstruction
} from "@solana/web3.js";
import { GHOS_PROGRAM_ID } from "../constants";
import { deriveConfigPda } from "../pdas";
import { concatBytes } from "../utils";
import { discriminatorFor, encodeI64Le, encodeU16Le, encodeU64Le, encodeU8Le } from "./initialize";

export const CONFIG_FIELD_CODES = {
  paused: 0,
  dustFreeUnit: 1,
  burnerTtlMax: 2,
  burnerTtlMin: 3,
  burnerRegistryCap: 4,
  mixMinParticipants: 5,
  mixMaxParticipants: 6,
  mixRevealWindow: 7,
  auditorCosignLamports: 8
} as const;

export type ConfigField = keyof typeof CONFIG_FIELD_CODES;

export interface BuildConfigUpdateParams {
  admin: PublicKey;
  field: ConfigField;
  u64Value?: bigint;
  i64Value?: bigint | number;
  boolValue?: boolean;
  u16Value?: number;
  u8Value?: number;
  programId?: PublicKey;
}

function encodeOption(value: Uint8Array | undefined): Uint8Array {
  if (value === undefined) {
    return new Uint8Array([0]);
  }
  return concatBytes(new Uint8Array([1]), value);
}

export function buildConfigUpdateInstruction(
  params: BuildConfigUpdateParams
): TransactionInstruction {
  const programId = params.programId ?? GHOS_PROGRAM_ID;
  const configPda = deriveConfigPda(programId).address;
  const fieldCode = CONFIG_FIELD_CODES[params.field];
  const disc = discriminatorFor("configUpdate");

  const u64Opt = encodeOption(
    params.u64Value !== undefined ? encodeU64Le(params.u64Value) : undefined
  );
  const i64Opt = encodeOption(
    params.i64Value !== undefined ? encodeI64Le(params.i64Value) : undefined
  );
  const boolOpt = encodeOption(
    params.boolValue !== undefined
      ? new Uint8Array([params.boolValue ? 1 : 0])
      : undefined
  );
  const u16Opt = encodeOption(
    params.u16Value !== undefined ? encodeU16Le(params.u16Value) : undefined
  );
  const u8Opt = encodeOption(
    params.u8Value !== undefined ? encodeU8Le(params.u8Value) : undefined
  );

  const data = concatBytes(
    disc,
    encodeU8Le(fieldCode),
    u64Opt,
    i64Opt,
    boolOpt,
    u16Opt,
    u8Opt
  );

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: params.admin, isSigner: true, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: true }
    ],
    data: Buffer.from(data)
  });
}
