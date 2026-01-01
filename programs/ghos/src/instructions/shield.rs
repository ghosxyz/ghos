//! `shield` moves SPL balance from a public ATA into the owner's confidential
//! pending counter via a Token-2022 CPI.

use anchor_lang::prelude::*;

use crate::constants::CONFIG_SEED;
use crate::errors::GhosError;
use crate::events::ShieldExecuted;
use crate::state::GhosConfig;
use crate::utils::token22::{
    assert_confidential_account, cpi_deposit_to_confidential, is_token_2022_program,
    probe_decimals, read_mint_with_confidential_ext,
};
use crate::utils::validation::{assert_dust_free, assert_not_paused, now_ts};

#[derive(Accounts)]
pub struct Shield<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, GhosConfig>,

    #[account(mut)]
    pub owner: Signer<'info>,

    /// CHECK: Token-2022 validates full semantics; we assert the extension set.
    #[account(mut)]
    pub confidential_ata: AccountInfo<'info>,

    /// CHECK: Token-2022 mint, extension set validated by handler.
    pub mint: AccountInfo<'info>,

    /// CHECK: Token-2022 program, address validated by handler.
    pub token_program: AccountInfo<'info>,
}

pub fn handler(ctx: Context<Shield>, amount: u64) -> Result<()> {
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

    cpi_deposit_to_confidential(
        ctx.accounts.token_program.clone(),
        ctx.accounts.confidential_ata.clone(),
        ctx.accounts.mint.clone(),
        ctx.accounts.owner.to_account_info(),
        amount,
        decimals,
    )?;

    let now = now_ts()?;
    emit!(ShieldExecuted {
        owner: ctx.accounts.owner.key(),
        mint: ctx.accounts.mint.key(),
        source_ata: ctx.accounts.confidential_ata.key(),
        amount_lamports: amount,
        timestamp: now,
    });

    msg!(
        "shield ok, owner={}, mint={}, amount={}",
        ctx.accounts.owner.key(),
        ctx.accounts.mint.key(),
        amount
    );
    Ok(())
}
