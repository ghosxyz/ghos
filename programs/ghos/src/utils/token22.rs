//! Token-2022 CPI wrappers, confined to the calls ghos actually uses.
//!
//! The upstream `spl-token-2022` crate exposes the raw instruction builders.
//! We wrap the ones that ghos CPIs into so instruction handlers stay readable
//! and future upgrades touch one file.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::{invoke, invoke_signed};
use anchor_spl::token_2022::spl_token_2022::extension::{
    confidential_transfer::instruction as ct_ix, BaseStateWithExtensions, StateWithExtensions,
};
use anchor_spl::token_2022::spl_token_2022::instruction as spl_ix;
use anchor_spl::token_2022::spl_token_2022::state::{Account as Token22Account, Mint};
use anchor_spl::token_2022::ID as TOKEN_2022_PROGRAM_ID;

use crate::errors::GhosError;

/// Parse a mint account and return the confidential transfer extension data
/// if present, or `None` if the extension is not configured.
pub fn read_mint_with_confidential_ext(
    mint_info: &AccountInfo,
) -> Result<bool> {
    if mint_info.owner != &TOKEN_2022_PROGRAM_ID {
        return err!(GhosError::MintWrongProgramOwner);
    }
    let data = mint_info.try_borrow_data()?;
    let parsed = StateWithExtensions::<Mint>::unpack(&data)
        .map_err(|_| error!(GhosError::MintMissingConfidentialExt))?;
    let ext_types = parsed
        .get_extension_types()
        .map_err(|_| error!(GhosError::MintMissingConfidentialExt))?;
    use anchor_spl::token_2022::spl_token_2022::extension::ExtensionType;
    let has_ct = ext_types
        .iter()
        .any(|t| matches!(t, ExtensionType::ConfidentialTransferMint));
    if !has_ct {
        return err!(GhosError::MintMissingConfidentialExt);
    }
    Ok(true)
}

/// Parse a token account and assert it owns a confidential transfer balance
/// tied to the expected mint and signer.
pub fn assert_confidential_account(
    account_info: &AccountInfo,
    expected_mint: &Pubkey,
    expected_owner: &Pubkey,
) -> Result<()> {
    if account_info.owner != &TOKEN_2022_PROGRAM_ID {
        return err!(GhosError::MintWrongProgramOwner);
    }
    let data = account_info.try_borrow_data()?;
    let state = StateWithExtensions::<Token22Account>::unpack(&data)
        .map_err(|_| error!(GhosError::AccountNotConfidential))?;
    if state.base.mint != *expected_mint {
        return err!(GhosError::AccountNotConfidential);
    }
    if state.base.owner != *expected_owner {
        return err!(GhosError::AccountOwnerMismatch);
    }
    // The account must carry the confidential transfer account extension.
    use anchor_spl::token_2022::spl_token_2022::extension::ExtensionType;
    let ext_types = state
        .get_extension_types()
        .map_err(|_| error!(GhosError::AccountNotConfidential))?;
    let has_ct = ext_types
        .iter()
        .any(|t| matches!(t, ExtensionType::ConfidentialTransferAccount));
    if !has_ct {
        return err!(GhosError::AccountNotConfidential);
    }
    Ok(())
}

/// CPI into Token-2022's `deposit` (shield) instruction which moves `amount`
/// from the public SPL balance into the pending confidential counter.
pub fn cpi_deposit_to_confidential(
    token_program: AccountInfo,
    account: AccountInfo,
    mint: AccountInfo,
    owner: AccountInfo,
    amount: u64,
    decimals: u8,
) -> Result<()> {
    let ix = ct_ix::deposit(
        &TOKEN_2022_PROGRAM_ID,
        account.key,
        mint.key,
        amount,
        decimals,
        &[owner.key],
    )
    .map_err(|_| error!(GhosError::ConfidentialTransferDisabled))?;
    invoke(
        &ix,
        &[account, mint, owner, token_program],
    )?;
    Ok(())
}

/// CPI into Token-2022's `apply_pending_balance` which drains the pending
/// counter into the available counter for the caller's confidential account.
pub fn cpi_apply_pending_balance(
    token_program: AccountInfo,
    account: AccountInfo,
    owner: AccountInfo,
    expected_pending_credit_counter: u64,
    new_decryptable_available_balance: [u8; 36],
) -> Result<()> {
    let ix = ct_ix::apply_pending_balance(
        &TOKEN_2022_PROGRAM_ID,
        account.key,
        expected_pending_credit_counter,
        new_decryptable_available_balance,
        &[owner.key],
    )
    .map_err(|_| error!(GhosError::NothingToApply))?;
    invoke(&ix, &[account, owner, token_program])?;
    Ok(())
}

