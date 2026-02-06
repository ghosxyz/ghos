"""`ghos send` command.

Sends tokens to a recipient. The `--confidential` flag picks the
confidential transfer path (recipient is looked up by owner address,
and the on-chain instruction CPIs into Token-2022's confidential
transfer extension). Without the flag, a plain Token-2022 transfer is
emitted, still through the ghos program so that auditor-aware transfers
always surface the correct accounts.
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
from ghos_cli.pdas import auditor_pda, config_pda
from ghos_cli.units import format_amount, parse_amount

CONF_TRANSFER_DISCRIMINATOR: bytes = bytes.fromhex("7b241ddc5ef2a6e8")
PUBLIC_TRANSFER_DISCRIMINATOR: bytes = bytes.fromhex("a5f63e1a3d49c0b1")


def send_command(
    recipient: Annotated[
        str,
        typer.Argument(help="Recipient owner address (base58)."),
    ],
    amount: Annotated[
        str,
        typer.Argument(help="Decimal amount to send."),
    ],
    mint: Annotated[
        str,
        typer.Option("--mint", "-m", help="Token-2022 mint address."),
    ],
    confidential: Annotated[
        bool,
        typer.Option(
            "--confidential",
            "-c",
            help="Use the confidential transfer path (default).",
        ),
    ] = True,
    decimals: Annotated[
        int,
        typer.Option("--decimals", help="Override mint decimals."),
    ] = -1,
    skip_preflight: Annotated[
        bool,
        typer.Option("--skip-preflight", help="Skip RPC preflight simulation."),
    ] = False,
) -> None:
    """Send tokens, defaulting to the confidential transfer flow."""
    asyncio.run(
        _run_send(recipient, amount, mint, confidential, decimals, skip_preflight)
    )


async def _run_send(
    recipient_str: str,
    amount_str: str,
    mint_str: str,
    confidential: bool,
    decimals_override: int,
    skip_preflight: bool,
) -> None:
    console = make_console()
    cfg = load_config()
    try:
        mint = Pubkey.from_string(mint_str)
    except ValueError as exc:
        raise typer.BadParameter(f"invalid mint pubkey: {mint_str!r}") from exc
    try:
        recipient = Pubkey.from_string(recipient_str)
    except ValueError as exc:
        raise typer.BadParameter(f"invalid recipient pubkey: {recipient_str!r}") from exc

    signer_bytes = load_signer_bytes(cfg.keypair.path)
    payer = load_keypair(cfg.keypair.path)
    owner_pubkey = payer.pubkey()

    async with connected(cfg) as rpc:
        decimals = decimals_override
        if decimals < 0:
            with progress_spinner(console, "fetching mint decimals"):
                decimals = await _fetch_mint_decimals(rpc, mint)
        base_units = parse_amount(amount_str, decimals)

        sender_elgamal = derive_elgamal_from_signer(signer_bytes, context=b"user:default")
        recipient_elgamal = derive_elgamal_from_signer(
            bytes(recipient) + bytes(mint),
            context=b"local:recipient",
        )
        sender_ciphertext = encrypt(sender_elgamal.public, base_units)
        recipient_ciphertext = encrypt(recipient_elgamal.public, base_units)

        config_addr, config_bump = config_pda()
        auditor_addr, _ = auditor_pda(mint)

        data = bytearray()
        if confidential:
            data.extend(CONF_TRANSFER_DISCRIMINATOR)
        else:
            data.extend(PUBLIC_TRANSFER_DISCRIMINATOR)
        data.extend(struct.pack("<Q", base_units))
        data.extend(sender_ciphertext.to_bytes())
        data.extend(recipient_ciphertext.to_bytes())
        data.extend(sender_elgamal.public.to_bytes())
        data.extend(recipient_elgamal.public.to_bytes())
        data.extend(struct.pack("<I", RECOMMENDED_CU_BUDGET))
        data.append(config_bump)

        accounts = [
            AccountMeta(pubkey=owner_pubkey, is_signer=True, is_writable=True),
            AccountMeta(pubkey=recipient, is_signer=False, is_writable=True),
            AccountMeta(pubkey=mint, is_signer=False, is_writable=False),
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
            "recipient": str(recipient),
            "amount": format_amount(base_units, decimals),
            "base_units": base_units,
            "mode": "confidential" if confidential else "public",
            "signature": result.signature,
            "slot": result.slot,
            "status": result.confirmation_status,
        },
        title="ghos send",
    )
    print_success(console, f"sent {format_amount(base_units, decimals)} to {recipient}")


async def _fetch_mint_decimals(rpc, mint: Pubkey) -> int:
    account = await rpc.get_account(mint)
    if account is None:
        raise typer.BadParameter(f"mint account {mint} does not exist on cluster")
    data = account["data"]
    if len(data) < 82:
        raise typer.BadParameter(f"mint account {mint} is too small to be a mint")
    return int(data[44])
