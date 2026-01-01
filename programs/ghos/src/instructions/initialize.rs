//! `initialize` creates the singleton `GhosConfig` PDA and records the admin.

use anchor_lang::prelude::*;

use crate::constants::{
    AUDITOR_COSIGN_LAMPORTS, BURNER_REGISTRY_CAP_PER_OWNER, BURNER_TTL_MAX_SECONDS,
    BURNER_TTL_MIN_SECONDS, CONFIG_SEED, DUST_FREE_UNIT, MIX_MAX_PARTICIPANTS,
    MIX_MIN_PARTICIPANTS, MIX_REVEAL_WINDOW_SECONDS, PROTOCOL_VERSION,
};
use crate::events::ConfigInitialized;
use crate::state::GhosConfig;
use crate::utils::validation::now_ts;

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = admin,
        space = GhosConfig::LEN,
        seeds = [CONFIG_SEED],
        bump,
    )]
    pub config: Account<'info, GhosConfig>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Initialize>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let now = now_ts()?;

    config.admin = ctx.accounts.admin.key();
    config.version = PROTOCOL_VERSION;
    config.paused = false;
    config.dust_free_unit = DUST_FREE_UNIT;
    config.burner_ttl_max = BURNER_TTL_MAX_SECONDS;
    config.burner_ttl_min = BURNER_TTL_MIN_SECONDS;
    config.burner_registry_cap = BURNER_REGISTRY_CAP_PER_OWNER;
    config.mix_min_participants = MIX_MIN_PARTICIPANTS;
    config.mix_max_participants = MIX_MAX_PARTICIPANTS;
    config.mix_reveal_window = MIX_REVEAL_WINDOW_SECONDS;
    config.auditor_cosign_lamports = AUDITOR_COSIGN_LAMPORTS;
    config.last_updated = now;
    config.bump = ctx.bumps.config;
    config.reserved = [0u8; 64];

    emit!(ConfigInitialized {
        admin: config.admin,
        version: config.version,
        timestamp: now,
    });

    msg!(
        "ghos initialized, version=0x{:04X}, admin={}",
        PROTOCOL_VERSION,
        config.admin
    );
    Ok(())
}
