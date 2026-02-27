/**
 * Token-2022 confidential mint fixtures.
 *
 * Provides helpers that create Token-2022 mints with the confidential transfer
 * extension enabled so the Anchor test harness can exercise the full shield,
 * transfer, withdraw lifecycle. All helpers are deterministic given the same
 * payer and mint keypairs.
 */
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  ExtensionType,
  createInitializeMintInstruction,
  getMintLen,
  createInitializeConfidentialTransferMintInstruction,
  mintTo,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  createInitializeAccount3Instruction,
} from "@solana/spl-token";

/**
 * Configuration used to create a Token-2022 confidential mint.
 */
export interface ConfidentialMintConfig {
  /** Decimals, matching SPL mint convention. USDC-like is 6. */
  decimals: number;
  /** Authority that may mint additional supply. */
  mintAuthority: PublicKey;
  /** Authority that may freeze accounts, or null to disable freezing. */
  freezeAuthority: PublicKey | null;
  /** Authority allowed to approve a confidential account's auto-approval. */
  confidentialTransferAuthority: PublicKey | null;
  /** Whether new confidential accounts auto-approve, bypassing the authority. */
  autoApproveNewAccounts: boolean;
  /** Optional auditor ElGamal pubkey encoded as 32 bytes, null if not used. */
  auditorElGamalPubkey: Uint8Array | null;
}

/**
 * Result returned by {@link createConfidentialMint}.
 */
export interface CreatedConfidentialMint {
  mint: PublicKey;
  mintKeypair: Keypair;
  signature: string;
  decimals: number;
}

/**
 * Create a brand new Token-2022 mint with the confidential transfer extension.
 *
 * The extension is initialized before the mint itself, per the Token-2022
 * requirement that extensions must precede InitializeMint in the same tx.
 */
export async function createConfidentialMint(
  connection: Connection,
  payer: Keypair,
  config: ConfidentialMintConfig
): Promise<CreatedConfidentialMint> {
  const mintKeypair = Keypair.generate();
  const extensions: ExtensionType[] = [ExtensionType.ConfidentialTransferMint];
  const space = getMintLen(extensions);
  const lamports = await connection.getMinimumBalanceForRentExemption(space);

  const tx = new Transaction();
  tx.add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mintKeypair.publicKey,
      space,
      lamports,
      programId: TOKEN_2022_PROGRAM_ID,
    })
  );

  tx.add(
    createInitializeConfidentialTransferMintInstruction(
      mintKeypair.publicKey,
      config.confidentialTransferAuthority,
      config.autoApproveNewAccounts,
      config.auditorElGamalPubkey,
      TOKEN_2022_PROGRAM_ID
    )
  );

  tx.add(
    createInitializeMintInstruction(
      mintKeypair.publicKey,
      config.decimals,
      config.mintAuthority,
      config.freezeAuthority,
      TOKEN_2022_PROGRAM_ID
    )
  );

  const signature = await sendAndConfirmTransaction(connection, tx, [
    payer,
    mintKeypair,
  ]);
  return {
    mint: mintKeypair.publicKey,
    mintKeypair,
    signature,
    decimals: config.decimals,
  };
}

/**
 * Create an Associated Token Account for a Token-2022 mint and fund it with
 * the mint authority.
 */
export async function mintToAta(
  connection: Connection,
  payer: Keypair,
  mint: PublicKey,
  owner: PublicKey,
  mintAuthority: Keypair,
  amount: bigint
): Promise<{ ata: PublicKey; signature: string }> {
  const ata = getAssociatedTokenAddressSync(
    mint,
    owner,
    true,
    TOKEN_2022_PROGRAM_ID
  );

  const tx = new Transaction();
  tx.add(
    createAssociatedTokenAccountIdempotentInstruction(
      payer.publicKey,
      ata,
      owner,
      mint,
      TOKEN_2022_PROGRAM_ID
    )
  );
  const createSig = await sendAndConfirmTransaction(connection, tx, [payer]);

  const mintSig = await mintTo(
    connection,
    payer,
    mint,
    ata,
    mintAuthority,
    amount,
    [],
    undefined,
    TOKEN_2022_PROGRAM_ID
  );

  return { ata, signature: `${createSig}:${mintSig}` };
}

/**
 * Number-of-decimals scaling helper. Matches UI amount to raw atomic amount.
 */
