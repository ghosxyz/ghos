/**
 * Instruction builder for `shield`.
 *
 * Moves the given amount of Token-2022 tokens from the user's source ATA
 * into the confidential-balance side of the account, where the balance is
 * an ElGamal ciphertext rather than a plaintext u64.
 */

import {
  PublicKey,
  SystemProgram,
  TransactionInstruction
} from "@solana/web3.js";
import {
  GHOS_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID
} from "../constants";
import { deriveConfigPda, derivePaddingVaultPda } from "../pdas";
import { concatBytes } from "../utils";
import { discriminatorFor, encodeU64Le } from "./initialize";

export interface BuildShieldParams {
  owner: PublicKey;
  mint: PublicKey;
  sourceAta: PublicKey;
  destinationConfidentialAccount: PublicKey;
  amount: bigint;
  programId?: PublicKey;
  tokenProgramId?: PublicKey;
}

/**
 * Assemble the shield instruction. The caller is responsible for ensuring the
 * source ATA exists and holds at least `amount` tokens; the ghos program will
 * reject if preconditions are not met.
 */
export function buildShieldInstruction(
  params: BuildShieldParams
): TransactionInstruction {
  const programId = params.programId ?? GHOS_PROGRAM_ID;
  const tokenProgramId = params.tokenProgramId ?? TOKEN_2022_PROGRAM_ID;
  const configPda = deriveConfigPda(programId).address;
  const paddingVault = derivePaddingVaultPda(programId).address;
  const disc = discriminatorFor("shield");
  const data = concatBytes(disc, encodeU64Le(params.amount));
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: params.owner, isSigner: true, isWritable: true },
      { pubkey: params.mint, isSigner: false, isWritable: false },
      { pubkey: params.sourceAta, isSigner: false, isWritable: true },
      {
        pubkey: params.destinationConfidentialAccount,
        isSigner: false,
        isWritable: true
      },
      { pubkey: configPda, isSigner: false, isWritable: false },
      { pubkey: paddingVault, isSigner: false, isWritable: true },
      { pubkey: tokenProgramId, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
    ],
    data: Buffer.from(data)
  });
}
