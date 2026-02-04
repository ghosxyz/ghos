"""`ghos init` command.

Writes a default `config.toml` for the chosen cluster and emits a
summary table. If a config file already exists, only the cluster
section is updated; keypair, auditor, and UI settings are preserved.
"""

from __future__ import annotations

from pathlib import Path
from typing import Annotated

import typer

from ghos_cli.config import (
    Config,
    default_config_path,
    load_config,
    save_config,
    set_value,
)
from ghos_cli.constants import DEFAULT_RPC, DEFAULT_WS, canonical_cluster
from ghos_cli.display import make_console, print_kv_table, print_success
from ghos_cli.errors import ConfigError


def init_command(
    cluster: Annotated[
        str,
        typer.Option(
            "--cluster",
            "-c",
            help="Cluster to target. One of: devnet, mainnet-beta, testnet, localnet.",
        ),
    ] = "devnet",
    rpc_url: Annotated[
        str,
        typer.Option(
            "--rpc-url",
            help="Override the default RPC URL for the chosen cluster.",
        ),
    ] = "",
    ws_url: Annotated[
        str,
        typer.Option(
            "--ws-url",
            help="Override the default WebSocket URL for the chosen cluster.",
        ),
    ] = "",
    keypair_path: Annotated[
        str,
        typer.Option(
            "--keypair",
            "-k",
            help="Path to the Solana keypair JSON file.",
        ),
    ] = "~/.config/solana/id.json",
    commitment: Annotated[
        str,
        typer.Option(
            "--commitment",
            help="RPC commitment level.",
        ),
    ] = "confirmed",
    force: Annotated[
        bool,
        typer.Option(
            "--force",
            "-f",
            help="Overwrite an existing config without prompting.",
        ),
    ] = False,
) -> None:
    """Initialize the ghos-cli configuration file."""
    console = make_console()
    try:
        canonical = canonical_cluster(cluster)
    except ValueError as exc:
        raise typer.BadParameter(str(exc)) from exc

    target_path = default_config_path()
    existing_exists = target_path.is_file()
    if existing_exists and not force:
        cfg = load_config(target_path)
    else:
        cfg = Config(_source_path=target_path)

    cfg = set_value(cfg, "cluster.name", canonical)
    if rpc_url:
        cfg = set_value(cfg, "cluster.rpc_url", rpc_url)
    else:
        cfg = set_value(cfg, "cluster.rpc_url", DEFAULT_RPC[canonical])
    if ws_url:
        cfg = set_value(cfg, "cluster.ws_url", ws_url)
    else:
        cfg = set_value(cfg, "cluster.ws_url", DEFAULT_WS[canonical])
    cfg = set_value(cfg, "cluster.commitment", commitment)
    cfg = set_value(cfg, "keypair.path", keypair_path)

    try:
        written_path: Path = save_config(cfg, target_path)
    except ConfigError as exc:
        raise typer.BadParameter(str(exc)) from exc

    print_kv_table(
        console,
        {
            "path": str(written_path),
            "cluster": cfg.cluster.name,
            "rpc_url": cfg.cluster.rpc_url,
            "ws_url": cfg.cluster.ws_url,
            "commitment": cfg.cluster.commitment,
            "keypair": cfg.keypair.path,
            "existing": "preserved" if existing_exists and not force else "created",
        },
        title="ghos init",
    )
    print_success(console, f"config written to {written_path}")
