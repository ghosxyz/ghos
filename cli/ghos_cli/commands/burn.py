"""`ghos burner` command group.

Burner accounts are short-lived keypairs registered on-chain for a
limited TTL, after which the program rejects any transaction that
references them. They are used to avoid leaking long-lived user
addresses to counterparties during sensitive flows.
"""

from __future__ import annotations

import asyncio
import struct
import time
from typing import Annotated

import typer
from solders.instruction import AccountMeta, Instruction
from solders.pubkey import Pubkey

from ghos_cli.client import connected
from ghos_cli.config import load_config
from ghos_cli.constants import (
    BURNER_REGISTRY_CAP_PER_OWNER,
    PROGRAM_ID,
    RECOMMENDED_CU_BUDGET,
)
from ghos_cli.crypto.keys import derive_burner_elgamal, load_keypair, load_signer_bytes
from ghos_cli.display import (
    format_timestamp,
    make_console,
    print_kv_table,
    print_rows_table,
    print_success,
    print_warning,
    progress_spinner,
)
from ghos_cli.errors import NotFoundError
from ghos_cli.pdas import burner_pda, config_pda
from ghos_cli.units import format_duration, parse_duration, short_pubkey

CREATE_BURNER_DISCRIMINATOR: bytes = bytes.fromhex("4a82bf18a8a1e713")
DESTROY_BURNER_DISCRIMINATOR: bytes = bytes.fromhex("9a49f3a8c72b6e2c")

burner_app = typer.Typer(
    name="burner",
    help="Create, inspect, and destroy ephemeral burner accounts.",
    no_args_is_help=True,
    rich_markup_mode=None,
)


@burner_app.command("create")
def burner_create(
    ttl: Annotated[
        str,
        typer.Option("--ttl", "-t", help="Time-to-live, e.g. 24h, 30m, 7d, 900s."),
    ] = "24h",
    nonce: Annotated[
        int,
        typer.Option(
            "--nonce",
            "-n",
            help="Burner registry slot nonce (0..63).",
        ),
    ] = 0,
    skip_preflight: Annotated[
        bool,
        typer.Option("--skip-preflight", help="Skip RPC preflight simulation."),
    ] = False,
) -> None:
    """Create a new burner account that expires after `ttl`."""
    asyncio.run(_run_create(ttl, nonce, skip_preflight))


@burner_app.command("list")
def burner_list() -> None:
    """List all live and expired burner slots for the configured keypair."""
    asyncio.run(_run_list())


@burner_app.command("destroy")
def burner_destroy(
    burner: Annotated[
        str,
        typer.Argument(help="Burner PDA address to destroy."),
    ],
    skip_preflight: Annotated[
        bool,
        typer.Option("--skip-preflight", help="Skip RPC preflight simulation."),
    ] = False,
) -> None:
    """Revoke a burner slot before its TTL expires."""
    asyncio.run(_run_destroy(burner, skip_preflight))


async def _run_create(ttl: str, nonce: int, skip_preflight: bool) -> None:
    console = make_console()
    if nonce < 0 or nonce >= BURNER_REGISTRY_CAP_PER_OWNER:
        raise typer.BadParameter(
            f"nonce {nonce} out of range [0, {BURNER_REGISTRY_CAP_PER_OWNER})"
        )
    ttl_seconds = parse_duration(ttl)
    cfg = load_config()
    signer_bytes = load_signer_bytes(cfg.keypair.path)
    payer = load_keypair(cfg.keypair.path)
    owner_pubkey = payer.pubkey()

    burner_addr, burner_bump = burner_pda(owner_pubkey, nonce)
    burner_elgamal = derive_burner_elgamal(signer_bytes, nonce)
    config_addr, config_bump = config_pda()
    now = int(time.time())
    expires_at = now + ttl_seconds

    data = bytearray()
    data.extend(CREATE_BURNER_DISCRIMINATOR)
    data.extend(struct.pack("<Q", nonce))
    data.extend(struct.pack("<q", ttl_seconds))
    data.extend(burner_elgamal.public.to_bytes())
    data.extend(struct.pack("<I", RECOMMENDED_CU_BUDGET))
    data.append(burner_bump)
    data.append(config_bump)

    accounts = [
        AccountMeta(pubkey=owner_pubkey, is_signer=True, is_writable=True),
        AccountMeta(pubkey=burner_addr, is_signer=False, is_writable=True),
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
            "owner": str(owner_pubkey),
            "nonce": nonce,
            "burner_pda": str(burner_addr),
            "ttl": format_duration(ttl_seconds),
            "expires_at": format_timestamp(expires_at),
            "elgamal_pubkey": burner_elgamal.public.to_bytes().hex(),
            "signature": result.signature,
            "status": result.confirmation_status,
        },
        title="ghos burner create",
    )
    print_success(console, f"burner registered at {burner_addr}")


