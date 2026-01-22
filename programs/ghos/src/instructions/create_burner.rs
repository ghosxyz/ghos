//! `create_burner` registers an ephemeral keypair in the burner registry.
//!
//! The burner PDA is keyed by `[BURNER_SEED, owner, nonce]`. `nonce` is a
//! monotonically increasing per-owner counter maintained off-chain by the SDK;
//! on-chain we only guard that the PDA does not already exist.

use anchor_lang::prelude::*;

use crate::constants::{BURNER_SEED, CONFIG_SEED};
use crate::events::BurnerCreated;
use crate::state::{BurnerAccount, GhosConfig};
use crate::utils::validation::{assert_not_paused, now_ts, validate_burner_ttl};

#[derive(Accounts)]
#[instruction(nonce: u64, ttl_seconds: i64)]
pub struct CreateBurner<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, GhosConfig>,

    #[account(mut)]
    pub owner: Signer<'info>,

    /// The burner public key being registered. Not a signer here; the owner
    /// attests it through their signature.
    /// CHECK: just a pubkey recorded in state.
    pub burner_pubkey: AccountInfo<'info>,

    #[account(
        init,
        payer = owner,
        space = BurnerAccount::LEN,
        seeds = [BURNER_SEED, owner.key.as_ref(), &nonce.to_le_bytes()],
        bump,
    )]
    pub burner_entry: Account<'info, BurnerAccount>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<CreateBurner>, nonce: u64, ttl_seconds: i64) -> Result<()> {
    assert_not_paused(&ctx.accounts.config)?;
    validate_burner_ttl(ttl_seconds)?;

    let now = now_ts()?;
    let entry = &mut ctx.accounts.burner_entry;
    entry.owner = ctx.accounts.owner.key();
    entry.burner_pubkey = ctx.accounts.burner_pubkey.key();
    entry.created_at = now;
    entry.expires_at = now.saturating_add(ttl_seconds);
    entry.nonce = nonce;
    entry.revoked = false;
    entry.usage_count = 0;
    entry.bump = ctx.bumps.burner_entry;
    entry.reserved = [0u8; 16];

    emit!(BurnerCreated {
        owner: entry.owner,
        burner: entry.burner_pubkey,
        ttl_seconds,
        expires_at: entry.expires_at,
    });
    Ok(())
}
