"""Tests for ElGamal, key derivation, and commitment hashing."""

from __future__ import annotations

import os

import pytest

from ghos_cli.crypto import (
    Ciphertext,
    PublicKey,
    SecretKey,
    commit_hash,
    decrypt_exhaustive,
    derive_elgamal_from_signer,
    encrypt,
    homomorphic_add,
    homomorphic_sub,
    keygen,
    randomize,
    verify_commit,
)
from ghos_cli.errors import CryptoError


def _seed(label: str) -> bytes:
    return label.encode("utf-8") + b"-" + os.urandom(0)


def test_keygen_deterministic_from_seed() -> None:
    a = keygen(seed=b"seed-a")
    b = keygen(seed=b"seed-a")
    assert a.public.to_bytes() == b.public.to_bytes()
    assert a.secret.to_bytes() == b.secret.to_bytes()


def test_keygen_different_seeds_differ() -> None:
    a = keygen(seed=b"seed-a")
    b = keygen(seed=b"seed-b")
    assert a.public.to_bytes() != b.public.to_bytes()


def test_public_key_roundtrip_through_bytes() -> None:
    kp = keygen(seed=b"pk-rt")
    pk_bytes = kp.public.to_bytes()
    assert len(pk_bytes) == 32
    back = PublicKey.from_bytes(pk_bytes)
    assert back.to_bytes() == pk_bytes


def test_secret_key_roundtrip_through_bytes() -> None:
    kp = keygen(seed=b"sk-rt")
    sk_bytes = kp.secret.to_bytes()
    assert len(sk_bytes) == 32
    back = SecretKey.from_bytes(sk_bytes)
    assert back.value == kp.secret.value


def test_encrypt_then_decrypt_roundtrip_small() -> None:
    kp = keygen(seed=b"enc-dec")
    for m in (0, 1, 42, 100, 999):
        ct = encrypt(kp.public, m)
        assert len(ct.to_bytes()) == 64
        assert decrypt_exhaustive(kp.secret, ct, max_amount=1000) == m


def test_ciphertext_roundtrip_through_bytes() -> None:
    kp = keygen(seed=b"ct-rt")
    ct = encrypt(kp.public, 77)
    raw = ct.to_bytes()
    assert len(raw) == 64
    back = Ciphertext.from_bytes(raw)
    assert back.to_bytes() == raw
    assert decrypt_exhaustive(kp.secret, back, max_amount=200) == 77


def test_homomorphic_add_composes_plaintexts() -> None:
    kp = keygen(seed=b"hom-add")
    a = encrypt(kp.public, 5)
    b = encrypt(kp.public, 13)
    c = homomorphic_add(a, b)
    assert decrypt_exhaustive(kp.secret, c, max_amount=100) == 18


def test_homomorphic_sub_composes_plaintexts() -> None:
    kp = keygen(seed=b"hom-sub")
    a = encrypt(kp.public, 20)
    b = encrypt(kp.public, 5)
    c = homomorphic_sub(a, b)
    assert decrypt_exhaustive(kp.secret, c, max_amount=100) == 15


def test_randomize_preserves_plaintext() -> None:
    kp = keygen(seed=b"rand")
    ct = encrypt(kp.public, 42)
    ct2 = randomize(ct, kp.public)
    assert ct.to_bytes() != ct2.to_bytes()  # new entropy
    assert decrypt_exhaustive(kp.secret, ct2, max_amount=100) == 42


def test_decrypt_fails_when_amount_exceeds_bound() -> None:
    kp = keygen(seed=b"bound")
    ct = encrypt(kp.public, 50)
    with pytest.raises(CryptoError):
        decrypt_exhaustive(kp.secret, ct, max_amount=10)


def test_encrypt_rejects_negative_amount() -> None:
    kp = keygen(seed=b"neg")
    with pytest.raises(CryptoError):
        encrypt(kp.public, -1)


def test_encrypt_rejects_amount_over_64_bits() -> None:
    kp = keygen(seed=b"overflow")
    with pytest.raises(CryptoError):
        encrypt(kp.public, 1 << 65)


def test_derive_elgamal_is_deterministic_over_signer() -> None:
    signer = bytes(range(64))
    a = derive_elgamal_from_signer(signer, context=b"user:default")
    b = derive_elgamal_from_signer(signer, context=b"user:default")
    assert a.public.to_bytes() == b.public.to_bytes()


def test_derive_elgamal_context_changes_key() -> None:
    signer = bytes(range(64))
    a = derive_elgamal_from_signer(signer, context=b"user:default")
    b = derive_elgamal_from_signer(signer, context=b"burner:1")
    assert a.public.to_bytes() != b.public.to_bytes()


def test_derive_elgamal_rejects_short_signer() -> None:
    from ghos_cli.errors import KeypairError

    with pytest.raises(KeypairError):
        derive_elgamal_from_signer(b"short")


def test_commit_hash_is_32_bytes() -> None:
    kp = keygen(seed=b"commit-len")
    ct = encrypt(kp.public, 10)
    digest = commit_hash(kp.public, ct, salt=os.urandom(32))
    assert len(digest) == 32


def test_commit_hash_changes_with_salt() -> None:
    kp = keygen(seed=b"commit-salt")
    ct = encrypt(kp.public, 10)
    d1 = commit_hash(kp.public, ct, salt=b"\x00" * 32)
    d2 = commit_hash(kp.public, ct, salt=b"\x01" * 32)
    assert d1 != d2


def test_verify_commit_succeeds_on_match() -> None:
    kp = keygen(seed=b"verify-ok")
    ct = encrypt(kp.public, 10)
    salt = os.urandom(32)
    digest = commit_hash(kp.public, ct, salt=salt)
    assert verify_commit(digest, kp.public, ct, salt) is True


def test_verify_commit_rejects_bit_flip() -> None:
    kp = keygen(seed=b"verify-bad")
    ct = encrypt(kp.public, 10)
    salt = os.urandom(32)
    digest = bytearray(commit_hash(kp.public, ct, salt=salt))
    digest[0] ^= 0x01
    assert verify_commit(bytes(digest), kp.public, ct, salt) is False


def test_commit_hash_rejects_short_salt() -> None:
    kp = keygen(seed=b"salt-short")
    ct = encrypt(kp.public, 10)
    with pytest.raises(CryptoError):
        commit_hash(kp.public, ct, salt=b"x" * 8)
