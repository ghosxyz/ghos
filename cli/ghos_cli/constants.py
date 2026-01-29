"""Compile-time constants mirrored from the on-chain `constants.rs`.

Keeping these values in sync with the Rust program is a requirement of the
protocol. Any mismatch will produce accounts whose sizes disagree with what
Anchor expects, or PDAs that do not derive to the same address on both sides.
"""

from __future__ import annotations

from typing import Final

PROGRAM_ID: Final[str] = "EnKo8EbfJkani8UePTmAVPzdCZM8vMEYYkjTar4fwBPg"

# PDA seeds. Bytes literals are required because seeds are passed as raw bytes
# into `Pubkey.find_program_address`.
CONFIG_SEED: Final[bytes] = b"ghos.config"
BURNER_SEED: Final[bytes] = b"ghos.burner"
MIX_ROUND_SEED: Final[bytes] = b"ghos.mix.round"
MIX_COMMITMENT_SEED: Final[bytes] = b"ghos.mix.commit"
AUDITOR_SEED: Final[bytes] = b"ghos.auditor"
PADDING_VAULT_SEED: Final[bytes] = b"ghos.padding"

# Mix round limits.
MIX_MAX_PARTICIPANTS: Final[int] = 16
MIX_MIN_PARTICIPANTS: Final[int] = 4
MIX_REVEAL_WINDOW_SECONDS: Final[int] = 60 * 10

# Burner lifecycle bounds (seconds).
BURNER_TTL_MAX_SECONDS: Final[int] = 60 * 60 * 24 * 30
BURNER_TTL_MIN_SECONDS: Final[int] = 60
BURNER_REGISTRY_CAP_PER_OWNER: Final[int] = 64

# Amount quantization.
DUST_FREE_UNIT: Final[int] = 1_000

# Protocol identity.
PROTOCOL_VERSION: Final[int] = 0x0401
AUDITOR_PUBKEY_LEN: Final[int] = 32
AUDITOR_COSIGN_LAMPORTS: Final[int] = 5_000
MIX_COMMITMENT_LEN: Final[int] = 32
ELGAMAL_CIPHERTEXT_LEN: Final[int] = 64
RECOMMENDED_CU_BUDGET: Final[int] = 600_000

# Fixed address of the SPL zk-token-proof program, the same on every cluster.
ZK_TOKEN_PROOF_PROGRAM_ID: Final[str] = "ZkTokenProof1111111111111111111111111111111"

# Token-2022 program id, the same on every cluster.
TOKEN_2022_PROGRAM_ID: Final[str] = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"

# Associated token account program id.
ASSOCIATED_TOKEN_PROGRAM_ID: Final[str] = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"

# Default RPC endpoints per cluster. Callers may override via config or env.
DEFAULT_RPC: Final[dict[str, str]] = {
    "devnet": "https://api.devnet.solana.com",
    "mainnet-beta": "https://api.mainnet-beta.solana.com",
    "testnet": "https://api.testnet.solana.com",
    "localnet": "http://127.0.0.1:8899",
}

# Default WebSocket endpoints derived from the RPC URLs, used for subscriptions.
DEFAULT_WS: Final[dict[str, str]] = {
    "devnet": "wss://api.devnet.solana.com",
    "mainnet-beta": "wss://api.mainnet-beta.solana.com",
    "testnet": "wss://api.testnet.solana.com",
    "localnet": "ws://127.0.0.1:8900",
}

# Primary brand color for rich output across the CLI. Used for tables,
# panels, progress bars, and prompt accents.
BRAND_PRIMARY: Final[str] = "#ff1249"

# Secondary accent, used only for inactive or muted rows so that the primary
# color stays dominant.
BRAND_MUTED: Final[str] = "#6b6b6b"

# Maximum transaction retries when confirming a signed transaction.
TX_CONFIRM_MAX_RETRIES: Final[int] = 30

# Wait interval between confirmation polls, in seconds.
TX_CONFIRM_INTERVAL: Final[float] = 1.0

# Human-readable cluster aliases accepted on the command line.
CLUSTER_ALIASES: Final[dict[str, str]] = {
    "dev": "devnet",
    "devnet": "devnet",
    "main": "mainnet-beta",
    "mainnet": "mainnet-beta",
    "mainnet-beta": "mainnet-beta",
    "test": "testnet",
    "testnet": "testnet",
    "local": "localnet",
    "localnet": "localnet",
    "localhost": "localnet",
}


def canonical_cluster(alias: str) -> str:
    """Return the canonical cluster name for a user-supplied alias.

    Raises:
        ValueError: if the alias is not recognized.
    """
    key = alias.strip().lower()
    if key in CLUSTER_ALIASES:
        return CLUSTER_ALIASES[key]
    raise ValueError(f"unknown cluster: {alias!r}")
