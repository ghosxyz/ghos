//! `mix_commit` stores a participant's blinded commitment in an open round.

use anchor_lang::prelude::*;

use crate::constants::{CONFIG_SEED, MIX_COMMITMENT_LEN, MIX_COMMITMENT_SEED};
use crate::errors::GhosError;
use crate::events::MixCommitted;
use crate::state::{GhosConfig, MixCommitment, MixPhase, MixRound};
use crate::utils::validation::{assert_not_paused, now_ts};

#[derive(Accounts)]
pub struct MixCommitAccounts<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, GhosConfig>,

    #[account(mut)]
    pub participant: Signer<'info>,

    #[account(mut)]
    pub round: Account<'info, MixRound>,

    #[account(
        init,
        payer = participant,
        space = MixCommitment::LEN,
        seeds = [MIX_COMMITMENT_SEED, round.key().as_ref(), participant.key.as_ref()],
        bump,
    )]
    pub commitment: Account<'info, MixCommitment>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<MixCommitAccounts>,
    commitment_bytes: [u8; MIX_COMMITMENT_LEN],
) -> Result<()> {
    assert_not_paused(&ctx.accounts.config)?;

    let now = now_ts()?;
    let round = &mut ctx.accounts.round;
    require!(round.phase == MixPhase::Commit, GhosError::MixNotInCommit);
    require!(now < round.commit_close_at, GhosError::MixNotInCommit);
    require!(round.committed < round.capacity, GhosError::MixRoundFull);

    let entry = &mut ctx.accounts.commitment;
    entry.round = round.key();
    entry.participant = ctx.accounts.participant.key();
    entry.commitment = commitment_bytes;
    entry.revealed = false;
    entry.reveal_signal = [0u8; 32];
    entry.index = round.committed;
    entry.committed_at = now;
    entry.revealed_at = 0;
    entry.bump = ctx.bumps.commitment;
    entry.reserved = [0u8; 16];

    round.committed = round.committed.saturating_add(1);
    if round.committed == round.capacity || now >= round.commit_close_at {
        round.phase = MixPhase::Reveal;
    }

    emit!(MixCommitted {
        round: round.key(),
        participant: entry.participant,
        commitment: commitment_bytes,
        index: entry.index,
    });
    Ok(())
}

// refactor: consolidate mix_commit PDA seed derivation
