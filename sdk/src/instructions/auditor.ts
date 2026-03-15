/**
 * Instruction builders for `auditorRegister` and `auditorRotate`.
 */

import {
  PublicKey,
  SystemProgram,
  TransactionInstruction
} from "@solana/web3.js";
import { AUDITOR_PUBKEY_LEN, GHOS_PROGRAM_ID } from "../constants";
import { deriveAuditorPda, deriveConfigPda } from "../pdas";
import { concatBytes } from "../utils";
import { discriminatorFor, encodeI64Le } from "./initialize";
import type { ElGamalPublicKey } from "../types";

export interface BuildAuditorRegisterParams {
  admin: PublicKey;
  mint: PublicKey;
  auditorPubkey: ElGamalPublicKey;
  rotationCooldownSeconds: number;
  programId?: PublicKey;
}

export function buildAuditorRegisterInstruction(
  params: BuildAuditorRegisterParams
): TransactionInstruction {
  const programId = params.programId ?? GHOS_PROGRAM_ID;
  if (params.auditorPubkey.length !== AUDITOR_PUBKEY_LEN) {
    throw new Error(
      `auditor pubkey must be ${AUDITOR_PUBKEY_LEN} bytes, got ${params.auditorPubkey.length}`
    );
  }
  const auditorPda = deriveAuditorPda(params.mint, programId).address;
  const configPda = deriveConfigPda(programId).address;
  const disc = discriminatorFor("auditorRegister");
  const data = concatBytes(
    disc,
    params.auditorPubkey,
    encodeI64Le(params.rotationCooldownSeconds)
  );

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: params.admin, isSigner: true, isWritable: true },
      { pubkey: params.mint, isSigner: false, isWritable: false },
      { pubkey: auditorPda, isSigner: false, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
    ],
    data: Buffer.from(data)
  });
}

export interface BuildAuditorRotateParams {
  admin: PublicKey;
  mint: PublicKey;
  newAuditorPubkey: ElGamalPublicKey;
  programId?: PublicKey;
}

export function buildAuditorRotateInstruction(
  params: BuildAuditorRotateParams
): TransactionInstruction {
  const programId = params.programId ?? GHOS_PROGRAM_ID;
  if (params.newAuditorPubkey.length !== AUDITOR_PUBKEY_LEN) {
    throw new Error(
      `new auditor pubkey must be ${AUDITOR_PUBKEY_LEN} bytes, got ${params.newAuditorPubkey.length}`
    );
  }
  const auditorPda = deriveAuditorPda(params.mint, programId).address;
  const configPda = deriveConfigPda(programId).address;
  const disc = discriminatorFor("auditorRotate");
  const data = concatBytes(disc, params.newAuditorPubkey);

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: params.admin, isSigner: true, isWritable: true },
      { pubkey: params.mint, isSigner: false, isWritable: false },
      { pubkey: auditorPda, isSigner: false, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: false }
    ],
    data: Buffer.from(data)
  });
}
