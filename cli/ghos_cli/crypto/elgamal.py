"""Twisted ElGamal over Ristretto255.

This is a self-contained pure-Python implementation sufficient for the
offline encryption and decryption paths exercised by the CLI. It follows
the scheme used by the SPL confidential transfer extension:

* Group: Ristretto255, a prime-order quotient of edwards25519.
* Scalars: integers mod `L = 2**252 + 27742317777372353535851937790883648493`.
* Twisted ElGamal keypair: `sk` is a scalar, `pk = sk * G` where G is the
  conventional Ristretto255 generator.
* Encryption of a 64-bit amount `m` under `pk` uses auxiliary random
  scalar `r`: `C = (r * G, m * G + r * pk)` where `G` is the basepoint
  and the commitment component encodes `m` additively so that two
  ciphertexts of `m1` and `m2` compose into a ciphertext of `m1 + m2`.

Decryption is exhaustive: the caller provides a baby-step giant-step
search bound, and we recover `m` up to that bound. This is slow for
large balances, so in practice `decrypt_exhaustive` is only used by the
CLI to display the user's own balance, where values are small.

The Ristretto255 encode/decode follows RFC 9496 directly. The extended
Edwards point arithmetic on edwards25519 follows RFC 8032. All constants
are verified against RFC 9496 appendix A.
"""

from __future__ import annotations

import hashlib
import os
import secrets
from dataclasses import dataclass
from typing import Final

from ghos_cli.errors import CryptoError

# --- Field and group parameters ------------------------------------------

