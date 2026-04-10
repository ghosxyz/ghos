"""`ghos status` command.

Read-only snapshot of the caller's identity and, if `--mint` is given,
the confidential balance for that mint. Decryption uses the local
ElGamal secret derived from the configured signer, so this command
never leaks ciphertexts off the device.
"""

from __future__ import annotations

import asyncio
import struct
from typing import Annotated

import typer
from solders.pubkey import Pubkey

from ghos_cli.client import connected
from ghos_cli.config import load_config
from ghos_cli.constants import PROGRAM_ID
from ghos_cli.crypto import Ciphertext, decrypt_exhaustive, derive_elgamal_from_signer
from ghos_cli.crypto.keys import load_keypair, load_signer_bytes
from ghos_cli.display import (
    make_console,
    print_kv_table,
    print_tree,
    print_warning,
    progress_spinner,
)
from ghos_cli.pdas import auditor_pda, config_pda, describe_pdas, padding_vault_pda
from ghos_cli.units import format_amount, format_lamports

_DEFAULT_DECRYPT_BOUND: int = 1 << 20


def status_command(
    mint: Annotated[
        str,
        typer.Option("--mint", "-m", help="Token-2022 mint to read balance for."),
    ] = "",
    decrypt_bound: Annotated[
        int,
        typer.Option(
            "--decrypt-bound",
            help="Upper bound for exhaustive decryption. Larger = slower.",
        ),
    ] = _DEFAULT_DECRYPT_BOUND,
    decimals: Annotated[
        int,
        typer.Option("--decimals", help="Override mint decimals."),
    ] = -1,
) -> None:
    """Render the caller's CLI status and, optionally, a decrypted balance."""
    asyncio.run(_run_status(mint, decrypt_bound, decimals))


async def _run_status(mint_str: str, decrypt_bound: int, decimals_override: int) -> None:
    console = make_console()
    cfg = load_config()
    payer = load_keypair(cfg.keypair.path)
    owner_pubkey = payer.pubkey()
    signer_bytes = load_signer_bytes(cfg.keypair.path)
    elgamal = derive_elgamal_from_signer(signer_bytes, context=b"user:default")

    async with connected(cfg) as rpc:
        with progress_spinner(console, "fetching cluster metadata"):
            version = await rpc.get_version()
            slot = await rpc.get_slot()
            lamports = await rpc.get_balance(owner_pubkey)

        mint_pubkey: Pubkey | None = None
        decimals = decimals_override
        balance_text = "-"
        pending_text = "-"
        auditor_present = "unknown"
        if mint_str:
            try:
                mint_pubkey = Pubkey.from_string(mint_str)
            except ValueError as exc:
                raise typer.BadParameter(f"invalid mint pubkey: {mint_str!r}") from exc
            if decimals < 0:
                with progress_spinner(console, "reading mint decimals"):
                    decimals = await _fetch_mint_decimals(rpc, mint_pubkey)
            auditor_addr, _ = auditor_pda(mint_pubkey)
            auditor_acc = await rpc.get_account(auditor_addr)
            auditor_present = "present" if auditor_acc is not None else "absent"

            with progress_spinner(console, "reading confidential balance"):
                available_ct, pending_ct = await _read_confidential_balance(
                    rpc, owner_pubkey, mint_pubkey
                )
            if available_ct is not None:
                try:
                    available_m = decrypt_exhaustive(elgamal.secret, available_ct, decrypt_bound)
                    balance_text = format_amount(available_m, decimals)
                except Exception:  # noqa: BLE001 - decryption exceeds bound
                    balance_text = "decryption failed (raise --decrypt-bound)"
            else:
                balance_text = "0"
            if pending_ct is not None:
                try:
                    pending_m = decrypt_exhaustive(elgamal.secret, pending_ct, decrypt_bound)
                    pending_text = format_amount(pending_m, decimals)
                except Exception:  # noqa: BLE001
                    pending_text = "decryption failed (raise --decrypt-bound)"
            else:
                pending_text = "0"

    tree = {
        "identity": {
            "owner": str(owner_pubkey),
            "elgamal_pubkey": elgamal.public.to_bytes().hex(),
        },
        "cluster": {
            "name": cfg.cluster.name,
            "rpc_url": cfg.cluster.rpc_url,
            "commitment": cfg.cluster.commitment,
            "solana_core": version["solana_core"],
            "slot": slot,
        },
        "wallet": {
            "lamports": lamports,
            "sol": format_lamports(lamports),
        },
        "program": {
            "id": PROGRAM_ID,
            "config_pda": str(config_pda()[0]),
        },
    }
    if mint_pubkey is not None:
        tree["mint"] = {
            "address": str(mint_pubkey),
            "decimals": decimals,
            "auditor_entry": auditor_present,
            "available": balance_text,
            "pending": pending_text,
            "padding_vault": str(padding_vault_pda(mint_pubkey)[0]),
        }
    print_tree(console, "ghos status", tree)

    pdas = describe_pdas(owner_pubkey, mint_pubkey or owner_pubkey)
    print_kv_table(console, pdas, title="derived addresses")
    if mint_pubkey is None:
        print_warning(
            console, "no --mint given; run `ghos status --mint <pubkey>` to see balances"
        )


async def _read_confidential_balance(
    rpc,
    owner: Pubkey,
    mint: Pubkey,
) -> tuple[Ciphertext | None, Ciphertext | None]:
    """Return `(available_ct, pending_ct)` for the owner's confidential extension.

    The Token-2022 confidential transfer extension stores the available
    and pending counters as 64-byte ElGamal ciphertexts inside the token
    account's extension blob. Locating the confidential transfer
    extension requires walking the TLV list past the base 165-byte
    account.
    """
    # Derive the canonical ATA.
    token_program = Pubkey.from_string("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb")
    ata_program = Pubkey.from_string("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")
    ata, _ = Pubkey.find_program_address(
        [bytes(owner), bytes(token_program), bytes(mint)],
        ata_program,
    )
    account = await rpc.get_account(ata)
    if account is None:
        return (None, None)
    data = account["data"]
    if len(data) <= 165:
        return (None, None)
    # Walk TLVs starting at offset 165 (account_type u8 at 165, then TLVs).
    if data[165] != 2:  # 2 == Account, per Token-2022 extension spec
        return (None, None)
    cursor = 166
    available_ct: Ciphertext | None = None
    pending_ct: Ciphertext | None = None
    while cursor + 4 <= len(data):
        ext_type = struct.unpack_from("<H", data, cursor)[0]
        ext_len = struct.unpack_from("<H", data, cursor + 2)[0]
        payload_start = cursor + 4
        payload_end = payload_start + ext_len
        if payload_end > len(data):
            break
        # Extension type 4 is ConfidentialTransferAccount in Token-2022.
        if ext_type == 4 and ext_len >= 128:
            try:
                pending_ct = Ciphertext.from_bytes(data[payload_start : payload_start + 64])
                available_ct = Ciphertext.from_bytes(
                    data[payload_start + 64 : payload_start + 128]
                )
            except Exception:  # noqa: BLE001 - ciphertext parse fail
                pass
            break
        cursor = payload_end
    return (available_ct, pending_ct)


async def _fetch_mint_decimals(rpc, mint: Pubkey) -> int:
    account = await rpc.get_account(mint)
    if account is None:
        raise typer.BadParameter(f"mint account {mint} does not exist on cluster")
    data = account["data"]
    if len(data) < 82:
        raise typer.BadParameter(f"mint account {mint} is too small to be a mint")
    return int(data[44])

# refactor: ghos status prints pending and available side by side
