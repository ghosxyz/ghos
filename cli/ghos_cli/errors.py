"""CLI-side error hierarchy.

Errors in this module are raised by command handlers and caught by the
top-level CLI entry, which formats them using rich. The goal is to always
exit with a clean message and a sensible exit code, never a traceback,
unless the user passed `--debug`.
"""

from __future__ import annotations


class GhosCliError(Exception):
    """Root of every CLI-specific exception.

    The `exit_code` attribute is consumed by the Typer callback in `cli.py`
    so that automation can distinguish classes of failure from the shell.
    """

    exit_code: int = 1

    def __init__(self, message: str, *, exit_code: int | None = None) -> None:
        super().__init__(message)
        self.message = message
        if exit_code is not None:
            self.exit_code = exit_code


class ConfigError(GhosCliError):
    """Something in `~/.config/ghos/config.toml` (or the env overrides) is wrong."""

    exit_code = 2


class KeypairError(GhosCliError):
    """Failed to load a Solana keypair from disk."""

    exit_code = 3


class RpcError(GhosCliError):
    """A Solana RPC call returned an error or the transport failed."""

    exit_code = 4


class TransactionError(GhosCliError):
    """Transaction was signed and submitted but failed on chain or in simulation."""

    exit_code = 5


class InvalidAmountError(GhosCliError):
    """User-provided amount violates dust-free rules or decimal scale."""

    exit_code = 6


class InvalidDurationError(GhosCliError):
    """User-provided TTL string did not parse as a valid duration."""

    exit_code = 7


class ProtocolVersionError(GhosCliError):
    """The on-chain protocol version does not match what this CLI supports."""

    exit_code = 8


class NotFoundError(GhosCliError):
    """An account or entity expected to exist on chain did not."""

    exit_code = 9


class CryptoError(GhosCliError):
    """ElGamal key derivation, ciphertext parsing, or commitment hashing failed."""

    exit_code = 10


class MixError(GhosCliError):
    """A CoinJoin mixing round could not proceed in the requested phase."""

    exit_code = 11


class AuditorError(GhosCliError):
    """An auditor registry operation violated cooldown or key-shape rules."""

    exit_code = 12


class UnsupportedClusterError(GhosCliError):
    """Cluster name did not resolve to a known RPC endpoint."""

    exit_code = 13
