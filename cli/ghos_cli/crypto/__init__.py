"""Cryptographic primitives used by the CLI.

The modules in this subpackage implement three pieces of protocol logic
that must be callable offline, without hitting an RPC node:

* `elgamal` implements twisted ElGamal over Ristretto255, used to
  encrypt amounts before sending them to the on-chain confidential
  transfer extension, and to decrypt balances locally.
* `keys` derives a deterministic ElGamal keypair from a Solana signer so
  that the same wallet always produces the same encryption identity.
* `commit` produces the 32-byte Blake3 commitment hash used by the
  CoinJoin mixing protocol.
"""

from __future__ import annotations

from ghos_cli.crypto.commit import commit_hash, verify_commit
from ghos_cli.crypto.elgamal import (
    Ciphertext,
    ElGamalKeypair,
    PublicKey,
    SecretKey,
    decrypt_exhaustive,
    encrypt,
    homomorphic_add,
    homomorphic_sub,
    keygen,
    randomize,
)
from ghos_cli.crypto.keys import derive_elgamal_from_signer, load_signer_bytes

__all__ = [
    "Ciphertext",
    "ElGamalKeypair",
    "PublicKey",
    "SecretKey",
    "commit_hash",
    "decrypt_exhaustive",
    "derive_elgamal_from_signer",
    "encrypt",
    "homomorphic_add",
    "homomorphic_sub",
    "keygen",
    "load_signer_bytes",
    "randomize",
    "verify_commit",
]
