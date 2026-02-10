"""Tests for PDA derivation.

These tests only verify internal consistency: the same inputs produce
the same PDA, different inputs produce different PDAs, and bumps are in
range. Cross-language agreement (CLI vs TypeScript SDK vs Rust) is
covered by the integration suite in `tests/`.
"""

from __future__ import annotations

import pytest
from solders.pubkey import Pubkey

from ghos_cli.constants import PROGRAM_ID
from ghos_cli.pdas import (
    auditor_pda,
    burner_pda,
    config_pda,
    describe_pdas,
    mix_commitment_pda,
    mix_round_pda,
    padding_vault_pda,
)


def _fake_pubkey(seed: int) -> Pubkey:
    """Return a deterministic 32-byte pubkey for tests."""
    raw = bytearray(32)
    raw[0] = seed & 0xFF
    raw[1] = (seed >> 8) & 0xFF
    return Pubkey.from_bytes(bytes(raw))


def test_config_pda_is_deterministic() -> None:
    a, ba = config_pda()
    b, bb = config_pda()
    assert a == b
    assert ba == bb


def test_config_pda_bump_is_valid_byte() -> None:
    _, bump = config_pda()
    assert 0 <= bump <= 255


def test_burner_pda_is_deterministic_for_same_inputs() -> None:
    owner = _fake_pubkey(1)
    a, ba = burner_pda(owner, 5)
    b, bb = burner_pda(owner, 5)
    assert a == b
    assert ba == bb


def test_burner_pda_differs_by_nonce() -> None:
    owner = _fake_pubkey(2)
    a, _ = burner_pda(owner, 0)
    b, _ = burner_pda(owner, 1)
    assert a != b


def test_burner_pda_differs_by_owner() -> None:
    a, _ = burner_pda(_fake_pubkey(1), 0)
    b, _ = burner_pda(_fake_pubkey(2), 0)
    assert a != b


def test_burner_pda_rejects_out_of_range_nonce() -> None:
    owner = _fake_pubkey(1)
    with pytest.raises(ValueError):
        burner_pda(owner, -1)
    with pytest.raises(ValueError):
        burner_pda(owner, 1 << 64)


def test_mix_round_pda_varies_per_round_id() -> None:
    mint = _fake_pubkey(10)
    host = _fake_pubkey(11)
    a, _ = mix_round_pda(mint, host, 0)
    b, _ = mix_round_pda(mint, host, 1)
    assert a != b


def test_mix_commitment_pda_differs_per_participant() -> None:
    round_addr = _fake_pubkey(100)
    a, _ = mix_commitment_pda(round_addr, _fake_pubkey(1))
    b, _ = mix_commitment_pda(round_addr, _fake_pubkey(2))
    assert a != b


def test_auditor_pda_is_deterministic() -> None:
    mint = _fake_pubkey(42)
    a, ba = auditor_pda(mint)
    b, bb = auditor_pda(mint)
    assert a == b
    assert ba == bb


def test_auditor_pda_differs_per_mint() -> None:
    a, _ = auditor_pda(_fake_pubkey(42))
    b, _ = auditor_pda(_fake_pubkey(43))
    assert a != b


def test_padding_vault_pda_is_deterministic() -> None:
    mint = _fake_pubkey(5)
    a, _ = padding_vault_pda(mint)
    b, _ = padding_vault_pda(mint)
    assert a == b


def test_describe_pdas_returns_all_labels() -> None:
    mapping = describe_pdas(_fake_pubkey(1), _fake_pubkey(2))
    for key in ("config", "auditor", "padding_vault", "burner_0"):
        assert key in mapping


def test_describe_pdas_values_are_base58() -> None:
    mapping = describe_pdas(_fake_pubkey(1), _fake_pubkey(2))
    for value in mapping.values():
        assert 32 <= len(value) <= 44
        assert all(ch.isalnum() for ch in value)


def test_config_pda_program_id_matches_constant() -> None:
    program = Pubkey.from_string(PROGRAM_ID)
    addr, bump = Pubkey.find_program_address([b"ghos.config"], program)
    c_addr, c_bump = config_pda()
    assert addr == c_addr
    assert bump == c_bump
