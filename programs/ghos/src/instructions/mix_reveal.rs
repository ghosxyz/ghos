//! `mix_reveal` validates a participant's reveal against their prior commit.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hashv;

use crate::constants::{CONFIG_SEED, MIX_COMMITMENT_LEN, MIX_COMMITMENT_SEED};
use crate::errors::GhosError;
use crate::events::MixRevealed;
use crate::state::{GhosConfig, MixCommitment, MixPhase, MixRound};
use crate::utils::validation::{assert_not_paused, now_ts};

#[derive(Accounts)]
pub struct MixRevealAccounts<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, GhosConfig>,

    #[account(mut)]
    pub participant: Signer<'info>,

    #[account(mut)]
    pub round: Account<'info, MixRound>,

    #[account(
        mut,
        seeds = [MIX_COMMITMENT_SEED, round.key().as_ref(), participant.key.as_ref()],
        bump = commitment.bump,
    )]
    pub commitment: Account<'info, MixCommitment>,
}

pub fn handler(
    ctx: Context<MixRevealAccounts>,
    preimage: Vec<u8>,
    reveal_signal: [u8; 32],
) -> Result<()> {
    assert_not_paused(&ctx.accounts.config)?;

    let round = &mut ctx.accounts.round;
    let now = now_ts()?;
    require!(round.phase == MixPhase::Reveal, GhosError::MixNotInReveal);
    require!(now <= round.reveal_close_at, GhosError::MixRevealTimeout);

    let commit = &mut ctx.accounts.commitment;
    require!(!commit.revealed, GhosError::MixAlreadyCommitted);
    require_keys_eq!(commit.participant, ctx.accounts.participant.key());

    let digest = hashv(&[&preimage, &reveal_signal]).to_bytes();
    let expected: [u8; MIX_COMMITMENT_LEN] = digest;
    require!(
        expected == commit.commitment,
        GhosError::MixRevealMismatch
    );

    commit.revealed = true;
    commit.reveal_signal = reveal_signal;
    commit.revealed_at = now;
    round.revealed = round.revealed.saturating_add(1);

    if round.revealed == round.committed {
        round.phase = MixPhase::Settling;
    }

    emit!(MixRevealed {
        round: round.key(),
        participant: commit.participant,
        index: commit.index,
    });
    Ok(())
}

// perf: avoid redundant borsh decode in mix_reveal
