"""Top-level Typer command tree.

Wires every handler declared in `ghos_cli.commands` into a single
`app` object, which is what the `ghos` script and
`python -m ghos_cli` run. Error handling is centralized here: any
`GhosCliError` is rendered through rich and the process exits with the
error's configured exit code.
"""

from __future__ import annotations

import sys
from typing import Annotated

import typer

from ghos_cli import __program_id__, __repository__, __version__, __website__
from ghos_cli.commands import (
    apply_command,
    audit_app,
    burner_app,
    config_app,
    init_command,
    mix_app,
    send_command,
    shield_command,
    status_command,
    withdraw_command,
)
from ghos_cli.display import make_console, print_error
from ghos_cli.errors import GhosCliError

app = typer.Typer(
    name="ghos",
    help=(
        "ghos: terminal client for the ghos Solana privacy OS. "
        "Token-2022 confidential balances, burner accounts, "
        "CoinJoin rounds, and auditor registry, all from a shell."
    ),
    no_args_is_help=True,
    rich_markup_mode=None,
    add_completion=False,
)

# Flat commands (not sub-apps) still register directly on the top-level app.
app.command(
    "init",
    help="Initialize the ghos-cli configuration file with cluster and keypair defaults.",
)(init_command)
app.command(
    "shield",
    help="Move SPL balance into the confidential available counter for a Token-2022 mint.",
)(shield_command)
app.command(
    "send",
    help="Send tokens, optionally through the confidential transfer path.",
)(send_command)
app.command(
    "apply",
    help="Apply pending confidential balance into the available counter.",
)(apply_command)
app.command(
    "withdraw",
    help="Withdraw from confidential available balance back into SPL balance.",
)(withdraw_command)
app.command(
    "status",
    help="Print cluster, wallet, and optionally mint-scoped confidential balance.",
)(status_command)

# Grouped sub-apps.
app.add_typer(burner_app, name="burner")
app.add_typer(mix_app, name="mix")
app.add_typer(audit_app, name="audit")
app.add_typer(config_app, name="config")


def _version_callback(value: bool) -> None:
    if not value:
        return
    console = make_console()
    console.print(
        f"[brand]ghos-cli[/brand] version [brand]{__version__}[/brand]\n"
        f"program id: {__program_id__}\n"
        f"website: {__website__}\n"
        f"source: {__repository__}"
    )
    raise typer.Exit(code=0)


@app.callback(invoke_without_command=False)
def _main_callback(
    ctx: typer.Context,
    version: Annotated[
        bool,
        typer.Option(
            "--version",
            "-V",
            callback=_version_callback,
            is_eager=True,
            help="Print version and exit.",
        ),
    ] = False,
    debug: Annotated[
        bool,
        typer.Option(
            "--debug",
            help="Emit full tracebacks on error instead of a one-line message.",
        ),
    ] = False,
) -> None:
    """Top-level flags: `--version`, `--debug`."""
    ctx.ensure_object(dict)
    ctx.obj["debug"] = debug


def run() -> None:
    """Invoke the Typer app with centralized error conversion.

    This is what the console script and `__main__.py` call. Keeping the
    error handling here (rather than inside each command) means every
    command benefits from the same exit code mapping.
    """
    try:
        app()
    except GhosCliError as exc:
        console = make_console()
        print_error(console, exc.message)
        sys.exit(exc.exit_code)
    except typer.Exit as exc:
        raise
    except typer.BadParameter as exc:
        console = make_console()
        print_error(console, str(exc))
        sys.exit(2)
    except KeyboardInterrupt:
        console = make_console()
        print_error(console, "interrupted")
        sys.exit(130)


if __name__ == "__main__":  # pragma: no cover
    run()
