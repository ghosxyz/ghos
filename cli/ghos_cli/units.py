"""Amount parsing, formatting, and duration helpers.

All ghos flows operate in base units (integer lamports or integer token
units, depending on mint decimals). Users type decimal amounts on the
command line, so we need a round-trip between `Decimal` input and integer
base units with strict rejection of anything that would introduce dust or
require rounding.
"""

from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation, localcontext
from typing import Final

from ghos_cli.constants import (
    BURNER_TTL_MAX_SECONDS,
    BURNER_TTL_MIN_SECONDS,
    DUST_FREE_UNIT,
)
from ghos_cli.errors import InvalidAmountError, InvalidDurationError

# Max supported mint decimals. Token-2022 allows up to 9; we conservatively
# accept up to 18 to cover wrapped assets that sometimes expose more.
MAX_DECIMALS: Final[int] = 18


def parse_amount(value: str, decimals: int) -> int:
    """Convert a human-readable decimal amount into integer base units.

    The result is checked against the dust-free unit: amounts must be
    strictly positive, exactly representable at the given decimals, and
    aligned to `DUST_FREE_UNIT` when the decimals imply dust risk.

    Args:
        value: the user input, e.g. "1.25" or "0.000001".
        decimals: the mint's decimals field.

    Raises:
        InvalidAmountError: if parsing or rounding rules are violated.
    """
    if not isinstance(value, str):
        raise InvalidAmountError(f"amount must be a string, got {type(value).__name__}")
    stripped = value.strip()
    if not stripped:
        raise InvalidAmountError("amount is empty")
    if decimals < 0 or decimals > MAX_DECIMALS:
        raise InvalidAmountError(f"decimals out of range: {decimals}")

    try:
        with localcontext() as ctx:
            ctx.prec = 60
            quantum = Decimal(10) ** -decimals
            parsed = Decimal(stripped)
            if parsed.is_nan() or parsed.is_infinite():
                raise InvalidAmountError(f"amount is not finite: {stripped}")
            if parsed <= 0:
                raise InvalidAmountError(f"amount must be positive: {stripped}")
            quantized = parsed.quantize(quantum)
            if quantized != parsed:
                raise InvalidAmountError(
                    f"amount {stripped!r} has more precision than mint decimals={decimals}"
                )
            scaled = parsed * (Decimal(10) ** decimals)
            if scaled != scaled.to_integral_value():
                raise InvalidAmountError(
                    f"amount {stripped!r} does not scale cleanly to base units at decimals={decimals}"
                )
            base_units = int(scaled)
    except InvalidOperation as exc:
        raise InvalidAmountError(f"amount is not a valid decimal: {stripped}") from exc

    if base_units <= 0:
        raise InvalidAmountError("amount resolved to zero or negative base units")

    if base_units < DUST_FREE_UNIT:
        raise InvalidAmountError(
            f"amount {base_units} is below the dust-free floor of {DUST_FREE_UNIT} base units"
        )
    if base_units % DUST_FREE_UNIT != 0:
        raise InvalidAmountError(
            f"amount {base_units} is not aligned to dust-free unit {DUST_FREE_UNIT}"
        )
    return base_units


def format_amount(base_units: int, decimals: int) -> str:
    """Render integer base units as a decimal string with the mint's scale.

    Trailing zeros are preserved up to `decimals` to make different amounts
    visually comparable in tables.
    """
    if base_units < 0:
        raise InvalidAmountError(f"cannot format negative base units: {base_units}")
    if decimals < 0 or decimals > MAX_DECIMALS:
        raise InvalidAmountError(f"decimals out of range: {decimals}")
    with localcontext() as ctx:
        ctx.prec = 60
        scale = Decimal(10) ** decimals
        value = Decimal(base_units) / scale
        quantized = value.quantize(Decimal(10) ** -decimals)
        text = format(quantized, "f")
    if decimals == 0:
        return text.split(".")[0]
    if "." not in text:
        text = f"{text}.{'0' * decimals}"
    else:
        left, right = text.split(".", 1)
        if len(right) < decimals:
            right = right + "0" * (decimals - len(right))
        elif len(right) > decimals:
            right = right[:decimals]
        text = f"{left}.{right}"
    return text


