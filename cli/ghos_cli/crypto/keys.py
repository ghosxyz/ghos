"""Key derivation and keypair loading utilities.

The Solana keypair on disk is a JSON array of 64 bytes (Ed25519 private
key concatenated with the public key). We read it, feed the first 32
bytes through a domain-separated hash, and derive a deterministic
ElGamal scalar from the result. This lets a user hold a single on-disk
secret yet always reproduce the same encryption identity.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Final

from solders.keypair import Keypair

from ghos_cli.crypto.elgamal import ElGamalKeypair, keygen
from ghos_cli.errors import KeypairError

ELGAMAL_DOMAIN: Final[bytes] = b"ghos.elgamal.derive.v1"


def load_signer_bytes(path: str | os.PathLike[str]) -> bytes:
    """Load a Solana JSON keypair and return its 64-byte seed+pubkey buffer.

    The expected format is what `solana-keygen` writes: a JSON array of
    integers, length 64, that can be passed directly to
    `Keypair.from_bytes`.
    """
    target = Path(path).expanduser()
    if not target.is_file():
        raise KeypairError(f"keypair file does not exist: {target}")
    try:
        raw = target.read_text(encoding="utf-8")
        decoded = json.loads(raw)
    except (OSError, json.JSONDecodeError) as exc:
        raise KeypairError(f"cannot read keypair at {target}: {exc}") from exc
    if not isinstance(decoded, list):
        raise KeypairError(f"keypair at {target} must be a JSON array, got {type(decoded).__name__}")
    if len(decoded) != 64:
        raise KeypairError(f"keypair at {target} must be 64 bytes, got {len(decoded)}")
    buf = bytearray(64)
    for i, b in enumerate(decoded):
        if not isinstance(b, int) or b < 0 or b > 255:
            raise KeypairError(f"keypair byte {i} at {target} is out of range: {b!r}")
        buf[i] = b
    return bytes(buf)


def load_keypair(path: str | os.PathLike[str]) -> Keypair:
    """Return a `solders.Keypair` loaded from disk."""
    buf = load_signer_bytes(path)
    try:
        return Keypair.from_bytes(buf)
    except ValueError as exc:
        raise KeypairError(f"invalid keypair bytes at {path}: {exc}") from exc


def derive_elgamal_from_signer(
    signer_bytes: bytes,
    context: bytes | None = None,
) -> ElGamalKeypair:
    """Derive a deterministic ElGamal keypair from a Solana signer.

    Using only the first 32 bytes of the signer is deliberate: those are
    the Ed25519 seed, and deriving from the seed (not the expanded
    private scalar) matches what the TypeScript SDK does, so the same
    wallet always produces the same ElGamal identity across CLI and SDK.

    The `context` argument allows binding a derived key to a specific
    mint or auditor role. Pass `None` to produce the default user key.
    """
    if not isinstance(signer_bytes, bytes | bytearray):
        raise KeypairError("signer_bytes must be bytes")
    if len(signer_bytes) < 32:
        raise KeypairError(f"signer_bytes must be at least 32 bytes, got {len(signer_bytes)}")
    seed = bytes(signer_bytes[:32])
    hasher = hashlib.sha512()
    hasher.update(ELGAMAL_DOMAIN)
    if context is not None:
        if not isinstance(context, bytes | bytearray):
            raise KeypairError("context must be bytes")
        hasher.update(len(context).to_bytes(2, "little"))
        hasher.update(bytes(context))
    else:
        hasher.update((0).to_bytes(2, "little"))
    hasher.update(seed)
    return keygen(seed=hasher.digest())


def derive_auditor_elgamal(
    signer_bytes: bytes,
    mint_bytes: bytes,
) -> ElGamalKeypair:
    """Derive the auditor-specific ElGamal keypair for a given mint.

    Used by the `ghos audit register` and `ghos audit rotate` commands
    when the caller is acting as the auditor rather than a user.
    """
    if not isinstance(mint_bytes, bytes | bytearray):
        raise KeypairError("mint_bytes must be bytes")
    if len(mint_bytes) != 32:
        raise KeypairError(f"mint_bytes must be 32 bytes, got {len(mint_bytes)}")
    return derive_elgamal_from_signer(signer_bytes, context=b"auditor:" + bytes(mint_bytes))


def derive_burner_elgamal(
    signer_bytes: bytes,
    nonce: int,
) -> ElGamalKeypair:
    """Derive the ElGamal keypair for a specific burner slot.

    Each burner slot has a distinct encryption identity so that linking
    a burner to its parent account requires seeing the owner signer.
    """
    if nonce < 0 or nonce >> 64 != 0:
        raise KeypairError(f"burner nonce out of u64 range: {nonce}")
    return derive_elgamal_from_signer(
        signer_bytes,
        context=b"burner:" + nonce.to_bytes(8, "little"),
    )