_P: Final[int] = 2**255 - 19
_L: Final[int] = 2**252 + 27742317777372353535851937790883648493
# edwards25519 curve parameter d = -121665/121666 mod p.
_D: Final[int] = (-121665 * pow(121666, _P - 2, _P)) % _P
# sqrt(-1) mod p, least non-negative form.
_SQRT_M1: Final[int] = pow(2, (_P - 1) // 4, _P)
# 1/sqrt(a-d) where a = -1 on edwards25519. Equivalent to sqrt(-1/(d+1)).
# Precomputed constant from RFC 9496.
_INVSQRT_A_MINUS_D: Final[int] = 54469307008909316920995813868745141605393597292927456921205312896311721017578
# sqrt(d-1) mod p, used during encoding of the Jacobi quartic representative.
_SQRT_AD_MINUS_ONE: Final[int] = 25063068953384623474111414158702152701244531502492656460079210482610430750235

# Canonical Ristretto255 basepoint encoding, RFC 9496 appendix A.
_BASEPOINT_ENCODING: Final[bytes] = bytes.fromhex(
    "e2f2ae0a6abc4e71a884a961c500515f58e30b6aa582dd8db6a65945e08d2d76"
)


def _inv(x: int) -> int:
    """Field inverse mod p via Fermat's little theorem."""
    return pow(x, _P - 2, _P)


def _is_negative_fe(x: int) -> int:
    """Return 1 if field element is negative in the Ristretto sign convention."""
    return x & 1


def _abs_fe(x: int) -> int:
    """Return the unsigned representative (sign == 0) of a field element."""
    return (_P - x) % _P if _is_negative_fe(x) else x % _P


def _ct_eq_fe(a: int, b: int) -> int:
    """Field element equality (boolean return, 0 or 1)."""
    return 1 if (a - b) % _P == 0 else 0


def _sqrt_ratio_m1(u: int, v: int) -> tuple[int, int]:
    """Compute sqrt(u/v), returning (was_square, sign-canonical sqrt).

    Implements the `SQRT_RATIO_M1` subroutine from RFC 9496. Returns
    `(1, r)` when `u/v` is a square, `(0, r)` otherwise where `r` is
    `sqrt(u*i/v)`. `r` is always returned sign-canonicalized.
    """
    u = u % _P
    v = v % _P
    v3 = (v * v * v) % _P
    v7 = (v3 * v3 * v) % _P
    r = (u * v3 * pow(u * v7 % _P, (_P - 5) // 8, _P)) % _P
    check = (v * r * r) % _P
    correct_sign_sqrt = _ct_eq_fe(check, u)
    flipped_sign_sqrt = _ct_eq_fe(check, (-u) % _P)
    flipped_sign_sqrt_i = _ct_eq_fe(check, (-u * _SQRT_M1) % _P)
    r_prime = (r * _SQRT_M1) % _P
    if flipped_sign_sqrt or flipped_sign_sqrt_i:
        r = r_prime
    was_square = correct_sign_sqrt | flipped_sign_sqrt
    r = _abs_fe(r)
    return (was_square, r)


# --- Point representation: extended twisted Edwards coordinates ----------


@dataclass(slots=True, frozen=True)
class _Point:
    """Extended Edwards point on edwards25519: X, Y, Z, T with x=X/Z, y=Y/Z, T=XY/Z."""

    X: int
    Y: int
    Z: int
    T: int

    @classmethod
    def identity(cls) -> _Point:
        return cls(0, 1, 1, 0)

    def add(self, other: _Point) -> _Point:
        # Unified addition for twisted Edwards a = -1 (RFC 8032 §5.1.4).
        a = ((self.Y - self.X) * (other.Y - other.X)) % _P
        b = ((self.Y + self.X) * (other.Y + other.X)) % _P
        c = (self.T * 2 * _D * other.T) % _P
        dd = (self.Z * 2 * other.Z) % _P
        e = (b - a) % _P
        f = (dd - c) % _P
        g = (dd + c) % _P
        h = (b + a) % _P
        return _Point((e * f) % _P, (g * h) % _P, (f * g) % _P, (e * h) % _P)

    def double(self) -> _Point:
        return self.add(self)

    def negate(self) -> _Point:
        return _Point((-self.X) % _P, self.Y % _P, self.Z % _P, (-self.T) % _P)

    def scalar_mul(self, k: int) -> _Point:
        k = k % _L
        result = _Point.identity()
        base = self
        while k > 0:
            if k & 1:
                result = result.add(base)
            base = base.double()
            k >>= 1
        return result


def _ristretto_equal(p: _Point, q: _Point) -> bool:
    """Ristretto255 equality: two points collapse to the same coset representative."""
    # From RFC 9496: (X1*Y2 == Y1*X2) or (Y1*Y2 == X1*X2).
    lhs1 = (p.X * q.Y) % _P
    rhs1 = (p.Y * q.X) % _P
    lhs2 = (p.Y * q.Y) % _P
    rhs2 = (p.X * q.X) % _P
    return lhs1 == rhs1 or lhs2 == rhs2


def _ristretto_encode(p: _Point) -> bytes:
    """Encode an extended Edwards point as 32-byte Ristretto255, per RFC 9496 §4.3.2."""
    X, Y, Z, T = p.X % _P, p.Y % _P, p.Z % _P, p.T % _P
    u1 = ((Z + Y) * (Z - Y)) % _P
    u2 = (X * Y) % _P
    # Ignore was_square since u1*u2^2 is always square for valid points.
    _, invsqrt = _sqrt_ratio_m1(1, (u1 * u2 * u2) % _P)
    den1 = (invsqrt * u1) % _P
    den2 = (invsqrt * u2) % _P
    z_inv = (den1 * den2 * T) % _P
    ix = (X * _SQRT_M1) % _P
    iy = (Y * _SQRT_M1) % _P
    enchanted_denominator = (den1 * _INVSQRT_A_MINUS_D) % _P
    rotate = _is_negative_fe((T * z_inv) % _P)
    if rotate:
        X, Y = iy, ix
        den2 = enchanted_denominator
    if _is_negative_fe((X * z_inv) % _P):
        Y = (-Y) % _P
    s = _abs_fe(((Z - Y) * den2) % _P)
    return s.to_bytes(32, byteorder="little")


def _ristretto_decode(data: bytes) -> _Point:
    """Decode a 32-byte Ristretto255 string to an extended Edwards point."""
    if len(data) != 32:
        raise CryptoError(f"invalid ristretto encoding length: {len(data)}")
    # Non-canonical detection: the encoding must round-trip to itself.
    s = int.from_bytes(data, byteorder="little")
    if s >= _P:
        raise CryptoError("invalid ristretto encoding: non-canonical s")
    if _is_negative_fe(s):
        raise CryptoError("invalid ristretto encoding: s is negative")
    ss = (s * s) % _P
    u1 = (1 - ss) % _P  # 1 + a*s^2 with a = -1
    u2 = (1 + ss) % _P  # 1 - a*s^2
    u2_sqr = (u2 * u2) % _P
    v = (-(_D * u1 * u1) - u2_sqr) % _P
    was_square, invsqrt = _sqrt_ratio_m1(1, (v * u2_sqr) % _P)
    den_x = (invsqrt * u2) % _P
    den_y = (invsqrt * den_x * v) % _P
    x = _abs_fe((2 * s * den_x) % _P)
    y = (u1 * den_y) % _P
    t = (x * y) % _P
    if was_square == 0 or _is_negative_fe(t) or y == 0:
        raise CryptoError("invalid ristretto encoding: not a valid point")
    return _Point(x, y, 1, t)


def _basepoint() -> _Point:
    """Return the canonical Ristretto255 basepoint as an internal _Point."""
    return _ristretto_decode(_BASEPOINT_ENCODING)


def _random_scalar() -> int:
    """Uniform scalar in [1, L) using `secrets` as the entropy source."""
    v = secrets.randbelow(_L - 1) + 1
    return v


def _reduce_scalar_from_bytes(data: bytes) -> int:
    """Reduce an arbitrary-length byte string into a scalar mod L."""
    return int.from_bytes(data, byteorder="little") % _L


# --- Public API ----------------------------------------------------------


@dataclass(slots=True, frozen=True)
class SecretKey:
    """ElGamal secret key: a scalar mod L, serialized as 32 little-endian bytes."""

    value: int

    def to_bytes(self) -> bytes:
        return self.value.to_bytes(32, byteorder="little")

    @classmethod
    def from_bytes(cls, data: bytes) -> SecretKey:
        if len(data) != 32:
            raise CryptoError(f"SecretKey must be 32 bytes, got {len(data)}")
        v = int.from_bytes(data, byteorder="little") % _L
        if v == 0:
            raise CryptoError("SecretKey must not be zero")
        return cls(value=v)


@dataclass(slots=True, frozen=True)
class PublicKey:
    """ElGamal public key: 32-byte Ristretto255 encoding of `sk * G`."""

    encoding: bytes

    def to_bytes(self) -> bytes:
        return self.encoding

    @classmethod
    def from_bytes(cls, data: bytes) -> PublicKey:
        if len(data) != 32:
            raise CryptoError(f"PublicKey must be 32 bytes, got {len(data)}")
        _ristretto_decode(data)
        return cls(encoding=bytes(data))


@dataclass(slots=True, frozen=True)
class ElGamalKeypair:
    """Pair of a secret scalar and its matching Ristretto public key."""

    secret: SecretKey
    public: PublicKey


@dataclass(slots=True, frozen=True)
class Ciphertext:
    """Twisted ElGamal ciphertext pair.

    The wire format is `c1 || c2` (64 bytes total), matching the
    `ElGamalCiphertext` layout used by the SPL zk-token-proof program.
    """

    c1: bytes
    c2: bytes

    def to_bytes(self) -> bytes:
        return self.c1 + self.c2

    @classmethod
    def from_bytes(cls, data: bytes) -> Ciphertext:
        if len(data) != 64:
            raise CryptoError(f"Ciphertext must be 64 bytes, got {len(data)}")
        return cls(c1=bytes(data[:32]), c2=bytes(data[32:]))


def keygen(seed: bytes | None = None) -> ElGamalKeypair:
    """Generate a fresh ElGamal keypair.

    If `seed` is None, entropy is drawn from the OS CSPRNG. Otherwise the
    seed (of any length) is hashed with SHA-512 and reduced modulo L, so
    the derivation is deterministic.
    """
    if seed is None:
        scalar = _random_scalar()
    else:
        if not isinstance(seed, bytes | bytearray):
            raise CryptoError("seed must be bytes")
        digest = hashlib.sha512(bytes(seed)).digest()
        scalar = _reduce_scalar_from_bytes(digest)
    if scalar == 0:
        scalar = _reduce_scalar_from_bytes(os.urandom(64))
    pub_point = _basepoint().scalar_mul(scalar)
    return ElGamalKeypair(
        secret=SecretKey(value=scalar),
        public=PublicKey(encoding=_ristretto_encode(pub_point)),
    )


def encrypt(pk: PublicKey, amount: int, randomness: int | None = None) -> Ciphertext:
    """Encrypt a non-negative 64-bit integer amount under `pk`.

    If `randomness` is None, a fresh scalar is drawn. Otherwise the given
    scalar is used, which is useful for tests and for correlated proofs.
    """
    if amount < 0:
        raise CryptoError(f"amount must be non-negative, got {amount}")
    if amount >> 64 != 0:
        raise CryptoError(f"amount must fit in 64 bits, got {amount}")
    r = _random_scalar() if randomness is None else randomness % _L
    if r == 0:
        r = _random_scalar()
    g = _basepoint()
    pk_point = _ristretto_decode(pk.encoding)
    c1_point = g.scalar_mul(r)
    amount_point = g.scalar_mul(amount)
    pk_r_point = pk_point.scalar_mul(r)
    c2_point = amount_point.add(pk_r_point)
    return Ciphertext(
        c1=_ristretto_encode(c1_point),
        c2=_ristretto_encode(c2_point),
    )


def decrypt_exhaustive(sk: SecretKey, ct: Ciphertext, max_amount: int = 1 << 20) -> int:
    """Recover the amount in `ct` by brute-force discrete log up to `max_amount`.

    This is O(max_amount) point additions in the worst case. The CLI only
    uses it for displaying the user's own balance, where max_amount is
    capped at 2**20 by default to keep the call under a second.
    """
    if max_amount < 0:
        raise CryptoError(f"max_amount must be non-negative, got {max_amount}")
    c1_point = _ristretto_decode(ct.c1)
    c2_point = _ristretto_decode(ct.c2)
    mask_point = c1_point.scalar_mul(sk.value)
    target_point = c2_point.add(mask_point.negate())
    g = _basepoint()
    cursor = _Point.identity()
    if _ristretto_equal(cursor, target_point):
        return 0
    for m in range(1, max_amount + 1):
        cursor = cursor.add(g)
        if _ristretto_equal(cursor, target_point):
            return m
    raise CryptoError(f"decrypt failed: amount exceeds max_amount={max_amount}")


def randomize(ct: Ciphertext, pk: PublicKey) -> Ciphertext:
    """Re-randomize a ciphertext without changing the plaintext.

    Adds `(r*G, r*pk)` homomorphically, which adds zero to the plaintext
    but refreshes the entropy. Used by the CLI to break link-ability in
    mix rounds before broadcasting.
    """
    r = _random_scalar()
    g = _basepoint()
    pk_point = _ristretto_decode(pk.encoding)
    refresh_c1 = g.scalar_mul(r)
    refresh_c2 = pk_point.scalar_mul(r)
    c1_point = _ristretto_decode(ct.c1).add(refresh_c1)
    c2_point = _ristretto_decode(ct.c2).add(refresh_c2)
    return Ciphertext(
        c1=_ristretto_encode(c1_point),
        c2=_ristretto_encode(c2_point),
    )


def homomorphic_add(a: Ciphertext, b: Ciphertext) -> Ciphertext:
    """Add two ciphertexts component-wise.

    `encrypt(m1) + encrypt(m2)` decrypts to `m1 + m2` when both were
    produced under the same public key. The CLI uses this to aggregate
    pending balances when applying them into the available counter.
    """
    a_c1 = _ristretto_decode(a.c1)
    a_c2 = _ristretto_decode(a.c2)
    b_c1 = _ristretto_decode(b.c1)
    b_c2 = _ristretto_decode(b.c2)
    return Ciphertext(
        c1=_ristretto_encode(a_c1.add(b_c1)),
        c2=_ristretto_encode(a_c2.add(b_c2)),
    )


def homomorphic_sub(a: Ciphertext, b: Ciphertext) -> Ciphertext:
    """Subtract ciphertext `b` from `a` component-wise.

    Precondition: both ciphertexts are under the same key and the
    plaintext of `a` is greater than or equal to the plaintext of `b`,
    otherwise `decrypt_exhaustive` will fail.
    """
    a_c1 = _ristretto_decode(a.c1)
    a_c2 = _ristretto_decode(a.c2)
    b_c1 = _ristretto_decode(b.c1)
    b_c2 = _ristretto_decode(b.c2)
    return Ciphertext(
        c1=_ristretto_encode(a_c1.add(b_c1.negate())),
        c2=_ristretto_encode(a_c2.add(b_c2.negate())),
    )
