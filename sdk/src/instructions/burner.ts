/**
 * Instruction builders for `createBurner` and `destroyBurner`.
 */

import {
  PublicKey,
  SystemProgram,
  TransactionInstruction
} from "@solana/web3.js";
import { GHOS_PROGRAM_ID } from "../constants";
import { deriveBurnerPda } from "../pdas";
import { concatBytes } from "../utils";
import { discriminatorFor, encodeI64Le, encodeU64Le } from "./initialize";

export interface BuildCreateBurnerParams {
  owner: PublicKey;
  burnerPubkey: PublicKey;
  nonce: bigint;
  ttlSeconds: number;
  programId?: PublicKey;
}

export function buildCreateBurnerInstruction(
  params: BuildCreateBurnerParams
): TransactionInstruction {
  const programId = params.programId ?? GHOS_PROGRAM_ID;
  const burnerPda = deriveBurnerPda(params.owner, params.nonce, programId).address;
  const disc = discriminatorFor("createBurner");

  const data = concatBytes(
    disc,
    encodeU64Le(params.nonce),
    new Uint8Array(params.burnerPubkey.toBytes()),
    encodeI64Le(params.ttlSeconds)
  );

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: params.owner, isSigner: true, isWritable: true },
      { pubkey: burnerPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
    ],
    data: Buffer.from(data)
  });
}

export interface BuildDestroyBurnerParams {
  owner: PublicKey;
  burnerEntry: PublicKey;
  programId?: PublicKey;
}

export function buildDestroyBurnerInstruction(
  params: BuildDestroyBurnerParams
): TransactionInstruction {
  const programId = params.programId ?? GHOS_PROGRAM_ID;
  const disc = discriminatorFor("destroyBurner");
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: params.owner, isSigner: true, isWritable: true },
      { pubkey: params.burnerEntry, isSigner: false, isWritable: true }
    ],
    data: Buffer.from(disc)
  });
}
