"""Command handlers registered on the Typer app.

Each submodule defines a Typer sub-app (for multi-command groups like
`burner`, `mix`, `audit`, `config`) or a single handler function (for
flat commands like `shield`, `send`, `apply`, `withdraw`, `status`,
`init`). The top-level `cli.py` imports these and wires them into the
Typer tree.
"""

from __future__ import annotations

from ghos_cli.commands.apply import apply_command
from ghos_cli.commands.audit import audit_app
from ghos_cli.commands.burn import burner_app
from ghos_cli.commands.config_cmd import config_app
from ghos_cli.commands.init import init_command
from ghos_cli.commands.mix import mix_app
from ghos_cli.commands.send import send_command
from ghos_cli.commands.shield import shield_command
from ghos_cli.commands.status import status_command
from ghos_cli.commands.withdraw import withdraw_command

__all__ = [
    "apply_command",
    "audit_app",
    "burner_app",
    "config_app",
    "init_command",
    "mix_app",
    "send_command",
    "shield_command",
    "status_command",
    "withdraw_command",
]
