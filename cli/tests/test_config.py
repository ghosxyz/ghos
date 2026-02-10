"""Tests for the config loader and mutator."""

from __future__ import annotations

from pathlib import Path

import pytest

from ghos_cli.config import (
    Config,
    load_config,
    save_config,
    set_value,
)
from ghos_cli.errors import ConfigError


def test_default_config_has_devnet_cluster() -> None:
    cfg = Config()
    assert cfg.cluster.name == "devnet"
    assert cfg.cluster.rpc_url.endswith("devnet.solana.com")
    assert cfg.cluster.commitment == "confirmed"


def test_roundtrip_save_and_load_is_stable(tmp_path: Path) -> None:
    path = tmp_path / "c.toml"
    cfg = Config()
    save_config(cfg, path)
    loaded = load_config(path)
    assert loaded.cluster.name == cfg.cluster.name
    assert loaded.cluster.rpc_url == cfg.cluster.rpc_url
    assert loaded.keypair.path == cfg.keypair.path
    assert loaded.auditor.enabled == cfg.auditor.enabled


def test_set_value_mutates_cluster_name(tmp_path: Path) -> None:
    cfg = Config()
    updated = set_value(cfg, "cluster.name", "mainnet")
    assert updated.cluster.name == "mainnet-beta"
    assert "mainnet-beta.solana.com" in updated.cluster.rpc_url


def test_set_value_rejects_unknown_section() -> None:
    cfg = Config()
    with pytest.raises(ConfigError):
        set_value(cfg, "nope.key", "val")


def test_set_value_rejects_unknown_key() -> None:
    cfg = Config()
    with pytest.raises(ConfigError):
        set_value(cfg, "cluster.mystery", "val")


def test_set_value_rejects_invalid_commitment() -> None:
    cfg = Config()
    with pytest.raises(ConfigError):
        set_value(cfg, "cluster.commitment", "super-final")


def test_set_value_keypair_path() -> None:
    cfg = Config()
    updated = set_value(cfg, "keypair.path", "/tmp/id.json")
    assert updated.keypair.path == "/tmp/id.json"


def test_set_value_auditor_enabled_boolean() -> None:
    cfg = Config()
    updated = set_value(cfg, "auditor.enabled", "true")
    assert updated.auditor.enabled is True
    updated = set_value(cfg, "auditor.enabled", "0")
    assert updated.auditor.enabled is False


def test_set_value_ui_compact_accepts_yes() -> None:
    cfg = Config()
    updated = set_value(cfg, "ui.compact", "yes")
    assert updated.ui.compact is True


def test_env_override_wins_over_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    path = tmp_path / "c.toml"
    cfg = Config()
    save_config(cfg, path)
    monkeypatch.setenv("GHOS_CLUSTER_NAME", "mainnet-beta")
    merged = load_config(path)
    assert merged.cluster.name == "mainnet-beta"
    assert "mainnet-beta.solana.com" in merged.cluster.rpc_url


def test_load_missing_file_returns_defaults(tmp_path: Path) -> None:
    cfg = load_config(tmp_path / "missing.toml")
    assert cfg.cluster.name == "devnet"
    assert cfg.keypair.path.endswith("id.json")


def test_malformed_toml_raises_config_error(tmp_path: Path) -> None:
    target = tmp_path / "bad.toml"
    target.write_text("[cluster\nname = ???", encoding="utf-8")
    with pytest.raises(ConfigError):
        load_config(target)


def test_env_bool_parse_rejects_junk(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    path = tmp_path / "c.toml"
    save_config(Config(), path)
    monkeypatch.setenv("GHOS_AUDITOR_ENABLED", "perhaps")
    with pytest.raises(ConfigError):
        load_config(path)
