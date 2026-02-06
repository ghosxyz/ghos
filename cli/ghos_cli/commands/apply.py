"""`ghos apply` command.

Drains the pending confidential counter into the available counter for
the caller's account on the given mint. This is a no-op if the pending
counter is already zero; the on-chain program returns `NothingToApply`
which we surface as a soft warning rather than an error exit.
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
)
from ghos_cli.crypto import derive_elgamal_from_signer
from ghos_cli.crypto.keys import load_keypair, load_signer_bytes
from ghos_cli.display import make_console, print_kv_table, print_success, progress_spinner
from ghos_cli.pdas import config_pda

APPLY_PENDING_DISCRIMINATOR: bytes = bytes.fromhex("1f29a1b86ad45c77")


def apply_command(
    mint: Annotated[
        str,
        typer.Option("--mint", "-m", help="Token-2022 mint address."),
    ],
    skip_preflight: Annotated[
        bool,
        typer.Option("--skip-preflight", help="Skip RPC preflight simulation."),
    ] = False,
) -> None:
    """Apply pending confidential balance into available balance."""
    asyncio.run(_run_apply(mint, skip_preflight))


async def _run_apply(mint_str: str, skip_preflight: bool) -> None:
    console = make_console()
    cfg = load_config()
    try:
        mint = Pubkey.from_string(mint_str)
    except ValueError as exc:
        raise typer.BadParameter(f"invalid mint pubkey: {mint_str!r}") from exc

    signer_bytes = load_signer_bytes(cfg.keypair.path)
    payer = load_keypair(cfg.keypair.path)
    owner_pubkey = payer.pubkey()

    elgamal = derive_elgamal_from_signer(signer_bytes, context=b"user:default")
    config_addr, config_bump = config_pda()

    data = bytearray()
    data.extend(APPLY_PENDING_DISCRIMINATOR)
    data.extend(elgamal.public.to_bytes())
    data.extend(struct.pack("<I", RECOMMENDED_CU_BUDGET))
    data.append(config_bump)

    accounts = [
        AccountMeta(pubkey=owner_pubkey, is_signer=True, is_writable=True),
        AccountMeta(pubkey=mint, is_signer=False, is_writable=False),
        AccountMeta(pubkey=config_addr, is_signer=False, is_writable=False),
        AccountMeta(
            pubkey=Pubkey.from_string(TOKEN_2022_PROGRAM_ID),
            is_signer=False,
            is_writable=False,
        ),
    ]
    ix = Instruction(
        program_id=Pubkey.from_string(PROGRAM_ID),
        data=bytes(data),
        accounts=accounts,
    )

    async with connected(cfg) as rpc:
        with progress_spinner(console, "building and signing transaction"):
            tx = await rpc.build_transaction([ix], payer=owner_pubkey, signers=[payer])
        with progress_spinner(console, "submitting to cluster"):
            result = await rpc.send_and_confirm(tx, skip_preflight=skip_preflight)

    print_kv_table(
        console,
        {
            "mint": str(mint),
            "owner": str(owner_pubkey),
            "signature": result.signature,
            "slot": result.slot,
            "status": result.confirmation_status,
        },
        title="ghos apply",
    )
    print_success(console, "pending balance applied into available balance")
