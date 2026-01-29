"""Rich-based output rendering.

Every command renders its result with a helper from this module so that
colors, spacing, and the CLI's brand identity stay consistent. The
primary accent is `#ff1249`, loaded from `constants.BRAND_PRIMARY`; all
other styling is derived from that.
"""

from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any

from rich.console import Console
from rich.panel import Panel
from rich.progress import Progress, SpinnerColumn, TextColumn
from rich.table import Table
from rich.text import Text
from rich.theme import Theme
from rich.tree import Tree

from ghos_cli.constants import BRAND_MUTED, BRAND_PRIMARY

if TYPE_CHECKING:
    from collections.abc import Iterator

_THEME = Theme(
    {
        "brand": BRAND_PRIMARY,
        "muted": BRAND_MUTED,
        "ok": "#29d391",
        "warn": "#ffb400",
        "err": "#ff3131",
        "hint": "#9aa0a6",
        "label": "bold",
    }
)


def make_console(no_color: bool = False) -> Console:
    """Return a configured `Console` instance.

    If `no_color` is True, color is disabled but rich markup is still
    stripped, so tests can assert on plain text outputs.
    """
    return Console(
        theme=_THEME,
        no_color=no_color,
        soft_wrap=False,
        highlight=False,
        emoji=False,
    )


def _default_console() -> Console:
    """Module-level console used when none is injected."""
    return make_console()


def print_title(console: Console | None, text: str) -> None:
    """Print a title line in brand color without a border, useful above tables."""
    (console or _default_console()).print(Text(text, style="brand"))


def print_panel(
    console: Console | None,
    body: str,
    *,
    title: str | None = None,
    style: str = "brand",
) -> None:
    """Print a framed panel around arbitrary text."""
    target = console or _default_console()
    panel = Panel.fit(
        body,
        title=title,
        title_align="left",
        border_style=style,
    )
    target.print(panel)


def print_success(console: Console | None, message: str) -> None:
    """Print a green confirmation line prefixed with `ok:`."""
    (console or _default_console()).print(Text(f"ok: {message}", style="ok"))


def print_warning(console: Console | None, message: str) -> None:
    """Print a yellow advisory line prefixed with `warn:`."""
    (console or _default_console()).print(Text(f"warn: {message}", style="warn"))


def print_error(console: Console | None, message: str) -> None:
    """Print a red failure line prefixed with `error:`."""
    (console or _default_console()).print(Text(f"error: {message}", style="err"))


def print_kv_table(
    console: Console | None,
    rows: dict[str, Any],
    *,
    title: str | None = None,
    key_header: str = "field",
    value_header: str = "value",
) -> None:
    """Render a flat dictionary as a 2-column table.

    Keys are rendered in brand color, values in default text style.
    Useful for rendering a single account's fields after a write.
    """
    target = console or _default_console()
    table = Table(
        title=title,
        title_style="brand",
        header_style="brand",
        border_style="brand",
        show_header=True,
        expand=False,
    )
    table.add_column(key_header, style="label")
    table.add_column(value_header, style="")
    for k, v in rows.items():
        table.add_row(str(k), _stringify(v))
    target.print(table)


def print_rows_table(
    console: Console | None,
    columns: list[str],
    rows: list[list[Any]],
    *,
    title: str | None = None,
) -> None:
    """Render a list of heterogeneous rows as a table.

    Each entry in `rows` must have the same length as `columns`.
    """
    target = console or _default_console()
    table = Table(
        title=title,
        title_style="brand",
        header_style="brand",
        border_style="brand",
        show_header=True,
        expand=False,
    )
    for col in columns:
        table.add_column(col)
    for row in rows:
        if len(row) != len(columns):
            raise ValueError(
                f"row length {len(row)} does not match column count {len(columns)}"
            )
        table.add_row(*[_stringify(c) for c in row])
    target.print(table)


def print_tree(
    console: Console | None,
    label: str,
    children: dict[str, Any],
) -> None:
    """Render a labeled tree from a nested dict.

    Leaves (strings, ints, floats, bools, None) are rendered inline with
    their key. Nested dicts become sub-branches recursively.
    """
    target = console or _default_console()
    root = Tree(Text(label, style="brand"))
    _extend_tree(root, children)
    target.print(root)


def _extend_tree(node: Tree, children: dict[str, Any]) -> None:
    for k, v in children.items():
        if isinstance(v, dict):
            sub = node.add(Text(str(k), style="label"))
            _extend_tree(sub, v)
        else:
            label = Text.assemble(
                (str(k), "label"),
                (": ", "muted"),
                (_stringify(v), ""),
            )
            node.add(label)


@contextmanager
def progress_spinner(
    console: Console | None,
    message: str,
) -> Iterator[None]:
    """Display a rich spinner for the duration of a slow step."""
    target = console or _default_console()
    progress = Progress(
        SpinnerColumn(style="brand"),
        TextColumn("[brand]{task.description}[/brand]"),
        console=target,
        transient=True,
    )
    with progress:
        progress.add_task(description=message, total=None)
        yield


def format_timestamp(seconds: int, fmt: str = "%Y-%m-%d %H:%M:%S") -> str:
    """Convert a unix timestamp into a UTC-formatted string."""
    if seconds <= 0:
        return "never"
    dt = datetime.fromtimestamp(seconds, tz=timezone.utc)
    return dt.strftime(fmt)


def _stringify(value: Any) -> str:
    if value is None:
        return "-"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, bytes):
        return value.hex()
    if isinstance(value, float):
        return f"{value:.6f}"
    return str(value)


def render_banner(console: Console | None) -> None:
    """Print the CLI banner used by `ghos` with no subcommand."""
    lines = [
        "ghos",
        "Solana privacy OS, Token-2022 confidential balances",
    ]
    target = console or _default_console()
    target.print(Panel.fit(
        "\n".join(lines),
        title="ghos-cli",
        title_align="left",
        border_style="brand",
    ))
