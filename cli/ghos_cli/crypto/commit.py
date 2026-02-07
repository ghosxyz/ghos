"""Commitment hash helpers for the CoinJoin mixing protocol.

Participants in a mix round first commit to their `(owner_elgamal_pk,
note_randomness)` tuple before revealing it. The commitment function is
a 32-byte Blake3 hash, matching `MIX_COMMITMENT_LEN` in `constants.rs`.

Blake3 is chosen over SHA-256 for consistency with the on-chain
reference implementation and for its higher throughput on the large
batched transcripts the settlement step verifies.
"""

from __future__ import annotations

from typing import Final

from blake3 import blake3

from ghos_cli.constants import MIX_COMMITMENT_LEN
from ghos_cli.crypto.elgamal import Ciphertext, PublicKey
from ghos_cli.errors import CryptoError

COMMIT_DOMAIN: Final[bytes] = b"ghos.mix.commit.v1"


def commit_hash(
    elgamal_pk: PublicKey | bytes,
    note: Ciphertext | bytes,
    salt: bytes,
) -> bytes:
    """Produce the 32-byte mix commitment hash.

    The inputs are concatenated under a domain tag, and the output is
    the Blake3 digest truncated to `MIX_COMMITMENT_LEN` bytes.

    Args:
        elgamal_pk: 32-byte Ristretto255 encoding of the participant's
            ElGamal public key, or a `PublicKey` object.
        note: 64-byte ElGamal ciphertext of the denomination, or a
            `Ciphertext` object.
        salt: 16 to 64 random bytes used to bind this commitment to
            the reveal signal. The same salt must be published during
            the reveal phase.

    Returns:
        A 32-byte digest suitable for the `commitment` field of a
        `MixCommitment` account.
    """
    pk_bytes = elgamal_pk.to_bytes() if isinstance(elgamal_pk, PublicKey) else bytes(elgamal_pk)
    if len(pk_bytes) != 32:
        raise CryptoError(f"elgamal_pk must be 32 bytes, got {len(pk_bytes)}")
    note_bytes = note.to_bytes() if isinstance(note, Ciphertext) else bytes(note)
    if len(note_bytes) != 64:
        raise CryptoError(f"note must be 64 bytes, got {len(note_bytes)}")
    if not isinstance(salt, bytes | bytearray):
        raise CryptoError("salt must be bytes")
    if len(salt) < 16 or len(salt) > 64:
        raise CryptoError(f"salt length must be 16..64 bytes, got {len(salt)}")

    hasher = blake3()
    hasher.update(COMMIT_DOMAIN)
    hasher.update(len(pk_bytes).to_bytes(2, "little"))
    hasher.update(pk_bytes)
    hasher.update(len(note_bytes).to_bytes(2, "little"))
    hasher.update(note_bytes)
    hasher.update(len(salt).to_bytes(2, "little"))
    hasher.update(bytes(salt))
    digest = hasher.digest(length=MIX_COMMITMENT_LEN)
    if len(digest) != MIX_COMMITMENT_LEN:
        raise CryptoError(f"commit digest length mismatch: {len(digest)}")
    return digest


def verify_commit(
    expected: bytes,
    elgamal_pk: PublicKey | bytes,
    note: Ciphertext | bytes,
    salt: bytes,
) -> bool:
    """Check that a revealed `(pk, note, salt)` tuple matches a commitment.

    Constant-time equality is used via `int.from_bytes` comparison since
    we are comparing 32-byte Blake3 digests and want to avoid length
    leaks. Returns True when the expected and computed digests match,
    False otherwise.
    """
    if not isinstance(expected, bytes | bytearray):
        raise CryptoError("expected must be bytes")
    if len(expected) != MIX_COMMITMENT_LEN:
        raise CryptoError(f"expected length {len(expected)} != {MIX_COMMITMENT_LEN}")
    computed = commit_hash(elgamal_pk, note, salt)
    diff = 0
    for a, b in zip(bytes(expected), computed, strict=True):
        diff |= a ^ b
    return diff == 0
