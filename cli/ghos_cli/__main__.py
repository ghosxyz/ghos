"""Module execution entrypoint.

Allows `python -m ghos_cli ...` to behave identically to the `ghos` script
installed by `pip install .`.
"""

from __future__ import annotations

from ghos_cli.cli import app


def main() -> None:
    """Invoke the Typer app with the current argv."""
    app()


if __name__ == "__main__":
    main()
