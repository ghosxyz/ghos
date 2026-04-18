//! `confidential_transfer` dispatches an ElGamal-encrypted balance transfer.
//!
//! The three proof context accounts (equality, ciphertext validity, range) are
//! created in a preceding instruction batch by the client via the
//! zk-token-proof program. They are referenced here by public key and consumed
//! by the Token-2022 program.

use anchor_lang::prelude::*;

use crate::constants::CONFIG_SEED;
use crate::errors::GhosError;
use crate::events::ConfidentialTransferSubmitted;
use crate::state::{AuditorEntry, GhosConfig};
use crate::utils::token22::{
    assert_confidential_account, cpi_confidential_transfer, is_token_2022_program,
};
use crate::utils::validation::{assert_not_paused, now_ts};

#[derive(Accounts)]
pub struct ConfidentialTransfer<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, GhosConfig>,

    #[account(mut)]
    pub source_owner: Signer<'info>,

    /// CHECK: source confidential Token-2022 account
    #[account(mut)]
    pub source_account: AccountInfo<'info>,

    /// CHECK: destination confidential Token-2022 account
    #[account(mut)]
    pub destination_account: AccountInfo<'info>,

    /// CHECK: Token-2022 mint
    pub mint: AccountInfo<'info>,

    /// CHECK: proof context for commitment equality
    pub equality_proof_context: AccountInfo<'info>,

    /// CHECK: proof context for ciphertext validity
    pub ciphertext_validity_proof_context: AccountInfo<'info>,

    /// CHECK: proof context for range proof (split 128-bit bulletproof)
    pub range_proof_context: AccountInfo<'info>,

    /// Optional auditor entry. When present the mint requires auditor inclusion
    /// in the ciphertext set; the program verifies the match before CPI.
    #[account(
        constraint = auditor_entry.as_ref().map_or(true, |a| a.mint == mint.key())
            @ GhosError::AuditorMismatch
    )]
    pub auditor_entry: Option<Account<'info, AuditorEntry>>,

    /// CHECK: Token-2022 program
    pub token_program: AccountInfo<'info>,
}

pub fn handler(
    ctx: Context<ConfidentialTransfer>,
    destination_owner: Pubkey,
    new_source_decryptable_balance: [u8; 36],
) -> Result<()> {
    assert_not_paused(&ctx.accounts.config)?;
    require!(
        is_token_2022_program(&ctx.accounts.token_program.key()),
        GhosError::MintWrongProgramOwner
    );

    assert_confidential_account(
        &ctx.accounts.source_account,
        &ctx.accounts.mint.key(),
        &ctx.accounts.source_owner.key(),
    )?;
    assert_confidential_account(
        &ctx.accounts.destination_account,
        &ctx.accounts.mint.key(),
        &destination_owner,
    )?;

    cpi_confidential_transfer(
        ctx.accounts.token_program.clone(),
        ctx.accounts.source_account.clone(),
        ctx.accounts.mint.clone(),
        ctx.accounts.destination_account.clone(),
        ctx.accounts.source_owner.to_account_info(),
        new_source_decryptable_balance,
        ctx.accounts.equality_proof_context.key(),
        ctx.accounts.ciphertext_validity_proof_context.key(),
        ctx.accounts.range_proof_context.key(),
    )?;

    emit!(ConfidentialTransferSubmitted {
        source_owner: ctx.accounts.source_owner.key(),
        destination_owner,
        mint: ctx.accounts.mint.key(),
        proof_context: ctx.accounts.range_proof_context.key(),
        timestamp: now_ts()?,
    });
    Ok(())
}

// fix: confidential_transfer auditor match when entry absent
