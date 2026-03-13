//! `auditor_register` adds a per-mint auditor ElGamal pubkey entry.
//!
//! Registration requires the admin's signature (for the moment; future
//! versions may allow mint authorities to opt-in independently). The auditor
//! pubkey is proven valid via the `PubkeyValidity` proof kind.

use anchor_lang::prelude::*;

use crate::constants::{AUDITOR_PUBKEY_LEN, AUDITOR_SEED, CONFIG_SEED};
use crate::events::AuditorRegistered;
use crate::state::{AuditorEntry, GhosConfig};
use crate::utils::validation::{assert_admin, assert_not_paused, now_ts};
use crate::utils::zk::verify_auditor_pubkey;

#[derive(Accounts)]
#[instruction(auditor_pubkey: [u8; 32])]
pub struct AuditorRegister<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, GhosConfig>,

    #[account(mut)]
    pub admin: Signer<'info>,

    /// CHECK: Token-2022 mint. Only its pubkey is used here as PDA seed.
    pub mint: AccountInfo<'info>,

    #[account(
        init,
        payer = admin,
        space = AuditorEntry::LEN,
        seeds = [AUDITOR_SEED, mint.key.as_ref()],
        bump,
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
    ctx: Context<AuditorRegister>,
    auditor_pubkey: [u8; AUDITOR_PUBKEY_LEN],
    pubkey_validity_proof: Vec<u8>,
    rotation_cooldown: i64,
) -> Result<()> {
    assert_not_paused(&ctx.accounts.config)?;
    assert_admin(&ctx.accounts.config, &ctx.accounts.admin.key())?;

    verify_auditor_pubkey(
        ctx.accounts.zk_proof_program.clone(),
        ctx.accounts.proof_context.clone(),
        ctx.accounts.admin.to_account_info(),
        ctx.accounts.system_program.to_account_info(),
        &pubkey_validity_proof,
    )?;

    let now = now_ts()?;
    let entry = &mut ctx.accounts.auditor_entry;
    entry.mint = ctx.accounts.mint.key();
    entry.auditor_pubkey = auditor_pubkey;
    entry.registered_at = now;
    entry.last_rotated_at = now;
    entry.rotation_cooldown = rotation_cooldown;
    entry.admin = ctx.accounts.admin.key();
    entry.bump = ctx.bumps.auditor_entry;
    entry.reserved = [0u8; 16];

    emit!(AuditorRegistered {
        mint: entry.mint,
        auditor_pubkey,
        admin: entry.admin,
        timestamp: now,
    });
    Ok(())
}
