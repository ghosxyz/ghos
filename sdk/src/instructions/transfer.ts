/**
 * Instruction builder for `confidentialTransfer`.
 *
 * Submits a confidential transfer to the ghos program. The caller must have
 * already produced range + equality proofs client-side and written them to
 * the zk-token-proof program's proof-context accounts; the ghos program
 * verifies the proofs by CPI and then updates the source / destination
 * ciphertexts atomically.
 */

import {
  PublicKey,
  TransactionInstruction
} from "@solana/web3.js";
import { GHOS_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ZK_TOKEN_PROOF_PROGRAM_ID } from "../constants";
import { deriveAuditorPda, deriveConfigPda } from "../pdas";
import { concatBytes } from "../utils";
import { discriminatorFor } from "./initialize";
import type { ElGamalCiphertext } from "../types";

export interface BuildConfidentialTransferParams {
  owner: PublicKey;
  mint: PublicKey;
  sourceAccount: PublicKey;
  destinationAccount: PublicKey;
  destinationOwner: PublicKey;
  rangeProofContext: PublicKey;
  equalityProofContext: PublicKey;
  auditorEntry?: PublicKey;
  proofRangeHandle: number;
  proofEqualityHandle: number;
  sourceCiphertext: ElGamalCiphertext;
  destCiphertext: ElGamalCiphertext;
  programId?: PublicKey;
  tokenProgramId?: PublicKey;
}

function encodeU32Le(value: number): Uint8Array {
  const buf = new Uint8Array(4);
  new DataView(buf.buffer).setUint32(0, value, true);
  return buf;
}

function flattenCiphertext(c: ElGamalCiphertext): Uint8Array {
  if (c.c1.length !== 32 || c.c2.length !== 32) {
    throw new Error("ciphertext components must each be 32 bytes");
  }
  const out = new Uint8Array(64);
  out.set(c.c1, 0);
  out.set(c.c2, 32);
  return out;
}

export function buildConfidentialTransferInstruction(
  params: BuildConfidentialTransferParams
): TransactionInstruction {
  const programId = params.programId ?? GHOS_PROGRAM_ID;
  const tokenProgramId = params.tokenProgramId ?? TOKEN_2022_PROGRAM_ID;
  const configPda = deriveConfigPda(programId).address;
  const auditorPda =
    params.auditorEntry ?? deriveAuditorPda(params.mint, programId).address;

  const disc = discriminatorFor("confidentialTransfer");
  const data = concatBytes(
    disc,
    encodeU32Le(params.proofRangeHandle),
    encodeU32Le(params.proofEqualityHandle),
    flattenCiphertext(params.sourceCiphertext),
    flattenCiphertext(params.destCiphertext)
  );

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: params.owner, isSigner: true, isWritable: true },
      { pubkey: params.mint, isSigner: false, isWritable: false },
      { pubkey: params.sourceAccount, isSigner: false, isWritable: true },
      { pubkey: params.destinationAccount, isSigner: false, isWritable: true },
      { pubkey: params.destinationOwner, isSigner: false, isWritable: false },
      { pubkey: params.rangeProofContext, isSigner: false, isWritable: false },
      { pubkey: params.equalityProofContext, isSigner: false, isWritable: false },
      { pubkey: auditorPda, isSigner: false, isWritable: false },
      { pubkey: configPda, isSigner: false, isWritable: false },
      { pubkey: ZK_TOKEN_PROOF_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: tokenProgramId, isSigner: false, isWritable: false }
    ],
    data: Buffer.from(data)
  });
}
