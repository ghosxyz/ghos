"""Tests for amount and duration parsing."""

from __future__ import annotations

import pytest

from ghos_cli.errors import InvalidAmountError, InvalidDurationError
from ghos_cli.units import (
    format_amount,
    format_duration,
    format_lamports,
    parse_amount,
    parse_duration,
    short_pubkey,
)


def test_parse_amount_basic_six_decimals() -> None:
    assert parse_amount("1.0", 6) == 1_000_000


def test_parse_amount_rejects_extra_precision() -> None:
    with pytest.raises(InvalidAmountError):
        parse_amount("1.0000001", 6)


def test_parse_amount_rejects_zero() -> None:
    with pytest.raises(InvalidAmountError):
        parse_amount("0", 6)


def test_parse_amount_rejects_negative() -> None:
    with pytest.raises(InvalidAmountError):
        parse_amount("-0.5", 6)


def test_parse_amount_rejects_below_dust_floor() -> None:
    # 0.0001 at 6 decimals = 100 base units, below 1000 floor
    with pytest.raises(InvalidAmountError):
        parse_amount("0.0001", 6)


def test_parse_amount_accepts_at_dust_floor() -> None:
    assert parse_amount("0.001", 6) == 1_000


def test_parse_amount_rejects_unaligned_to_dust_unit() -> None:
    # 1.001500 at 6 decimals = 1_001_500 base units, not divisible by 1000
    # Actually 1_001_500 % 1000 = 500, not aligned
    with pytest.raises(InvalidAmountError):
        parse_amount("1.0015", 6)


def test_parse_amount_rejects_non_finite() -> None:
    with pytest.raises(InvalidAmountError):
        parse_amount("NaN", 6)


def test_parse_amount_rejects_invalid_decimals() -> None:
    with pytest.raises(InvalidAmountError):
        parse_amount("1.0", -1)
    with pytest.raises(InvalidAmountError):
        parse_amount("1.0", 50)


def test_format_amount_preserves_trailing_zeros() -> None:
    assert format_amount(1_000_000, 6) == "1.000000"


def test_format_amount_zero_decimals() -> None:
    assert format_amount(42, 0) == "42"


def test_format_amount_large_decimals() -> None:
    assert format_amount(10**18, 18) == "1.000000000000000000"


def test_format_amount_and_parse_roundtrip() -> None:
    parsed = parse_amount("12.345000", 6)
    formatted = format_amount(parsed, 6)
    assert formatted == "12.345000"


def test_parse_duration_accepts_all_units() -> None:
    assert parse_duration("900s") == 900
    assert parse_duration("30m") == 30 * 60
    assert parse_duration("24h") == 24 * 3600
    assert parse_duration("7d") == 7 * 86400


def test_parse_duration_is_case_insensitive() -> None:
    assert parse_duration("24H") == 24 * 3600


def test_parse_duration_rejects_negative() -> None:
    with pytest.raises(InvalidDurationError):
        parse_duration("-30m")


def test_parse_duration_rejects_above_cap() -> None:
    # 31 days = 31 * 86400 = 2_678_400 > 2_592_000
    with pytest.raises(InvalidDurationError):
        parse_duration("31d")


def test_parse_duration_rejects_empty() -> None:
    with pytest.raises(InvalidDurationError):
        parse_duration("")


def test_parse_duration_rejects_garbage() -> None:
    with pytest.raises(InvalidDurationError):
        parse_duration("two hours")


def test_parse_duration_rejects_below_floor() -> None:
    with pytest.raises(InvalidDurationError):
        parse_duration("30s")


def test_format_duration_picks_largest_unit() -> None:
    assert format_duration(24 * 3600) == "1d"
    assert format_duration(7200) == "2h"
    assert format_duration(180) == "3m"
    assert format_duration(59) == "59s"


def test_format_duration_zero_is_zero_seconds() -> None:
    assert format_duration(0) == "0s"


def test_format_duration_roundtrip_on_boundary() -> None:
    original = "7d"
    seconds = parse_duration(original)
    assert format_duration(seconds) == original


def test_format_lamports_is_nine_decimals() -> None:
    assert format_lamports(1_000_000_000) == "1.000000000"


def test_short_pubkey_abbreviates_long_string() -> None:
    key = "a" * 44
    out = short_pubkey(key, 4, 4)
    assert out == "aaaa...aaaa"


def test_short_pubkey_returns_full_if_short_enough() -> None:
    key = "shortkey"
    assert short_pubkey(key, 4, 4) == key
