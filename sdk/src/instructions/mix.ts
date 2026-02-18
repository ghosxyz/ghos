/**
 * Instruction builders for the four CoinJoin mix instructions: init, commit,
 * reveal, settle.
 */

import {
  PublicKey,
  SystemProgram,
  TransactionInstruction
} from "@solana/web3.js";
import { GHOS_PROGRAM_ID } from "../constants";
import { deriveConfigPda, deriveMixCommitmentPda, deriveMixRoundPda } from "../pdas";
import { concatBytes } from "../utils";
import { discriminatorFor, encodeI64Le, encodeU64Le, encodeU8Le } from "./initialize";

export interface BuildMixInitParams {
  host: PublicKey;
  mint: PublicKey;
  roundNonce: bigint;
  denomination: bigint;
  capacity: number;
  commitWindowSeconds: number;
  programId?: PublicKey;
}

export function buildMixInitInstruction(
  params: BuildMixInitParams
): TransactionInstruction {
  const programId = params.programId ?? GHOS_PROGRAM_ID;
  const roundPda = deriveMixRoundPda(
    params.host,
    params.mint,
    params.roundNonce,
    programId
  ).address;
  const disc = discriminatorFor("mixInit");

  const data = concatBytes(
    disc,
    encodeU64Le(params.roundNonce),
    encodeU64Le(params.denomination),
    encodeU8Le(params.capacity),
    encodeI64Le(params.commitWindowSeconds)
  );

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: params.host, isSigner: true, isWritable: true },
      { pubkey: params.mint, isSigner: false, isWritable: false },
      { pubkey: roundPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
    ],
    data: Buffer.from(data)
  });
}

export interface BuildMixCommitParams {
  participant: PublicKey;
  round: PublicKey;
  commitment: Uint8Array;
  index: number;
  programId?: PublicKey;
}

export function buildMixCommitInstruction(
  params: BuildMixCommitParams
): TransactionInstruction {
  const programId = params.programId ?? GHOS_PROGRAM_ID;
  if (params.commitment.length !== 32) {
    throw new Error(
      `commitment must be 32 bytes, got ${params.commitment.length}`
    );
  }
  const commitmentPda = deriveMixCommitmentPda(
    params.round,
    params.participant,
    programId
  ).address;
  const disc = discriminatorFor("mixCommit");
  const data = concatBytes(disc, params.commitment, encodeU8Le(params.index));

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: params.participant, isSigner: true, isWritable: true },
      { pubkey: params.round, isSigner: false, isWritable: true },
      { pubkey: commitmentPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
    ],
    data: Buffer.from(data)
  });
}

export interface BuildMixRevealParams {
  participant: PublicKey;
  round: PublicKey;
  revealSignal: Uint8Array;
  salt: Uint8Array;
  programId?: PublicKey;
}

export function buildMixRevealInstruction(
  params: BuildMixRevealParams
): TransactionInstruction {
  const programId = params.programId ?? GHOS_PROGRAM_ID;
  if (params.revealSignal.length !== 32) {
    throw new Error(`revealSignal must be 32 bytes, got ${params.revealSignal.length}`);
  }
  if (params.salt.length !== 32) {
    throw new Error(`salt must be 32 bytes, got ${params.salt.length}`);
  }
  const commitmentPda = deriveMixCommitmentPda(
    params.round,
    params.participant,
    programId
  ).address;
  const disc = discriminatorFor("mixReveal");
  const data = concatBytes(disc, params.revealSignal, params.salt);
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: params.participant, isSigner: true, isWritable: true },
      { pubkey: params.round, isSigner: false, isWritable: true },
      { pubkey: commitmentPda, isSigner: false, isWritable: true }
    ],
    data: Buffer.from(data)
  });
}

export interface BuildMixSettleParams {
  host: PublicKey;
  round: PublicKey;
  participantIndices: number[];
  programId?: PublicKey;
}

export function buildMixSettleInstruction(
  params: BuildMixSettleParams
): TransactionInstruction {
  const programId = params.programId ?? GHOS_PROGRAM_ID;
  const configPda = deriveConfigPda(programId).address;
  const disc = discriminatorFor("mixSettle");
  // Encode Vec<u8>: 4-byte LE length prefix, then bytes.
  const lenBuf = new Uint8Array(4);
  new DataView(lenBuf.buffer).setUint32(0, params.participantIndices.length, true);
  const indicesBytes = new Uint8Array(params.participantIndices.length);
  for (let i = 0; i < params.participantIndices.length; i++) {
    indicesBytes[i] = params.participantIndices[i]! & 0xff;
  }
  const data = concatBytes(disc, lenBuf, indicesBytes);

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: params.host, isSigner: true, isWritable: true },
      { pubkey: params.round, isSigner: false, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: false }
    ],
    data: Buffer.from(data)
  });
}
