//! `apply_pending` moves the pending confidential counter into the available
//! counter for the caller's Token-2022 confidential account.

use anchor_lang::prelude::*;

use crate::constants::CONFIG_SEED;
use crate::errors::GhosError;
use crate::events::PendingApplied;
use crate::state::GhosConfig;
use crate::utils::token22::{
    assert_confidential_account, cpi_apply_pending_balance, is_token_2022_program,
};
use crate::utils::validation::{assert_not_paused, now_ts};

#[derive(Accounts)]
pub struct ApplyPending<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, GhosConfig>,

    #[account(mut)]
    pub owner: Signer<'info>,

    /// CHECK: Token-2022 account, extension validated by handler.
    #[account(mut)]
    pub confidential_ata: AccountInfo<'info>,

    /// CHECK: Token-2022 mint.
    pub mint: AccountInfo<'info>,

    /// CHECK: Token-2022 program id.
    pub token_program: AccountInfo<'info>,
}

pub fn handler(
    ctx: Context<ApplyPending>,
    expected_pending_counter: u64,
    new_decryptable_available: [u8; 36],
) -> Result<()> {
    assert_not_paused(&ctx.accounts.config)?;
    require!(
        is_token_2022_program(&ctx.accounts.token_program.key()),
        GhosError::MintWrongProgramOwner
    );
    require!(expected_pending_counter > 0, GhosError::NothingToApply);

    assert_confidential_account(
        &ctx.accounts.confidential_ata,
        &ctx.accounts.mint.key(),
        &ctx.accounts.owner.key(),
    )?;

    cpi_apply_pending_balance(
        ctx.accounts.token_program.clone(),
        ctx.accounts.confidential_ata.clone(),
        ctx.accounts.owner.to_account_info(),
        expected_pending_counter,
        new_decryptable_available,
    )?;

    emit!(PendingApplied {
        owner: ctx.accounts.owner.key(),
        mint: ctx.accounts.mint.key(),
        applied_counter: expected_pending_counter,
        timestamp: now_ts()?,
    });
    Ok(())
}

// fix: apply_pending rejects zero expected_pending_counter
