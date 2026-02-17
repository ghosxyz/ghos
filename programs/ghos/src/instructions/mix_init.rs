//! `mix_init` opens a new CoinJoin round with a fixed denomination.

use anchor_lang::prelude::*;

use crate::constants::{CONFIG_SEED, MIX_ROUND_SEED};
use crate::errors::GhosError;
use crate::events::MixRoundOpened;
use crate::state::{GhosConfig, MixPhase, MixRound};
use crate::utils::validation::{assert_not_paused, now_ts, validate_mix_capacity};

#[derive(Accounts)]
#[instruction(round_id: u64, denomination: u64, capacity: u8)]
pub struct MixInit<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, GhosConfig>,

    #[account(mut)]
    pub host: Signer<'info>,

    /// CHECK: Token-2022 mint, used only for PDA derivation.
    pub mint: AccountInfo<'info>,

    #[account(
        init,
        payer = host,
        space = MixRound::LEN,
        seeds = [MIX_ROUND_SEED, mint.key.as_ref(), &round_id.to_le_bytes()],
        bump,
    )]
    pub round: Account<'info, MixRound>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<MixInit>,
    _round_id: u64,
    denomination: u64,
    capacity: u8,
    commit_window_seconds: i64,
) -> Result<()> {
    assert_not_paused(&ctx.accounts.config)?;
    validate_mix_capacity(capacity)?;
    require!(denomination > 0, GhosError::MixDenominationMismatch);
    require!(commit_window_seconds > 0, GhosError::MixRevealTimeout);

    let now = now_ts()?;
    let round = &mut ctx.accounts.round;
    round.mint = ctx.accounts.mint.key();
    round.denomination = denomination;
    round.host = ctx.accounts.host.key();
    round.capacity = capacity;
    round.committed = 0;
    round.revealed = 0;
    round.phase = MixPhase::Commit;
    round.opened_at = now;
    round.commit_close_at = now.saturating_add(commit_window_seconds);
    round.reveal_close_at = round
        .commit_close_at
        .saturating_add(ctx.accounts.config.mix_reveal_window);
    round.settled_at = 0;
    round.bump = ctx.bumps.round;
    round.reserved = [0u8; 32];

    emit!(MixRoundOpened {
        round: round.key(),
        mint: round.mint,
        denomination,
        capacity,
        opened_at: now,
    });
    Ok(())
}
