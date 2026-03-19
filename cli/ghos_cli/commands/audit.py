"""`ghos audit` command group.

Auditor registry operations: register an auditor for a mint, rotate
the auditor key, and list all auditor entries discoverable from the
local config.
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
    AUDITOR_PUBKEY_LEN,
    PROGRAM_ID,
    RECOMMENDED_CU_BUDGET,
)
from ghos_cli.crypto.elgamal import PublicKey as ElGamalPublicKey
from ghos_cli.crypto.keys import load_keypair
from ghos_cli.display import (
    format_timestamp,
    make_console,
    print_kv_table,
    print_rows_table,
    print_success,
    print_warning,
    progress_spinner,
)
from ghos_cli.errors import AuditorError, NotFoundError
from ghos_cli.pdas import auditor_pda, config_pda
from ghos_cli.units import short_pubkey

AUDITOR_REGISTER_DISCRIMINATOR: bytes = bytes.fromhex("8c3f2a7c0d15b48b")
AUDITOR_ROTATE_DISCRIMINATOR: bytes = bytes.fromhex("d39ab1feac60ae27")

audit_app = typer.Typer(
    name="audit",
    help="Register, rotate, and list per-mint auditor entries.",
    no_args_is_help=True,
    rich_markup_mode=None,
)


@audit_app.command("register")
def audit_register(
    mint: Annotated[
        str,
        typer.Option("--mint", "-m", help="Token-2022 mint address."),
    ],
    auditor: Annotated[
        str,
        typer.Option(
            "--auditor",
            help="Auditor ElGamal public key, 64-char hex or base58 32 bytes.",
        ),
    ],
    skip_preflight: Annotated[
        bool,
        typer.Option("--skip-preflight", help="Skip RPC preflight simulation."),
    ] = False,
) -> None:
    """Register an ElGamal auditor pubkey for a mint."""
    asyncio.run(_run_register(mint, auditor, skip_preflight))


@audit_app.command("rotate")
def audit_rotate(
    mint: Annotated[
        str,
        typer.Option("--mint", "-m", help="Token-2022 mint address."),
    ],
    auditor: Annotated[
        str,
        typer.Option(
            "--auditor",
            help="New auditor ElGamal public key.",
        ),
    ],
    skip_preflight: Annotated[
        bool,
        typer.Option("--skip-preflight", help="Skip RPC preflight simulation."),
    ] = False,
) -> None:
    """Rotate the auditor key, invalidating the previous one."""
    asyncio.run(_run_rotate(mint, auditor, skip_preflight))


@audit_app.command("list")
def audit_list(
    mints: Annotated[
        list[str] | None,
        typer.Option(
            "--mint",
            help="Mints to look up (repeat flag). Required because there is no on-chain index.",
        ),
    ] = None,
) -> None:
    """List auditor entries for the given mints."""
    asyncio.run(_run_list(mints or []))


async def _run_register(mint_str: str, auditor_str: str, skip_preflight: bool) -> None:
    console = make_console()
    cfg = load_config()
    try:
        mint = Pubkey.from_string(mint_str)
    except ValueError as exc:
        raise typer.BadParameter(f"invalid mint pubkey: {mint_str!r}") from exc
    auditor_key_bytes = _decode_auditor_pubkey(auditor_str)
    payer = load_keypair(cfg.keypair.path)
    owner_pubkey = payer.pubkey()
    auditor_addr, auditor_bump = auditor_pda(mint)
    config_addr, config_bump = config_pda()

    data = bytearray()
    data.extend(AUDITOR_REGISTER_DISCRIMINATOR)
    data.extend(auditor_key_bytes)
    data.extend(struct.pack("<I", RECOMMENDED_CU_BUDGET))
    data.append(auditor_bump)
    data.append(config_bump)

    accounts = [
        AccountMeta(pubkey=owner_pubkey, is_signer=True, is_writable=True),
        AccountMeta(pubkey=mint, is_signer=False, is_writable=False),
        AccountMeta(pubkey=auditor_addr, is_signer=False, is_writable=True),
        AccountMeta(pubkey=config_addr, is_signer=False, is_writable=False),
        AccountMeta(
            pubkey=Pubkey.from_string("11111111111111111111111111111111"),
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
            "auditor_pda": str(auditor_addr),
            "auditor_pubkey": auditor_key_bytes.hex(),
            "signature": result.signature,
            "status": result.confirmation_status,
        },
        title="ghos audit register",
    )
    print_success(console, f"auditor registered for mint {mint}")


async def _run_rotate(mint_str: str, auditor_str: str, skip_preflight: bool) -> None:
    console = make_console()
    cfg = load_config()
    try:
        mint = Pubkey.from_string(mint_str)
    except ValueError as exc:
        raise typer.BadParameter(f"invalid mint pubkey: {mint_str!r}") from exc
    auditor_key_bytes = _decode_auditor_pubkey(auditor_str)
    payer = load_keypair(cfg.keypair.path)
    owner_pubkey = payer.pubkey()
    auditor_addr, auditor_bump = auditor_pda(mint)
    config_addr, config_bump = config_pda()

    data = bytearray()
    data.extend(AUDITOR_ROTATE_DISCRIMINATOR)
    data.extend(auditor_key_bytes)
    data.extend(struct.pack("<I", RECOMMENDED_CU_BUDGET))
    data.append(auditor_bump)
    data.append(config_bump)

    accounts = [
        AccountMeta(pubkey=owner_pubkey, is_signer=True, is_writable=True),
        AccountMeta(pubkey=mint, is_signer=False, is_writable=False),
        AccountMeta(pubkey=auditor_addr, is_signer=False, is_writable=True),
        AccountMeta(pubkey=config_addr, is_signer=False, is_writable=False),
    ]
    ix = Instruction(
        program_id=Pubkey.from_string(PROGRAM_ID),
        data=bytes(data),
        accounts=accounts,
    )

    async with connected(cfg) as rpc:
        existing = await rpc.get_account(auditor_addr)
        if existing is None:
            raise AuditorError(
                f"auditor entry for mint {mint} does not exist; use `audit register` first"
            )
        with progress_spinner(console, "building and signing transaction"):
            tx = await rpc.build_transaction([ix], payer=owner_pubkey, signers=[payer])
        with progress_spinner(console, "submitting to cluster"):
            result = await rpc.send_and_confirm(tx, skip_preflight=skip_preflight)

    print_kv_table(
        console,
        {
            "mint": str(mint),
            "auditor_pda": str(auditor_addr),
            "new_pubkey": auditor_key_bytes.hex(),
            "signature": result.signature,
            "status": result.confirmation_status,
        },
        title="ghos audit rotate",
    )
    print_success(console, f"auditor rotated for mint {mint}")


async def _run_list(mints: list[str]) -> None:
    console = make_console()
    if not mints:
        print_warning(
            console, "list requires one or more --mint values; nothing to scan"
        )
        return
    cfg = load_config()
    rows: list[list[object]] = []
    async with connected(cfg) as rpc:
        for mint_str in mints:
            try:
                mint = Pubkey.from_string(mint_str)
            except ValueError:
                rows.append([mint_str, "-", "invalid", "-", "-"])
                continue
            auditor_addr, _ = auditor_pda(mint)
            acc = await rpc.get_account(auditor_addr)
            if acc is None:
                rows.append([str(mint), "-", "absent", "-", "-"])
                continue
            parsed = _parse_auditor_entry(acc["data"])
            rows.append(
                [
                    str(mint),
                    short_pubkey(str(auditor_addr), 6, 6),
                    "present",
                    format_timestamp(parsed["registered_at"]),
                    format_timestamp(parsed["last_rotated_at"]),
                ]
            )
    print_rows_table(
        console,
        columns=["mint", "auditor_pda", "status", "registered", "last_rotated"],
        rows=rows,
        title="ghos audit list",
    )


def _decode_auditor_pubkey(value: str) -> bytes:
    """Parse an auditor key from hex or base58."""
    value = value.strip()
    if len(value) == 2 * AUDITOR_PUBKEY_LEN:
        try:
            return bytes.fromhex(value)
        except ValueError as exc:
            raise AuditorError(f"invalid hex auditor key: {value!r}") from exc
    try:
        pk = ElGamalPublicKey.from_bytes(bytes(Pubkey.from_string(value)))
        return pk.to_bytes()
    except (ValueError, NotFoundError) as exc:
        raise AuditorError(f"invalid auditor key: {value!r}") from exc


def _parse_auditor_entry(data: bytes) -> dict[str, object]:
    """Parse the `AuditorEntry` struct from raw account data.

    Layout (little-endian, after 8-byte Anchor discriminator):
    - mint: 32 bytes
    - auditor_pubkey: 32 bytes
    - registered_at, last_rotated_at, rotation_cooldown: i64
    - admin: 32 bytes
    - bump: u8
    - reserved: 16 bytes
    """
    expected = 8 + 32 + 32 + 8 + 8 + 8 + 32 + 1 + 16
    if len(data) < expected:
        raise NotFoundError(f"auditor entry data too short: {len(data)} bytes")
    cursor = 8
    mint = bytes(data[cursor : cursor + 32])
    cursor += 32
    auditor_pubkey = bytes(data[cursor : cursor + 32])
    cursor += 32
    registered_at = struct.unpack_from("<q", data, cursor)[0]
    cursor += 8
    last_rotated_at = struct.unpack_from("<q", data, cursor)[0]
    cursor += 8
    rotation_cooldown = struct.unpack_from("<q", data, cursor)[0]
    cursor += 8
    admin = bytes(data[cursor : cursor + 32])
    cursor += 32
    bump = data[cursor]
    return {
        "mint": mint,
        "auditor_pubkey": auditor_pubkey,
        "registered_at": registered_at,
        "last_rotated_at": last_rotated_at,
        "rotation_cooldown": rotation_cooldown,
        "admin": admin,
        "bump": bump,
    }
