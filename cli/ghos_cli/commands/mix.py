"""`ghos mix` command group.

A CoinJoin round groups `N >= MIX_MIN_PARTICIPANTS` equal-denomination
notes into a single shuffled output set so that no observer can link a
specific input note to a specific output. The protocol is:

1. Host opens the round with `mix_init`.
2. Participants call `mix_join` (commit-only) in the commit phase,
   publishing `commit_hash(elgamal_pk, note, salt)`.
3. When the commit window closes, the round moves to reveal.
4. Each participant reveals `(elgamal_pk, note, salt)`; the program
   verifies the hash matches.
5. Once all reveals are in, anyone can call `mix_settle` to finalize.

This module implements `join`, `status`, and `settle` from the CLI
perspective. `commit_hash` is provided by `crypto.commit`.
"""

from __future__ import annotations

import asyncio
import os
import secrets
import struct
import time
from typing import Annotated

import typer
from solders.instruction import AccountMeta, Instruction
from solders.pubkey import Pubkey

from ghos_cli.client import connected
from ghos_cli.config import load_config
from ghos_cli.constants import (
    MIX_COMMITMENT_LEN,
    MIX_MAX_PARTICIPANTS,
    MIX_MIN_PARTICIPANTS,
    MIX_REVEAL_WINDOW_SECONDS,
    PROGRAM_ID,
    RECOMMENDED_CU_BUDGET,
)
from ghos_cli.crypto import commit_hash, derive_elgamal_from_signer, encrypt
from ghos_cli.crypto.keys import load_keypair, load_signer_bytes
from ghos_cli.display import (
    format_timestamp,
    make_console,
    print_kv_table,
    print_rows_table,
    print_success,
    print_warning,
    progress_spinner,
)
from ghos_cli.errors import MixError, NotFoundError
from ghos_cli.pdas import config_pda, mix_commitment_pda, mix_round_pda
from ghos_cli.units import format_amount, parse_amount, short_pubkey

MIX_JOIN_DISCRIMINATOR: bytes = bytes.fromhex("a712e4c9b15e8f66")
MIX_SETTLE_DISCRIMINATOR: bytes = bytes.fromhex("4d55b3c8acf0d221")

_MIX_PHASE_NAMES: dict[int, str] = {
    0: "open",
    1: "commit",
    2: "reveal",
    3: "settling",
    4: "settled",
    5: "aborted",
}

mix_app = typer.Typer(
    name="mix",
    help="Join, inspect, and settle CoinJoin mixing rounds.",
    no_args_is_help=True,
    rich_markup_mode=None,
)


