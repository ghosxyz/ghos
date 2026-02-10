"""Integration tests over the Typer app.

These tests exercise only the pure-Python paths: command registration,
argument parsing, config reading, and help output. Nothing touches the
network, so they run fully offline in CI.
"""

from __future__ import annotations

from pathlib import Path

from typer.testing import CliRunner

from ghos_cli import __program_id__, __version__
from ghos_cli.cli import app
from ghos_cli.config import default_config_path, load_config


def _runner() -> CliRunner:
    return CliRunner()


def _combined(result) -> str:
    """Return stdout and stderr as a single string for assertion."""
    out = result.stdout or ""
    err = getattr(result, "stderr", "") or ""
    return out + err


def test_app_help_lists_every_top_level_command() -> None:
    result = _runner().invoke(app, ["--help"])
    assert result.exit_code == 0
    output = _combined(result)
    for name in (
        "init",
        "shield",
        "send",
        "apply",
        "withdraw",
        "status",
        "burner",
        "mix",
        "audit",
        "config",
    ):
        assert name in output, f"expected `{name}` in top-level help"


def test_version_flag_prints_metadata() -> None:
    result = _runner().invoke(app, ["--version"])
    assert result.exit_code == 0
    output = _combined(result)
    assert __version__ in output
    assert __program_id__ in output


def test_init_writes_config_file(tmp_config_dir: Path) -> None:
    result = _runner().invoke(app, ["init", "--cluster", "devnet"])
    assert result.exit_code == 0, _combined(result)
    target = tmp_config_dir / "config.toml"
    assert target.is_file()
    text = target.read_text(encoding="utf-8")
    assert "devnet" in text
    assert "https://api.devnet.solana.com" in text


def test_init_devnet_then_switch_to_mainnet(tmp_config_dir: Path) -> None:
    _runner().invoke(app, ["init", "--cluster", "devnet"])
    result = _runner().invoke(app, ["init", "--cluster", "mainnet-beta", "--force"])
    assert result.exit_code == 0
    cfg = load_config(default_config_path())
    assert cfg.cluster.name == "mainnet-beta"
    assert "mainnet-beta.solana.com" in cfg.cluster.rpc_url


def test_init_unknown_cluster_is_a_bad_parameter(tmp_config_dir: Path) -> None:
    result = _runner().invoke(app, ["init", "--cluster", "venus"])
    assert result.exit_code != 0


def test_config_show_runs_with_no_file(tmp_config_dir: Path) -> None:
    result = _runner().invoke(app, ["config", "show"])
    assert result.exit_code == 0
    output = _combined(result)
    assert "cluster" in output
    assert "devnet" in output


def test_config_show_path_only_prints_path(tmp_config_dir: Path) -> None:
    result = _runner().invoke(app, ["config", "show", "--path-only"])
    assert result.exit_code == 0
    squished = _combined(result).replace("\n", "").replace(" ", "")
    assert str(tmp_config_dir).replace(" ", "") in squished


def test_config_set_persists_value(tmp_config_dir: Path) -> None:
    _runner().invoke(app, ["init", "--cluster", "devnet"])
    result = _runner().invoke(app, ["config", "set", "ui.compact", "true"])
    assert result.exit_code == 0
    cfg = load_config(default_config_path())
    assert cfg.ui.compact is True


def test_config_set_rejects_unknown_key(tmp_config_dir: Path) -> None:
    _runner().invoke(app, ["init", "--cluster", "devnet"])
    result = _runner().invoke(app, ["config", "set", "cluster.mystery", "x"])
    assert result.exit_code != 0


def test_config_set_dotted_key_requires_dot(tmp_config_dir: Path) -> None:
    _runner().invoke(app, ["init", "--cluster", "devnet"])
    result = _runner().invoke(app, ["config", "set", "nodot", "x"])
    assert result.exit_code != 0


def test_burner_help_is_non_empty() -> None:
    result = _runner().invoke(app, ["burner", "--help"])
    assert result.exit_code == 0
    output = _combined(result)
    assert "create" in output
    assert "destroy" in output
    assert "list" in output


def test_mix_help_lists_subcommands() -> None:
    result = _runner().invoke(app, ["mix", "--help"])
    assert result.exit_code == 0
    output = _combined(result)
    for name in ("join", "status", "settle"):
        assert name in output


def test_audit_help_lists_subcommands() -> None:
    result = _runner().invoke(app, ["audit", "--help"])
    assert result.exit_code == 0
    output = _combined(result)
    for name in ("register", "rotate", "list"):
        assert name in output


def test_missing_required_arg_exits_nonzero() -> None:
    result = _runner().invoke(app, ["shield"])
    assert result.exit_code != 0
