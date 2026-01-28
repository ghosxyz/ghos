"""ghos-cli: terminal client for the ghos Solana privacy OS.

This package exposes the command line interface `ghos`, along with a handful
of internal modules used by the commands. Public imports here are kept
intentionally small. Most callers should use `python -m ghos_cli` or the
installed `ghos` script rather than importing this module directly.
"""

from __future__ import annotations

__all__ = [
    "__version__",
    "__program_id__",
    "__cli_name__",
    "__website__",
    "__repository__",
    "__license__",
]

__version__: str = "0.4.1"
__program_id__: str = "EnKo8EbfJkani8UePTmAVPzdCZM8vMEYYkjTar4fwBPg"
__cli_name__: str = "ghos"
__website__: str = "https://ghos.xyz"
__repository__: str = "https://github.com/ghosxyz/ghos"
__license__: str = "MIT"
