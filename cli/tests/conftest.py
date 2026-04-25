"""Pytest fixtures shared across the ghos-cli test suite.

Every test runs against an isolated `GHOS_CONFIG_DIR` so the real
`~/.config/ghos/config.toml` is never read or written during tests.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from pathlib import Path

import pytest


@pytest.fixture
def tmp_config_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Path]:
    """Redirect `GHOS_CONFIG_DIR` at a fresh temp directory for one test.

    The tmp_path is created empty, and the environment variable is
    cleaned up automatically by `monkeypatch` when the test finishes.
    """
    target = tmp_path / "ghos"
    target.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("GHOS_CONFIG_DIR", str(target))
    yield target


@pytest.fixture(autouse=True)
def _clear_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Strip any stray `GHOS_*` env vars before each test.

    Without this, a user running tests with `GHOS_CLUSTER_NAME=mainnet-beta`
    set in their shell would see `load_config` return unexpected values.
    """
    for key in list(os.environ):
        if key.startswith("GHOS_") and key != "GHOS_CONFIG_DIR":
            monkeypatch.delenv(key, raising=False)