_DURATION_PATTERN: Final[re.Pattern[str]] = re.compile(
    r"^(?P<num>\d+)(?P<unit>s|m|h|d)$",
    re.IGNORECASE,
)

_UNIT_SECONDS: Final[dict[str, int]] = {
    "s": 1,
    "m": 60,
    "h": 60 * 60,
    "d": 60 * 60 * 24,
}


def parse_duration(value: str) -> int:
    """Parse a duration string like `24h`, `30m`, `7d`, `900s` into seconds.

    Negative values are rejected outright. The result is also bounded to
    `BURNER_TTL_MAX_SECONDS` and `BURNER_TTL_MIN_SECONDS` so this function
    can be used as-is for burner creation, which is its primary caller.
    """
    if not isinstance(value, str):
        raise InvalidDurationError(f"duration must be a string, got {type(value).__name__}")
    stripped = value.strip().lower()
    if not stripped:
        raise InvalidDurationError("duration is empty")
    if stripped.startswith("-"):
        raise InvalidDurationError(f"duration must not be negative: {value!r}")
    match = _DURATION_PATTERN.match(stripped)
    if match is None:
        raise InvalidDurationError(
            f"duration {value!r} is not recognized, use forms like '24h', '30m', '7d', or '900s'"
        )
    num = int(match.group("num"))
    unit = match.group("unit").lower()
    if unit not in _UNIT_SECONDS:
        raise InvalidDurationError(f"unknown duration unit: {unit!r}")
    total = num * _UNIT_SECONDS[unit]
    if total < BURNER_TTL_MIN_SECONDS:
        raise InvalidDurationError(
            f"duration {value!r} is below the floor of {BURNER_TTL_MIN_SECONDS}s"
        )
    if total > BURNER_TTL_MAX_SECONDS:
        raise InvalidDurationError(
            f"duration {value!r} exceeds the cap of {BURNER_TTL_MAX_SECONDS}s (30 days)"
        )
    return total


def format_duration(seconds: int) -> str:
    """Render an integer seconds count as the shortest equivalent suffix form.

    Round trips `parse_duration(format_duration(x)) == x` when `x` falls
    exactly on a unit boundary. Non-boundary values fall back to seconds.
    """
    if seconds < 0:
        raise InvalidDurationError(f"cannot format negative duration: {seconds}")
    if seconds == 0:
        return "0s"
    if seconds % _UNIT_SECONDS["d"] == 0:
        return f"{seconds // _UNIT_SECONDS['d']}d"
    if seconds % _UNIT_SECONDS["h"] == 0:
        return f"{seconds // _UNIT_SECONDS['h']}h"
    if seconds % _UNIT_SECONDS["m"] == 0:
        return f"{seconds // _UNIT_SECONDS['m']}m"
    return f"{seconds}s"


def format_lamports(lamports: int) -> str:
    """Render lamports as a SOL amount string with 9 decimals.

    This is a convenience wrapper around `format_amount` that hardcodes
    SOL's 9 decimals. Used for status and fee rendering.
    """
    return format_amount(lamports, 9)


def short_pubkey(pubkey: str, left: int = 4, right: int = 4) -> str:
    """Abbreviate a base58 public key for table display.

    Returns the full key if it is already short enough. The output always
    contains a literal ellipsis so it can be parsed back as a display string
    rather than an address.
    """
    if left < 0 or right < 0:
        raise ValueError("left and right must be non-negative")
    total = left + right + 3
    if len(pubkey) <= total:
        return pubkey
    return f"{pubkey[:left]}...{pubkey[-right:]}"
