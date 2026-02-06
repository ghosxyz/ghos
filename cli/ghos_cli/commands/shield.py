"""`ghos shield` command.

Moves an SPL Token-2022 balance into the confidential available counter
for the same mint. The flow is:

1. Parse the decimal amount against the mint's decimals.
2. Derive the user's deterministic ElGamal key.
3. Encrypt the amount locally.
4. Build a `shield` instruction targeting the ghos program, which CPIs
   into Token-2022's confidential transfer extension to credit the
   pending counter, then into the zk-token-proof program for range
   proof verification.
5. Submit and confirm.
6. Render the outcome.
"""

from __future__ import annotations

import asyncio
import struct
from typing import Annotated

import typer
from solders.instruction import AccountMeta, Instruction
from solders.pubkey import Pubkey

from ghos_cli.client import connected
from ghos_cli.config import load_config
from ghos_cli.constants import (
    PROGRAM_ID,
    RECOMMENDED_CU_BUDGET,
    TOKEN_2022_PROGRAM_ID,
    ZK_TOKEN_PROOF_PROGRAM_ID,
)
from ghos_cli.crypto import derive_elgamal_from_signer, encrypt
from ghos_cli.crypto.keys import load_keypair, load_signer_bytes
from ghos_cli.display import make_console, print_kv_table, print_success, progress_spinner
from ghos_cli.pdas import auditor_pda, config_pda, padding_vault_pda
from ghos_cli.units import format_amount, parse_amount

# Anchor instruction discriminators are the first 8 bytes of
# `sha256("global:<ix_name>")`. These are stable across compilations.
SHIELD_DISCRIMINATOR: bytes = bytes.fromhex("cd8a2db96dbd49ec")


def shield_command(
    mint: Annotated[
        str,
        typer.Option("--mint", "-m", help="Token-2022 mint address."),
    ],
    amount: Annotated[
        str,
        typer.Option("--amount", "-a", help="Decimal amount to shield."),
    ],
    decimals: Annotated[
        int,
        typer.Option(
            "--decimals",
            help="Override mint decimals. If unset, fetched from the mint account.",
        ),
    ] = -1,
    skip_preflight: Annotated[
        bool,
        typer.Option("--skip-preflight", help="Skip RPC preflight simulation."),
    ] = False,
) -> None:
    """Shield SPL balance into the confidential available counter."""
    asyncio.run(_run_shield(mint, amount, decimals, skip_preflight))


async def _run_shield(
    mint_str: str,
    amount_str: str,
    decimals_override: int,
    skip_preflight: bool,
) -> None:
    console = make_console()
    cfg = load_config()
    try:
        mint = Pubkey.from_string(mint_str)
    except ValueError as exc:
        raise typer.BadParameter(f"invalid mint pubkey: {mint_str!r}") from exc

    signer_bytes = load_signer_bytes(cfg.keypair.path)
    payer = load_keypair(cfg.keypair.path)
    owner_pubkey = payer.pubkey()

    async with connected(cfg) as rpc:
        decimals = decimals_override
        if decimals < 0:
            with progress_spinner(console, "fetching mint decimals"):
                decimals = await _fetch_mint_decimals(rpc, mint)

        base_units = parse_amount(amount_str, decimals)
        elgamal = derive_elgamal_from_signer(signer_bytes, context=b"user:default")
        ciphertext = encrypt(elgamal.public, base_units)

        config_addr, config_bump = config_pda()
        auditor_addr, _ = auditor_pda(mint)
        padding_addr, _ = padding_vault_pda(mint)

        data = bytearray()
        data.extend(SHIELD_DISCRIMINATOR)
        data.extend(struct.pack("<Q", base_units))
        data.extend(ciphertext.to_bytes())
        data.extend(elgamal.public.to_bytes())
        data.extend(struct.pack("<I", RECOMMENDED_CU_BUDGET))
        data.append(config_bump)

        accounts = [
            AccountMeta(pubkey=owner_pubkey, is_signer=True, is_writable=True),
            AccountMeta(pubkey=mint, is_signer=False, is_writable=False),
            AccountMeta(pubkey=config_addr, is_signer=False, is_writable=False),
            AccountMeta(pubkey=auditor_addr, is_signer=False, is_writable=False),
            AccountMeta(pubkey=padding_addr, is_signer=False, is_writable=True),
            AccountMeta(
                pubkey=Pubkey.from_string(TOKEN_2022_PROGRAM_ID),
                is_signer=False,
                is_writable=False,
            ),
            AccountMeta(
                pubkey=Pubkey.from_string(ZK_TOKEN_PROOF_PROGRAM_ID),
                is_signer=False,
                is_writable=False,
            ),
        ]
        ix = Instruction(
            program_id=Pubkey.from_string(PROGRAM_ID),
            data=bytes(data),
            accounts=accounts,
        )
        with progress_spinner(console, "building and signing transaction"):
            tx = await rpc.build_transaction([ix], payer=owner_pubkey, signers=[payer])
        with progress_spinner(console, "submitting to cluster"):
            result = await rpc.send_and_confirm(tx, skip_preflight=skip_preflight)

    print_kv_table(
        console,
        {
            "mint": str(mint),
            "amount": format_amount(base_units, decimals),
            "base_units": base_units,
            "decimals": decimals,
            "elgamal_pubkey": elgamal.public.to_bytes().hex(),
            "signature": result.signature,
            "slot": result.slot,
            "status": result.confirmation_status,
        },
        title="ghos shield",
    )
    print_success(console, f"shielded {format_amount(base_units, decimals)} into confidential balance")


async def _fetch_mint_decimals(rpc, mint: Pubkey) -> int:
    """Read the decimals byte from a Token-2022 mint account.

    The Token-2022 mint layout places the `decimals` byte at offset 44
    of the 82-byte base account (before any extensions). Extensions live
    past byte 165 and do not shift the decimals location.
    """
    account = await rpc.get_account(mint)
    if account is None:
        raise typer.BadParameter(f"mint account {mint} does not exist on cluster")
    data = account["data"]
    if len(data) < 82:
        raise typer.BadParameter(f"mint account {mint} is too small to be a mint")
    return int(data[44])