export function toAtomic(uiAmount: number, decimals: number): bigint {
  if (!Number.isFinite(uiAmount) || uiAmount < 0) {
    throw new Error(`invalid ui amount: ${uiAmount}`);
  }
  const multiplier = 10n ** BigInt(decimals);
  const whole = BigInt(Math.floor(uiAmount));
  const frac = Math.round((uiAmount - Math.floor(uiAmount)) * Number(multiplier));
  return whole * multiplier + BigInt(frac);
}

/**
 * Reverse of {@link toAtomic}.
 */
export function fromAtomic(atomic: bigint, decimals: number): number {
  const multiplier = 10n ** BigInt(decimals);
  const whole = atomic / multiplier;
  const frac = atomic % multiplier;
  return Number(whole) + Number(frac) / Number(multiplier);
}

/**
 * Deterministic mint keypair derivation, used so repeated test runs in a
 * single localnet session do not clash on seeds.
 */
export function deterministicMintKeypair(label: string, nonce: number): Keypair {
  const seed = new Uint8Array(32);
  const raw = Buffer.from(`${label}:${nonce}`);
  for (let i = 0; i < 32; i++) {
    seed[i] = raw[i % raw.length] ^ (i * 31);
  }
  return Keypair.fromSeed(seed);
}

/**
 * Default test mint config: 6 decimals, payer is mint authority, no freeze,
 * no auditor. Matches the USDC-like case used throughout the suite.
 */
export function defaultMintConfig(payer: PublicKey): ConfidentialMintConfig {
  return {
    decimals: 6,
    mintAuthority: payer,
    freezeAuthority: null,
    confidentialTransferAuthority: payer,
    autoApproveNewAccounts: true,
    auditorElGamalPubkey: null,
  };
}

/**
 * Test mint config with an auditor pubkey preconfigured at the mint level.
 * The actual ghos AuditorEntry PDA must still be initialized separately via
 * the auditor_register instruction.
 */
export function mintConfigWithAuditor(
  payer: PublicKey,
  auditorPubkey: Uint8Array
): ConfidentialMintConfig {
  if (auditorPubkey.length !== 32) {
    throw new Error("auditor pubkey must be 32 bytes");
  }
  return {
    decimals: 6,
    mintAuthority: payer,
    freezeAuthority: null,
    confidentialTransferAuthority: payer,
    autoApproveNewAccounts: false,
    auditorElGamalPubkey: auditorPubkey,
  };
}

/**
 * Confirm that the given mint account is indeed owned by the Token-2022
 * program. Used as a precondition guard in tests.
 */
export async function assertMintIsToken2022(
  connection: Connection,
  mint: PublicKey
): Promise<void> {
  const info = await connection.getAccountInfo(mint, "confirmed");
  if (!info) {
    throw new Error(`mint ${mint.toBase58()} does not exist`);
  }
  if (!info.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    throw new Error(
      `mint ${mint.toBase58()} owner is ${info.owner.toBase58()}, expected Token-2022`
    );
  }
}

/**
 * Fund a fresh SOL keypair from the payer so it can cover rent and fees in
 * the test scenario.
 */
export async function fundLamports(
  connection: Connection,
  payer: Keypair,
  recipient: PublicKey,
  lamports: number
): Promise<string> {
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: recipient,
      lamports,
    })
  );
  return sendAndConfirmTransaction(connection, tx, [payer]);
}

/**
 * Initialize a raw Token-2022 account for a mint without going through ATA
 * derivation, used for burner accounts where we want a specific keypair.
 */
export async function createExplicitTokenAccount(
  connection: Connection,
  payer: Keypair,
  mint: PublicKey,
  owner: PublicKey,
  accountKeypair: Keypair
): Promise<string> {
  const space = 170;
  const lamports = await connection.getMinimumBalanceForRentExemption(space);
  const tx = new Transaction();
  tx.add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: accountKeypair.publicKey,
      lamports,
      space,
      programId: TOKEN_2022_PROGRAM_ID,
    })
  );
  tx.add(
    createInitializeAccount3Instruction(
      accountKeypair.publicKey,
      mint,
      owner,
      TOKEN_2022_PROGRAM_ID
    )
  );
  return sendAndConfirmTransaction(connection, tx, [payer, accountKeypair]);
}