/// CPI into Token-2022's `withdraw` instruction which converts a confidential
/// balance back into an SPL balance.
pub fn cpi_withdraw_from_confidential(
    token_program: AccountInfo,
    account: AccountInfo,
    mint: AccountInfo,
    owner: AccountInfo,
    amount: u64,
    decimals: u8,
    new_decryptable_available_balance: [u8; 36],
    equality_proof_context: Option<Pubkey>,
    range_proof_context: Option<Pubkey>,
) -> Result<()> {
    let ix = ct_ix::withdraw(
        &TOKEN_2022_PROGRAM_ID,
        account.key,
        mint.key,
        amount,
        decimals,
        new_decryptable_available_balance,
        equality_proof_context.as_ref(),
        range_proof_context.as_ref(),
        &[owner.key],
    )
    .map_err(|_| error!(GhosError::ConfidentialTransferDisabled))?;
    invoke(&ix, &[account, mint, owner, token_program])?;
    Ok(())
}

/// CPI into Token-2022's `transfer` (confidential) instruction.
///
/// The cryptographic proof contexts are expected to have been built by the
/// client via `solana-zk-token-sdk` and submitted as separate sysvar accounts
/// before this CPI fires.
#[allow(clippy::too_many_arguments)]
pub fn cpi_confidential_transfer(
    token_program: AccountInfo,
    source_account: AccountInfo,
    mint: AccountInfo,
    destination_account: AccountInfo,
    owner: AccountInfo,
    new_source_decryptable_balance: [u8; 36],
    equality_proof_context: Pubkey,
    ciphertext_validity_proof_context: Pubkey,
    range_proof_context: Pubkey,
) -> Result<()> {
    let ix = ct_ix::transfer(
        &TOKEN_2022_PROGRAM_ID,
        source_account.key,
        mint.key,
        destination_account.key,
        new_source_decryptable_balance,
        &equality_proof_context,
        &ciphertext_validity_proof_context,
        &range_proof_context,
        &[owner.key],
    )
    .map_err(|_| error!(GhosError::ConfidentialTransferDisabled))?;
    invoke(
        &ix,
        &[source_account, mint, destination_account, owner, token_program],
    )?;
    Ok(())
}

/// PDA-signed variant of the shield CPI, used when the calling program owns
/// the source token account through a PDA signer.
pub fn cpi_deposit_signed(
    token_program: AccountInfo,
    account: AccountInfo,
    mint: AccountInfo,
    owner: AccountInfo,
    amount: u64,
    decimals: u8,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    let ix = ct_ix::deposit(
        &TOKEN_2022_PROGRAM_ID,
        account.key,
        mint.key,
        amount,
        decimals,
        &[owner.key],
    )
    .map_err(|_| error!(GhosError::ConfidentialTransferDisabled))?;
    invoke_signed(&ix, &[account, mint, owner, token_program], signer_seeds)?;
    Ok(())
}

/// Return true if the given key is the canonical Token-2022 program id.
pub fn is_token_2022_program(key: &Pubkey) -> bool {
    *key == TOKEN_2022_PROGRAM_ID
}

/// Hardcoded decimals probe used by unit tests and the CLI sanity layer.
/// In production the SDK reads the real mint decimals and supplies them.
pub fn probe_decimals(mint_info: &AccountInfo) -> Result<u8> {
    let data = mint_info.try_borrow_data()?;
    let state = StateWithExtensions::<Mint>::unpack(&data)
        .map_err(|_| error!(GhosError::MintWrongProgramOwner))?;
    Ok(state.base.decimals)
}

/// Minimal standalone SPL transfer (used by the padding vault refund path, not
/// confidential).
pub fn cpi_spl_transfer(
    token_program: AccountInfo,
    source: AccountInfo,
    destination: AccountInfo,
    authority: AccountInfo,
    amount: u64,
) -> Result<()> {
    let ix = spl_ix::transfer(
        &TOKEN_2022_PROGRAM_ID,
        source.key,
        destination.key,
        authority.key,
        &[],
        amount,
    )
    .map_err(|_| error!(GhosError::InvalidCiphertext))?;
    invoke(&ix, &[source, destination, authority, token_program])?;
    Ok(())
}
