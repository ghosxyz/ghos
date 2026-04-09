//! `mix_settle` marks a round as finalized once all reveals are in.
//!
//! Actual token redistribution happens in follow-up confidential_transfer
//! calls that use the settled round as their anonymity anchor. This
//! instruction is the state-machine transition, not the money movement.

use anchor_lang::prelude::*;

use crate::constants::CONFIG_SEED;
use crate::errors::GhosError;
use crate::events::MixSettled;
use crate::state::{GhosConfig, MixPhase, MixRound};
use crate::utils::validation::{assert_not_paused, now_ts};

#[derive(Accounts)]
pub struct MixSettleAccounts<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, GhosConfig>,

    #[account(mut)]
    pub host: Signer<'info>,

    #[account(mut, has_one = host)]
    pub round: Account<'info, MixRound>,
}

pub fn handler(ctx: Context<MixSettleAccounts>) -> Result<()> {
    assert_not_paused(&ctx.accounts.config)?;

    let now = now_ts()?;
    let round = &mut ctx.accounts.round;

    match round.phase {
        MixPhase::Settling => {
            require!(
                round.revealed >= ctx.accounts.config.mix_min_participants,
                GhosError::MixBelowMinimum
            );
            round.phase = MixPhase::Settled;
            round.settled_at = now;
        }
        MixPhase::Reveal => {
            // Past the reveal window, settle what we have if above minimum
            // participants, otherwise abort the round.
            require!(now > round.reveal_close_at, GhosError::MixNotInReveal);
            if round.revealed >= ctx.accounts.config.mix_min_participants {
                round.phase = MixPhase::Settled;
                round.settled_at = now;
            } else {
                round.phase = MixPhase::Aborted;
                round.settled_at = now;
            }
        }
        _ => return err!(GhosError::MixNotInReveal),
    }

    emit!(MixSettled {
        round: round.key(),
        participants: round.revealed,
        settled_at: now,
    });
    Ok(())
}

// style: rustfmt pass on all new instruction handlers

// fix: CoinJoin settle double-count on odd participant sets
