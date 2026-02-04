"""`ghos config` command group.

Two subcommands:

* `ghos config show` prints the current configuration, merged with env
  var overrides, as a rich tree.
* `ghos config set <key> <value>` mutates a single dotted-key field and
  persists the file back to `~/.config/ghos/config.toml`.
"""

from __future__ import annotations

from typing import Annotated

import typer

from ghos_cli.config import (
    default_config_path,
    load_config,
    save_config,
    set_value,
)
from ghos_cli.display import make_console, print_kv_table, print_success, print_tree

config_app = typer.Typer(
    name="config",
    help="Inspect and update the ghos-cli configuration file.",
    no_args_is_help=True,
    rich_markup_mode=None,
)


@config_app.command("show")
def config_show(
    path_only: Annotated[
        bool,
        typer.Option(
            "--path-only",
            help="Print only the config file path and exit.",
        ),
    ] = False,
) -> None:
    """Show the current configuration."""
    console = make_console()
    cfg = load_config()
    source = cfg._source_path or default_config_path()
    if path_only:
        console.print(str(source))
        return
    tree = {
        "source": str(source),
        "cluster": {
            "name": cfg.cluster.name,
            "rpc_url": cfg.cluster.rpc_url,
            "ws_url": cfg.cluster.ws_url,
            "commitment": cfg.cluster.commitment,
        },
        "keypair": {
            "path": cfg.keypair.path,
            "elgamal_seed_path": cfg.keypair.elgamal_seed_path or "-",
        },
        "auditor": {
            "enabled": cfg.auditor.enabled,
            "public_key": cfg.auditor.public_key or "-",
            "secret_key_path": cfg.auditor.secret_key_path or "-",
        },
        "ui": {
            "color": cfg.ui.color,
            "compact": cfg.ui.compact,
            "timestamp_format": cfg.ui.timestamp_format,
        },
    }
    print_tree(console, "ghos config", tree)


@config_app.command("set")
def config_set(
    key: Annotated[
        str,
        typer.Argument(help="Dotted key, e.g. cluster.name, keypair.path."),
    ],
    value: Annotated[
        str,
        typer.Argument(help="New value for the key."),
    ],
) -> None:
    """Set a single configuration key and save."""
    console = make_console()
    cfg = load_config()
    new_cfg = set_value(cfg, key, value)
    path = save_config(new_cfg, cfg._source_path or default_config_path())
    print_kv_table(
        console,
        {
            "path": str(path),
            "key": key,
            "value": value,
        },
        title="ghos config set",
    )
    print_success(console, f"{key} = {value}")
