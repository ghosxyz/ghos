"""Program derived address helpers.

Each function in this module corresponds to a PDA seed declared in the
on-chain `constants.rs`. The return value is a tuple of `(pubkey, bump)`,
matching what Anchor's `Pubkey::find_program_address` returns, so callers
can pass the bump into an instruction that expects it.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from solders.pubkey import Pubkey

from ghos_cli.constants import (
    AUDITOR_SEED,
    BURNER_SEED,
    CONFIG_SEED,
    MIX_COMMITMENT_SEED,
    MIX_ROUND_SEED,
    PADDING_VAULT_SEED,
    PROGRAM_ID,
)

if TYPE_CHECKING:
    pass


def _program_pubkey() -> Pubkey:
    """Return the ghos program id as a `Pubkey` instance."""
    return Pubkey.from_string(PROGRAM_ID)


def config_pda() -> tuple[Pubkey, int]:
    """Derive the singleton protocol config PDA."""
    return Pubkey.find_program_address([CONFIG_SEED], _program_pubkey())


def burner_pda(owner: Pubkey, nonce: int) -> tuple[Pubkey, int]:
    """Derive the burner registry PDA for (owner, nonce).

    Args:
        owner: base58 address that owns the burner entry.
        nonce: 64-bit unsigned integer nonce selecting between concurrent
            burner slots owned by the same user.
    """
    if nonce < 0 or nonce >> 64 != 0:
        raise ValueError(f"burner nonce out of u64 range: {nonce}")
    nonce_bytes = int(nonce).to_bytes(8, byteorder="little", signed=False)
    return Pubkey.find_program_address(
        [BURNER_SEED, bytes(owner), nonce_bytes],
        _program_pubkey(),
    )


def mix_round_pda(mint: Pubkey, host: Pubkey, round_id: int) -> tuple[Pubkey, int]:
    """Derive the CoinJoin round PDA.

    `round_id` is a host-chosen monotonic nonce so the same host may run
    multiple rounds for the same mint without seed collisions.
    """
    if round_id < 0 or round_id >> 64 != 0:
        raise ValueError(f"round_id out of u64 range: {round_id}")
    round_bytes = int(round_id).to_bytes(8, byteorder="little", signed=False)
    return Pubkey.find_program_address(
        [MIX_ROUND_SEED, bytes(mint), bytes(host), round_bytes],
        _program_pubkey(),
    )


def mix_commitment_pda(
    round_account: Pubkey,
    participant: Pubkey,
) -> tuple[Pubkey, int]:
    """Derive the per-participant commitment PDA inside a mix round."""
    return Pubkey.find_program_address(
        [MIX_COMMITMENT_SEED, bytes(round_account), bytes(participant)],
        _program_pubkey(),
    )


def auditor_pda(mint: Pubkey) -> tuple[Pubkey, int]:
    """Derive the per-mint auditor registry PDA."""
    return Pubkey.find_program_address(
        [AUDITOR_SEED, bytes(mint)],
        _program_pubkey(),
    )


def padding_vault_pda(mint: Pubkey) -> tuple[Pubkey, int]:
    """Derive the per-mint padding vault PDA used by the shield flow."""
    return Pubkey.find_program_address(
        [PADDING_VAULT_SEED, bytes(mint)],
        _program_pubkey(),
    )


def describe_pdas(owner: Pubkey, mint: Pubkey) -> dict[str, str]:
    """Produce a flat dictionary of every PDA relevant to (owner, mint).

    Used by the `ghos status` command to render a tree of addresses
    without repeating the derivation logic in the command module.
    """
    config_addr, _ = config_pda()
    auditor_addr, _ = auditor_pda(mint)
    padding_addr, _ = padding_vault_pda(mint)
    burner0, _ = burner_pda(owner, 0)
    return {
        "config": str(config_addr),
        "auditor": str(auditor_addr),
        "padding_vault": str(padding_addr),
        "burner_0": str(burner0),
    }