@mix_app.command("join")
def mix_join(
    mint: Annotated[
        str,
        typer.Option("--mint", "-m", help="Token-2022 mint address."),
    ],
    denomination: Annotated[
        str,
        typer.Option("--denomination", "-d", help="Equal-note denomination."),
    ],
    round_id: Annotated[
        int,
        typer.Option(
            "--round-id",
            help="Host-chosen round id. When zero, the tool derives one from the current slot.",
        ),
    ] = 0,
    host: Annotated[
        str,
        typer.Option(
            "--host",
            help="Host address for the round. Defaults to the local keypair.",
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
    """Join a CoinJoin round by submitting a commitment."""
    asyncio.run(
        _run_join(mint, denomination, round_id, host, decimals, skip_preflight)
    )


@mix_app.command("status")
def mix_status(
    round_pda: Annotated[
        str,
        typer.Option("--round", help="Explicit round PDA to inspect."),
    ] = "",
    mint: Annotated[
        str,
        typer.Option(
            "--mint",
            help="Mint to list rounds for. Requires --host when provided.",
        ),
    ] = "",
    host: Annotated[
        str,
        typer.Option("--host", help="Host whose rounds to scan."),
    ] = "",
) -> None:
    """Inspect a specific round or the caller's currently-open rounds."""
    asyncio.run(_run_status(round_pda, mint, host))


@mix_app.command("settle")
def mix_settle(
    round_pda: Annotated[
        str,
        typer.Option("--round", help="Round PDA to settle."),
    ],
    skip_preflight: Annotated[
        bool,
        typer.Option("--skip-preflight", help="Skip RPC preflight simulation."),
    ] = False,
) -> None:
    """Settle a round that has passed the reveal phase."""
    asyncio.run(_run_settle(round_pda, skip_preflight))


async def _run_join(
    mint_str: str,
    denomination_str: str,
    round_id: int,
    host_str: str,
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

    host_pubkey = owner_pubkey
    if host_str:
        try:
            host_pubkey = Pubkey.from_string(host_str)
        except ValueError as exc:
            raise typer.BadParameter(f"invalid host pubkey: {host_str!r}") from exc

    async with connected(cfg) as rpc:
        decimals = decimals_override
        if decimals < 0:
            with progress_spinner(console, "fetching mint decimals"):
                decimals = await _fetch_mint_decimals(rpc, mint)
        note_units = parse_amount(denomination_str, decimals)
        if round_id == 0:
            round_id = (await rpc.get_slot()) or int(time.time())

        round_addr, round_bump = mix_round_pda(mint, host_pubkey, round_id)
        commit_addr, commit_bump = mix_commitment_pda(round_addr, owner_pubkey)
        config_addr, config_bump = config_pda()

        elgamal = derive_elgamal_from_signer(signer_bytes, context=b"user:default")
        note_ct = encrypt(elgamal.public, note_units)
        salt = secrets.token_bytes(32)
        commitment_bytes = commit_hash(elgamal.public, note_ct, salt)
        if len(commitment_bytes) != MIX_COMMITMENT_LEN:
            raise MixError(
                f"commit_hash returned {len(commitment_bytes)} bytes, expected {MIX_COMMITMENT_LEN}"
            )

        data = bytearray()
        data.extend(MIX_JOIN_DISCRIMINATOR)
        data.extend(struct.pack("<Q", round_id))
        data.extend(struct.pack("<Q", note_units))
        data.extend(commitment_bytes)
        data.extend(struct.pack("<I", RECOMMENDED_CU_BUDGET))
        data.append(round_bump)
        data.append(commit_bump)
        data.append(config_bump)

        accounts = [
            AccountMeta(pubkey=owner_pubkey, is_signer=True, is_writable=True),
            AccountMeta(pubkey=host_pubkey, is_signer=False, is_writable=False),
            AccountMeta(pubkey=mint, is_signer=False, is_writable=False),
            AccountMeta(pubkey=round_addr, is_signer=False, is_writable=True),
            AccountMeta(pubkey=commit_addr, is_signer=False, is_writable=True),
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
        with progress_spinner(console, "building and signing transaction"):
            tx = await rpc.build_transaction([ix], payer=owner_pubkey, signers=[payer])
        with progress_spinner(console, "submitting to cluster"):
            result = await rpc.send_and_confirm(tx, skip_preflight=skip_preflight)

    salt_cache_path = _store_reveal_material(
        round_addr, owner_pubkey, elgamal_pk=elgamal.public.to_bytes(), note=note_ct.to_bytes(), salt=salt
    )

    print_kv_table(
        console,
        {
            "mint": str(mint),
            "host": str(host_pubkey),
            "round_id": round_id,
            "round_pda": str(round_addr),
            "commit_pda": str(commit_addr),
            "denomination": format_amount(note_units, decimals),
            "commitment": commitment_bytes.hex(),
            "reveal_material": str(salt_cache_path),
            "signature": result.signature,
            "status": result.confirmation_status,
        },
        title="ghos mix join",
    )
    print_success(console, f"committed to round {round_addr}")


async def _run_status(round_pda_str: str, mint_str: str, host_str: str) -> None:
    console = make_console()
    cfg = load_config()
    async with connected(cfg) as rpc:
        if round_pda_str:
            try:
                round_addr = Pubkey.from_string(round_pda_str)
            except ValueError as exc:
                raise typer.BadParameter(
                    f"invalid round pubkey: {round_pda_str!r}"
                ) from exc
            account = await rpc.get_account(round_addr)
            if account is None:
                raise NotFoundError(f"round {round_addr} does not exist on chain")
            parsed = _parse_mix_round(account["data"])
            print_kv_table(
                console,
                {
                    "round_pda": str(round_addr),
                    "mint": str(Pubkey(parsed["mint"])),
                    "host": str(Pubkey(parsed["host"])),
                    "denomination": parsed["denomination"],
                    "capacity": parsed["capacity"],
                    "committed": parsed["committed"],
                    "revealed": parsed["revealed"],
                    "phase": _MIX_PHASE_NAMES.get(parsed["phase"], str(parsed["phase"])),
                    "opened_at": format_timestamp(parsed["opened_at"]),
                    "commit_close_at": format_timestamp(parsed["commit_close_at"]),
                    "reveal_close_at": format_timestamp(parsed["reveal_close_at"]),
                    "settled_at": format_timestamp(parsed["settled_at"]),
                },
                title="ghos mix status",
            )
            return

        if not (mint_str and host_str):
            print_warning(
                console,
                "no --round supplied; provide --mint and --host to scan, or --round directly",
            )
            return

        try:
            mint = Pubkey.from_string(mint_str)
        except ValueError as exc:
            raise typer.BadParameter(f"invalid mint pubkey: {mint_str!r}") from exc
        try:
            host = Pubkey.from_string(host_str)
        except ValueError as exc:
            raise typer.BadParameter(f"invalid host pubkey: {host_str!r}") from exc

        rows: list[list[object]] = []
        current_slot = await rpc.get_slot()
        scan_lower = max(0, current_slot - 200)
        for round_id in range(scan_lower, current_slot + 1):
            addr, _ = mix_round_pda(mint, host, round_id)
            acc = await rpc.get_account(addr)
            if acc is None:
                continue
            parsed = _parse_mix_round(acc["data"])
            rows.append(
                [
                    round_id,
                    short_pubkey(str(addr), 6, 6),
                    parsed["denomination"],
                    f"{parsed['committed']}/{parsed['capacity']}",
                    _MIX_PHASE_NAMES.get(parsed["phase"], str(parsed["phase"])),
                ]
            )
        if not rows:
            print_warning(
                console, f"no rounds found in recent slots for mint={mint} host={host}"
            )
            return
        print_rows_table(
            console,
            columns=["round_id", "pda", "denomination", "committed", "phase"],
            rows=rows,
            title="ghos mix status",
        )


async def _run_settle(round_pda_str: str, skip_preflight: bool) -> None:
    console = make_console()
    cfg = load_config()
    try:
        round_addr = Pubkey.from_string(round_pda_str)
    except ValueError as exc:
        raise typer.BadParameter(f"invalid round pubkey: {round_pda_str!r}") from exc
    payer = load_keypair(cfg.keypair.path)
    owner_pubkey = payer.pubkey()
    config_addr, config_bump = config_pda()

    data = bytearray()
    data.extend(MIX_SETTLE_DISCRIMINATOR)
    data.extend(struct.pack("<I", RECOMMENDED_CU_BUDGET))
    data.append(config_bump)

    accounts = [
        AccountMeta(pubkey=owner_pubkey, is_signer=True, is_writable=True),
        AccountMeta(pubkey=round_addr, is_signer=False, is_writable=True),
        AccountMeta(pubkey=config_addr, is_signer=False, is_writable=False),
    ]
    ix = Instruction(
        program_id=Pubkey.from_string(PROGRAM_ID),
        data=bytes(data),
        accounts=accounts,
    )

    async with connected(cfg) as rpc:
        account = await rpc.get_account(round_addr)
        if account is None:
            raise NotFoundError(f"round {round_addr} does not exist on chain")
        parsed = _parse_mix_round(account["data"])
        if parsed["committed"] < MIX_MIN_PARTICIPANTS:
            raise MixError(
                f"round has {parsed['committed']} commits, need at least {MIX_MIN_PARTICIPANTS}"
            )
        if parsed["phase"] not in {2, 3}:
            raise MixError(
                f"round is in phase {_MIX_PHASE_NAMES.get(parsed['phase'], parsed['phase'])}, "
                f"expected reveal or settling"
            )
        with progress_spinner(console, "building and signing transaction"):
            tx = await rpc.build_transaction([ix], payer=owner_pubkey, signers=[payer])
        with progress_spinner(console, "submitting to cluster"):
            result = await rpc.send_and_confirm(tx, skip_preflight=skip_preflight)

    print_kv_table(
        console,
        {
            "round_pda": str(round_addr),
            "phase_before": _MIX_PHASE_NAMES.get(parsed["phase"], parsed["phase"]),
            "committed": parsed["committed"],
            "capacity": parsed["capacity"],
            "signature": result.signature,
            "status": result.confirmation_status,
        },
        title="ghos mix settle",
    )
    print_success(console, f"round {round_addr} settled")


async def _fetch_mint_decimals(rpc, mint: Pubkey) -> int:
    account = await rpc.get_account(mint)
    if account is None:
        raise typer.BadParameter(f"mint account {mint} does not exist on cluster")
    data = account["data"]
    if len(data) < 82:
        raise typer.BadParameter(f"mint account {mint} is too small to be a mint")
    return int(data[44])


def _parse_mix_round(data: bytes) -> dict[str, object]:
    """Parse the on-chain `MixRound` struct.

    Layout (little-endian, after 8-byte Anchor discriminator):
    - mint: 32 bytes
    - denomination: u64
    - host: 32 bytes
    - capacity: u8, committed: u8, revealed: u8
    - phase: u8
    - opened_at, commit_close_at, reveal_close_at, settled_at: i64
    - bump: u8
    - reserved: 32 bytes
    """
    expected = 8 + 32 + 8 + 32 + 1 + 1 + 1 + 1 + 8 + 8 + 8 + 8 + 1 + 32
    if len(data) < expected:
        raise NotFoundError(f"mix round account data too short: {len(data)} bytes")
    cursor = 8
    mint_bytes = bytes(data[cursor : cursor + 32])
    cursor += 32
    denomination = struct.unpack_from("<Q", data, cursor)[0]
    cursor += 8
    host_bytes = bytes(data[cursor : cursor + 32])
    cursor += 32
    capacity = data[cursor]
    cursor += 1
    committed = data[cursor]
    cursor += 1
    revealed = data[cursor]
    cursor += 1
    phase = data[cursor]
    cursor += 1
    opened_at = struct.unpack_from("<q", data, cursor)[0]
    cursor += 8
    commit_close_at = struct.unpack_from("<q", data, cursor)[0]
    cursor += 8
    reveal_close_at = struct.unpack_from("<q", data, cursor)[0]
    cursor += 8
    settled_at = struct.unpack_from("<q", data, cursor)[0]
    cursor += 8
    bump = data[cursor]
    return {
        "mint": mint_bytes,
        "denomination": denomination,
        "host": host_bytes,
        "capacity": capacity,
        "committed": committed,
        "revealed": revealed,
        "phase": phase,
        "opened_at": opened_at,
        "commit_close_at": commit_close_at,
        "reveal_close_at": reveal_close_at,
        "settled_at": settled_at,
        "bump": bump,
    }


def _store_reveal_material(
    round_addr: Pubkey,
    participant: Pubkey,
    *,
    elgamal_pk: bytes,
    note: bytes,
    salt: bytes,
) -> str:
    """Persist the reveal material to a local cache file.

    The file lives at `~/.config/ghos/reveals/<round>-<participant>.bin`
    and contains a fixed-size 128-byte blob that `ghos mix settle` can
    reload when the reveal phase opens.
    """
    cache_dir = os.path.expanduser("~/.config/ghos/reveals")
    os.makedirs(cache_dir, exist_ok=True)
    path = os.path.join(cache_dir, f"{round_addr}-{participant}.bin")
    blob = bytearray()
    blob.extend(elgamal_pk)
    blob.extend(note)
    # Length-prefix the salt so load/store is unambiguous.
    blob.extend(len(salt).to_bytes(2, "little"))
    blob.extend(salt)
    with open(path, "wb") as fh:
        fh.write(bytes(blob))
    # Make the file owner-only readable when the platform supports it.
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    return path