async def _run_list() -> None:
    console = make_console()
    cfg = load_config()
    payer = load_keypair(cfg.keypair.path)
    owner_pubkey = payer.pubkey()
    rows: list[list[object]] = []
    async with connected(cfg) as rpc:
        for nonce in range(BURNER_REGISTRY_CAP_PER_OWNER):
            addr, _ = burner_pda(owner_pubkey, nonce)
            account = await rpc.get_account(addr)
            if account is None:
                continue
            data = account["data"]
            parsed = _parse_burner_account(data)
            now = int(time.time())
            status = _burner_status(parsed, now)
            rows.append(
                [
                    nonce,
                    short_pubkey(str(addr), 6, 6),
                    format_timestamp(parsed["created_at"]),
                    format_timestamp(parsed["expires_at"]),
                    status,
                    parsed["usage_count"],
                ]
            )
    if not rows:
        print_warning(console, f"no burner slots registered for {owner_pubkey}")
        return
    print_rows_table(
        console,
        columns=["nonce", "pda", "created", "expires", "status", "uses"],
        rows=rows,
        title="ghos burner list",
    )


async def _run_destroy(burner_str: str, skip_preflight: bool) -> None:
    console = make_console()
    cfg = load_config()
    try:
        burner_addr = Pubkey.from_string(burner_str)
    except ValueError as exc:
        raise typer.BadParameter(f"invalid burner pubkey: {burner_str!r}") from exc
    payer = load_keypair(cfg.keypair.path)
    owner_pubkey = payer.pubkey()
    config_addr, config_bump = config_pda()

    data = bytearray()
    data.extend(DESTROY_BURNER_DISCRIMINATOR)
    data.extend(struct.pack("<I", RECOMMENDED_CU_BUDGET))
    data.append(config_bump)

    accounts = [
        AccountMeta(pubkey=owner_pubkey, is_signer=True, is_writable=True),
        AccountMeta(pubkey=burner_addr, is_signer=False, is_writable=True),
        AccountMeta(pubkey=config_addr, is_signer=False, is_writable=False),
    ]
    ix = Instruction(
        program_id=Pubkey.from_string(PROGRAM_ID),
        data=bytes(data),
        accounts=accounts,
    )

    async with connected(cfg) as rpc:
        existing = await rpc.get_account(burner_addr)
        if existing is None:
            raise NotFoundError(f"burner account {burner_addr} not found on chain")
        with progress_spinner(console, "building and signing transaction"):
            tx = await rpc.build_transaction([ix], payer=owner_pubkey, signers=[payer])
        with progress_spinner(console, "submitting to cluster"):
            result = await rpc.send_and_confirm(tx, skip_preflight=skip_preflight)

    print_kv_table(
        console,
        {
            "burner": str(burner_addr),
            "owner": str(owner_pubkey),
            "signature": result.signature,
            "status": result.confirmation_status,
        },
        title="ghos burner destroy",
    )
    print_success(console, f"burner {burner_addr} revoked")


def _parse_burner_account(data: bytes) -> dict[str, object]:
    """Parse the on-chain `BurnerAccount` struct from raw account data.

    Layout (little-endian, after the 8-byte Anchor discriminator):
    - owner: 32 bytes
    - burner_pubkey: 32 bytes
    - created_at: i64
    - expires_at: i64
    - nonce: u64
    - revoked: u8
    - usage_count: u32
    - bump: u8
    - reserved: 16 bytes
    """
    if len(data) < 8 + 32 + 32 + 8 + 8 + 8 + 1 + 4 + 1 + 16:
        raise NotFoundError(f"burner account data too short: {len(data)} bytes")
    cursor = 8
    owner = bytes(data[cursor : cursor + 32])
    cursor += 32
    burner_pubkey = bytes(data[cursor : cursor + 32])
    cursor += 32
    created_at = struct.unpack_from("<q", data, cursor)[0]
    cursor += 8
    expires_at = struct.unpack_from("<q", data, cursor)[0]
    cursor += 8
    nonce = struct.unpack_from("<Q", data, cursor)[0]
    cursor += 8
    revoked = bool(data[cursor])
    cursor += 1
    usage_count = struct.unpack_from("<I", data, cursor)[0]
    cursor += 4
    bump = data[cursor]
    return {
        "owner": owner,
        "burner_pubkey": burner_pubkey,
        "created_at": created_at,
        "expires_at": expires_at,
        "nonce": nonce,
        "revoked": revoked,
        "usage_count": usage_count,
        "bump": bump,
    }


def _burner_status(parsed: dict[str, object], now: int) -> str:
    if parsed["revoked"]:
        return "revoked"
    if int(parsed["expires_at"]) <= now:
        return "expired"
    return "active"
