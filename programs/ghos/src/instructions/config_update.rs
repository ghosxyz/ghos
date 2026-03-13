//! `config_update` lets the admin adjust the mutable protocol knobs.

use anchor_lang::prelude::*;

use crate::constants::CONFIG_SEED;
use crate::errors::GhosError;
use crate::events::ConfigUpdated;
use crate::state::GhosConfig;
use crate::utils::validation::{assert_admin, now_ts};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub enum ConfigField {
    Paused(bool),
    DustFreeUnit(u64),
    BurnerTtlMax(i64),
    BurnerTtlMin(i64),
    BurnerRegistryCap(u16),
    MixMinParticipants(u8),
    MixMaxParticipants(u8),
    MixRevealWindow(i64),
    AuditorCosignLamports(u64),
    Admin(Pubkey),
}

impl ConfigField {
    pub fn tag(&self) -> u8 {
        match self {
            ConfigField::Paused(_) => 0,
            ConfigField::DustFreeUnit(_) => 1,
            ConfigField::BurnerTtlMax(_) => 2,
            ConfigField::BurnerTtlMin(_) => 3,
            ConfigField::BurnerRegistryCap(_) => 4,
            ConfigField::MixMinParticipants(_) => 5,
            ConfigField::MixMaxParticipants(_) => 6,
            ConfigField::MixRevealWindow(_) => 7,
            ConfigField::AuditorCosignLamports(_) => 8,
            ConfigField::Admin(_) => 9,
        }
    }
}

#[derive(Accounts)]
pub struct ConfigUpdate<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, GhosConfig>,

    pub admin: Signer<'info>,
}

pub fn handler(ctx: Context<ConfigUpdate>, field: ConfigField) -> Result<()> {
    let config = &mut ctx.accounts.config;
    assert_admin(config, &ctx.accounts.admin.key())?;

    let tag = field.tag();
    match field {
        ConfigField::Paused(v) => config.paused = v,
        ConfigField::DustFreeUnit(v) => {
            require!(v > 0, GhosError::AmountBelowDustFloor);
            config.dust_free_unit = v;
        }
        ConfigField::BurnerTtlMax(v) => {
            require!(v > config.burner_ttl_min, GhosError::BurnerTtlOutOfRange);
            config.burner_ttl_max = v;
        }
        ConfigField::BurnerTtlMin(v) => {
            require!(v < config.burner_ttl_max, GhosError::BurnerTtlOutOfRange);
            config.burner_ttl_min = v;
        }
        ConfigField::BurnerRegistryCap(v) => {
            require!(v > 0, GhosError::BurnerCapReached);
            config.burner_registry_cap = v;
        }
        ConfigField::MixMinParticipants(v) => {
            require!(v >= 2, GhosError::MixBelowMinimum);
            config.mix_min_participants = v;
        }
        ConfigField::MixMaxParticipants(v) => {
            require!(
                v >= config.mix_min_participants,
                GhosError::MixBelowMinimum
            );
            config.mix_max_participants = v;
        }
        ConfigField::MixRevealWindow(v) => {
            require!(v > 0, GhosError::MixRevealTimeout);
            config.mix_reveal_window = v;
        }
        ConfigField::AuditorCosignLamports(v) => {
            config.auditor_cosign_lamports = v;
        }
        ConfigField::Admin(v) => {
            config.admin = v;
        }
    }

    let now = now_ts()?;
    config.last_updated = now;

    emit!(ConfigUpdated {
        admin: ctx.accounts.admin.key(),
        field: tag,
        timestamp: now,
    });
    Ok(())
}
