//! `destroy_burner` revokes a burner entry and closes the PDA, refunding rent
//! to the owner. Before closing, the caller must prove the underlying
//! confidential account is zero-balance using the zk-token-proof CPI helper.

use anchor_lang::prelude::*;

use crate::constants::{BURNER_SEED, CONFIG_SEED};
use crate::errors::GhosError;
use crate::events::BurnerDestroyed;
use crate::state::{BurnerAccount, GhosConfig};
use crate::utils::validation::{assert_not_paused, now_ts};
use crate::utils::zk::verify_zero_balance;

#[derive(Accounts)]
pub struct DestroyBurner<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, GhosConfig>,

    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        close = owner,
        seeds = [BURNER_SEED, owner.key.as_ref(), &burner_entry.nonce.to_le_bytes()],
        bump = burner_entry.bump,
        has_one = owner,
    )]
    pub burner_entry: Account<'info, BurnerAccount>,

    /// CHECK: zk proof program id validated in `verify_zero_balance`.
    pub zk_proof_program: AccountInfo<'info>,

    /// CHECK: writable proof context account, validated by the CPI.
    #[account(mut)]
    pub proof_context: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<DestroyBurner>, zero_proof_bytes: Vec<u8>) -> Result<()> {
    assert_not_paused(&ctx.accounts.config)?;

    // Enforce that we only destroy entries that either expired naturally, or
    // are being revoked early by the owner via an explicit call.
    let now = now_ts()?;
    let entry = &mut ctx.accounts.burner_entry;
    require!(!entry.revoked, GhosError::BurnerExpired);
    entry.revoked = true;

    // Prove the burner confidential account has zero available balance before
    // closing the registry entry. This avoids orphaning live funds.
    verify_zero_balance(
        ctx.accounts.zk_proof_program.clone(),
        ctx.accounts.proof_context.clone(),
        ctx.accounts.owner.to_account_info(),
        ctx.accounts.system_program.to_account_info(),
        &zero_proof_bytes,
    )?;

    emit!(BurnerDestroyed {
        owner: entry.owner,
        burner: entry.burner_pubkey,
        revoked_at: now,
    });
    Ok(())
}
