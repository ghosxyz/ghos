"""Test package for ghos-cli.

Individual test modules import from `ghos_cli` directly. The `conftest`
fixtures that isolate the on-disk config directory are defined here so
that every test automatically points `GHOS_CONFIG_DIR` at a temporary
location, preventing accidental reads of the real user config.
"""

from __future__ import annotations
