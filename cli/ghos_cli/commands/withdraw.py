"""`ghos withdraw` command.

Moves confidential balance back into a normal SPL Token-2022 balance.
The caller can optionally redirect the destination to a different ATA
via `--to`. When an auditor is registered for the mint, the program
requires the auditor co-sign payload to be present; the CLI does not
attempt to forge an auditor signature, and will surface the error.
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
from ghos_cli.crypto import derive_elgamal_from_signer
from ghos_cli.crypto.keys import load_keypair, load_signer_bytes
from ghos_cli.display import make_console, print_kv_table, print_success, progress_spinner
from ghos_cli.pdas import auditor_pda, config_pda
from ghos_cli.units import format_amount, parse_amount

WITHDRAW_DISCRIMINATOR: bytes = bytes.fromhex("65428cd36f4e1f1a")


def withdraw_command(
    mint: Annotated[
        str,
        typer.Option("--mint", "-m", help="Token-2022 mint address."),
    ],
    amount: Annotated[
        str,
        typer.Option("--amount", "-a", help="Decimal amount to withdraw."),
    ],
    to: Annotated[
        str,
        typer.Option(
            "--to",
            help="Destination token account. Defaults to the caller's ATA.",
        ),
    ] = "",
    decimals: Annotated[
        int,
        typer.Option("--decimals", help="Override mint decimals."),
    ] = -1,
    skip_preflight: Annotated[
        bool,
        typer.Option("--skip-preflight", help="Skip RPC preflight simulation."),
    ] = False,
) -> None:
    """Withdraw from the confidential available counter into SPL balance."""
    asyncio.run(_run_withdraw(mint, amount, to, decimals, skip_preflight))


async def _run_withdraw(
    mint_str: str,
    amount_str: str,
    to_str: str,
    decimals_override: int,
    skip_preflight: bool,
) -> None:
    console = make_console()
    cfg = load_config()
    try:
        mint = Pubkey.from_string(mint_str)
    except ValueError as exc:
        raise typer.BadParameter(f"invalid mint pubkey: {mint_str!r}") from exc
    destination: Pubkey | None = None
    if to_str:
        try:
            destination = Pubkey.from_string(to_str)
        except ValueError as exc:
            raise typer.BadParameter(f"invalid destination pubkey: {to_str!r}") from exc

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
        config_addr, config_bump = config_pda()
        auditor_addr, _ = auditor_pda(mint)
        target_ata = destination if destination is not None else owner_pubkey

        data = bytearray()
        data.extend(WITHDRAW_DISCRIMINATOR)
        data.extend(struct.pack("<Q", base_units))
        data.extend(elgamal.public.to_bytes())
        data.extend(struct.pack("<I", RECOMMENDED_CU_BUDGET))
        data.append(config_bump)

        accounts = [
            AccountMeta(pubkey=owner_pubkey, is_signer=True, is_writable=True),
            AccountMeta(pubkey=mint, is_signer=False, is_writable=False),
            AccountMeta(pubkey=target_ata, is_signer=False, is_writable=True),
            AccountMeta(pubkey=config_addr, is_signer=False, is_writable=False),
            AccountMeta(pubkey=auditor_addr, is_signer=False, is_writable=False),
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
            "destination": str(target_ata),
            "signature": result.signature,
            "slot": result.slot,
            "status": result.confirmation_status,
        },
        title="ghos withdraw",
    )
    print_success(console, f"withdrew {format_amount(base_units, decimals)} into public balance")


async def _fetch_mint_decimals(rpc, mint: Pubkey) -> int:
    account = await rpc.get_account(mint)
    if account is None:
        raise typer.BadParameter(f"mint account {mint} does not exist on cluster")
    data = account["data"]
    if len(data) < 82:
        raise typer.BadParameter(f"mint account {mint} is too small to be a mint")
    return int(data[44])
