/**
 * Instruction builder for `applyPending`.
 *
 * Drains the per-account pending counter into the available counter. This
 * is required before the user can spend received confidential balance.
 */

import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { GHOS_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "../constants";
import { deriveConfigPda } from "../pdas";
import { discriminatorFor } from "./initialize";

export interface BuildApplyPendingParams {
  owner: PublicKey;
  mint: PublicKey;
  confidentialAccount: PublicKey;
  programId?: PublicKey;
  tokenProgramId?: PublicKey;
}

export function buildApplyPendingInstruction(
  params: BuildApplyPendingParams
): TransactionInstruction {
  const programId = params.programId ?? GHOS_PROGRAM_ID;
  const tokenProgramId = params.tokenProgramId ?? TOKEN_2022_PROGRAM_ID;
  const configPda = deriveConfigPda(programId).address;
  const disc = discriminatorFor("applyPending");

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: params.owner, isSigner: true, isWritable: true },
      { pubkey: params.mint, isSigner: false, isWritable: false },
      { pubkey: params.confidentialAccount, isSigner: false, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: false },
      { pubkey: tokenProgramId, isSigner: false, isWritable: false }
    ],
    data: Buffer.from(disc)
  });
}
