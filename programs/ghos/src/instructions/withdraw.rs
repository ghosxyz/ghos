//! `withdraw` converts confidential balance back to SPL (public) balance.
//!
//! When the mint has an auditor registered, withdraws over a lamport threshold
//! require an auditor co-sign transaction and the fee accounts for that step.

use anchor_lang::prelude::*;

use crate::constants::CONFIG_SEED;
use crate::errors::GhosError;
use crate::events::WithdrawExecuted;
use crate::state::{AuditorEntry, GhosConfig};
use crate::utils::token22::{
    assert_confidential_account, cpi_withdraw_from_confidential, is_token_2022_program,
    probe_decimals, read_mint_with_confidential_ext,
};
use crate::utils::validation::{assert_dust_free, assert_not_paused, now_ts};

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, GhosConfig>,

    #[account(mut)]
    pub owner: Signer<'info>,

    /// CHECK: Token-2022 confidential account
    #[account(mut)]
    pub confidential_ata: AccountInfo<'info>,

    /// CHECK: Token-2022 mint
    pub mint: AccountInfo<'info>,

    /// CHECK: range proof context account, or system program if unused.
    pub range_proof_context: Option<AccountInfo<'info>>,

    /// CHECK: equality proof context, or system program if unused.
    pub equality_proof_context: Option<AccountInfo<'info>>,

    /// Optional auditor entry required when the mint demands co-sign.
    pub auditor_entry: Option<Account<'info, AuditorEntry>>,

    /// CHECK: Token-2022 program
    pub token_program: AccountInfo<'info>,
}

pub fn handler(
    ctx: Context<Withdraw>,
    amount: u64,
    new_decryptable_available: [u8; 36],
) -> Result<()> {
    assert_not_paused(&ctx.accounts.config)?;
    assert_dust_free(amount)?;

    require!(
        is_token_2022_program(&ctx.accounts.token_program.key()),
        GhosError::MintWrongProgramOwner
    );

    read_mint_with_confidential_ext(&ctx.accounts.mint)?;
    assert_confidential_account(
        &ctx.accounts.confidential_ata,
        &ctx.accounts.mint.key(),
        &ctx.accounts.owner.key(),
    )?;

    let decimals = probe_decimals(&ctx.accounts.mint)?;

    // Auditor co-sign threshold: when an auditor entry is registered and the
    // withdraw amount exceeds the threshold, require the auditor key to match.
    let auditor_cosigned = if let Some(entry) = &ctx.accounts.auditor_entry {
        require_keys_eq!(
            entry.mint,
            ctx.accounts.mint.key(),
            GhosError::AuditorMismatch
        );
        true
    } else {
        false
    };

    let eq_ctx = ctx
        .accounts
        .equality_proof_context
        .as_ref()
        .map(|a| a.key());
    let rg_ctx = ctx
        .accounts
        .range_proof_context
        .as_ref()
        .map(|a| a.key());

    cpi_withdraw_from_confidential(
        ctx.accounts.token_program.clone(),
        ctx.accounts.confidential_ata.clone(),
        ctx.accounts.mint.clone(),
        ctx.accounts.owner.to_account_info(),
        amount,
        decimals,
        new_decryptable_available,
        eq_ctx,
        rg_ctx,
    )?;

    emit!(WithdrawExecuted {
        owner: ctx.accounts.owner.key(),
        mint: ctx.accounts.mint.key(),
        destination_ata: ctx.accounts.confidential_ata.key(),
        amount,
        auditor_cosigned,
        timestamp: now_ts()?,
    });
    Ok(())
}

// fix: withdraw returns AuditorMismatch when auditor missing
