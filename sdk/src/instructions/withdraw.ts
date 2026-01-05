/**
 * Instruction builder for `withdraw`.
 *
 * Converts a portion of the confidential balance back to the user's SPL
 * balance, revealing only the amount the user explicitly signs off on.
 * When `requireAuditor` is true, the configured auditor key must co-sign
 * the operation (the ghos program enforces this via `auditor_cosign_lamports`
 * withholding).
 */

import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import {
  GHOS_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ZK_TOKEN_PROOF_PROGRAM_ID
} from "../constants";
import { deriveAuditorPda, deriveConfigPda } from "../pdas";
import { concatBytes } from "../utils";
import { discriminatorFor, encodeU64Le } from "./initialize";

export interface BuildWithdrawParams {
  owner: PublicKey;
  mint: PublicKey;
  sourceAccount: PublicKey;
  destinationAta: PublicKey;
  amount: bigint;
  requireAuditor?: boolean;
  auditorEntry?: PublicKey;
  programId?: PublicKey;
  tokenProgramId?: PublicKey;
}

export function buildWithdrawInstruction(
  params: BuildWithdrawParams
): TransactionInstruction {
  const programId = params.programId ?? GHOS_PROGRAM_ID;
  const tokenProgramId = params.tokenProgramId ?? TOKEN_2022_PROGRAM_ID;
  const configPda = deriveConfigPda(programId).address;
  const auditorPda =
    params.auditorEntry ?? deriveAuditorPda(params.mint, programId).address;
  const requireAuditor = params.requireAuditor ?? false;

  const disc = discriminatorFor("withdraw");
  const data = concatBytes(
    disc,
    encodeU64Le(params.amount),
    new Uint8Array([requireAuditor ? 1 : 0])
  );

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: params.owner, isSigner: true, isWritable: true },
      { pubkey: params.mint, isSigner: false, isWritable: false },
      { pubkey: params.sourceAccount, isSigner: false, isWritable: true },
      { pubkey: params.destinationAta, isSigner: false, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: false },
      { pubkey: auditorPda, isSigner: false, isWritable: false },
      { pubkey: ZK_TOKEN_PROOF_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: tokenProgramId, isSigner: false, isWritable: false }
    ],
    data: Buffer.from(data)
  });
}
