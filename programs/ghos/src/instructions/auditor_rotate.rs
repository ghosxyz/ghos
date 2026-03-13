//! `auditor_rotate` replaces the registered auditor ElGamal pubkey, subject to
//! the rotation cooldown window configured at registration time.

use anchor_lang::prelude::*;

use crate::constants::{AUDITOR_PUBKEY_LEN, AUDITOR_SEED, CONFIG_SEED};
use crate::errors::GhosError;
use crate::events::AuditorRotated;
use crate::state::{AuditorEntry, GhosConfig};
use crate::utils::validation::{assert_admin, assert_not_paused, now_ts};
use crate::utils::zk::verify_auditor_pubkey;

#[derive(Accounts)]
#[instruction(new_auditor_pubkey: [u8; 32])]
pub struct AuditorRotate<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, GhosConfig>,

    #[account(mut)]
    pub admin: Signer<'info>,

    /// CHECK: mint pubkey used only as seed source.
    pub mint: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [AUDITOR_SEED, mint.key.as_ref()],
        bump = auditor_entry.bump,
        has_one = admin,
    )]
    pub auditor_entry: Account<'info, AuditorEntry>,

    /// CHECK: zk-token-proof program
    pub zk_proof_program: AccountInfo<'info>,

    /// CHECK: proof context account for pubkey validity
    #[account(mut)]
    pub proof_context: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<AuditorRotate>,
    new_auditor_pubkey: [u8; AUDITOR_PUBKEY_LEN],
    pubkey_validity_proof: Vec<u8>,
) -> Result<()> {
    assert_not_paused(&ctx.accounts.config)?;
    assert_admin(&ctx.accounts.config, &ctx.accounts.admin.key())?;

    let now = now_ts()?;
    let entry = &mut ctx.accounts.auditor_entry;
    let elapsed = now.saturating_sub(entry.last_rotated_at);
    require!(
        elapsed >= entry.rotation_cooldown,
        GhosError::AuditorRotationTooSoon
    );

    verify_auditor_pubkey(
        ctx.accounts.zk_proof_program.clone(),
        ctx.accounts.proof_context.clone(),
        ctx.accounts.admin.to_account_info(),
        ctx.accounts.system_program.to_account_info(),
        &pubkey_validity_proof,
    )?;

    let old = entry.auditor_pubkey;
    entry.auditor_pubkey = new_auditor_pubkey;
    entry.last_rotated_at = now;

    emit!(AuditorRotated {
        mint: entry.mint,
        old_pubkey: old,
        new_pubkey: new_auditor_pubkey,
        timestamp: now,
    });
    Ok(())
}
