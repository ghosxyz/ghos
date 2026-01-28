"""Configuration loader.

The CLI stores its settings in a single TOML file at
`~/.config/ghos/config.toml`. Every value can also be overridden via an
environment variable using the convention `GHOS_<SECTION>_<KEY>` (upper
snake case). Environment variables take precedence over the file so that
ephemeral shells can target a different cluster without mutating the
persistent config.
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any

if sys.version_info >= (3, 11):
    import tomllib as _toml
else:  # pragma: no cover - python 3.10 fallback
    import tomli as _toml

import tomli_w

from ghos_cli.constants import (
    BRAND_PRIMARY,
    DEFAULT_RPC,
    DEFAULT_WS,
    canonical_cluster,
)
from ghos_cli.errors import ConfigError


CONFIG_DIR_ENV: str = "GHOS_CONFIG_DIR"
CONFIG_FILE_NAME: str = "config.toml"


@dataclass(slots=True)
class ClusterConfig:
    """RPC connection settings."""

    name: str = "devnet"
    rpc_url: str = DEFAULT_RPC["devnet"]
    ws_url: str = DEFAULT_WS["devnet"]
    commitment: str = "confirmed"


@dataclass(slots=True)
class KeypairConfig:
    """On-disk locations for the primary signer."""

    path: str = "~/.config/solana/id.json"
    elgamal_seed_path: str = ""


@dataclass(slots=True)
class AuditorConfig:
    """Auditor-side settings.

    When `enabled` is true, commands that touch mints with a registered
    auditor will include the auditor ciphertext component. The local
    `public_key` and `secret_key_path` are only used if this CLI is being
    operated by an auditor, not a regular user.
    """

    enabled: bool = False
    public_key: str = ""
    secret_key_path: str = ""


@dataclass(slots=True)
class UiConfig:
    """Display settings for rich output."""

    color: str = BRAND_PRIMARY
    compact: bool = False
    timestamp_format: str = "%Y-%m-%d %H:%M:%S"


@dataclass(slots=True)
class Config:
    """Top-level configuration object.

    Instances are immutable in spirit (created once per CLI invocation) but
    the fields are dataclasses rather than frozen so we can update them
    from env overrides without constructing the whole tree twice.
    """

    cluster: ClusterConfig = field(default_factory=ClusterConfig)
    keypair: KeypairConfig = field(default_factory=KeypairConfig)
    auditor: AuditorConfig = field(default_factory=AuditorConfig)
    ui: UiConfig = field(default_factory=UiConfig)
    _source_path: Path | None = None

    def merge_env(self) -> Config:
        """Return a copy of this config with env var overrides applied."""
        cluster = replace(self.cluster)
        keypair = replace(self.keypair)
        auditor = replace(self.auditor)
        ui = replace(self.ui)

        if (val := os.environ.get("GHOS_CLUSTER_NAME")) is not None:
            cluster.name = canonical_cluster(val)
            if cluster.rpc_url == DEFAULT_RPC.get(self.cluster.name, ""):
                cluster.rpc_url = DEFAULT_RPC.get(cluster.name, cluster.rpc_url)
            if cluster.ws_url == DEFAULT_WS.get(self.cluster.name, ""):
                cluster.ws_url = DEFAULT_WS.get(cluster.name, cluster.ws_url)
        if (val := os.environ.get("GHOS_CLUSTER_RPC_URL")) is not None:
            cluster.rpc_url = val
        if (val := os.environ.get("GHOS_CLUSTER_WS_URL")) is not None:
            cluster.ws_url = val
        if (val := os.environ.get("GHOS_CLUSTER_COMMITMENT")) is not None:
            cluster.commitment = val

        if (val := os.environ.get("GHOS_KEYPAIR_PATH")) is not None:
            keypair.path = val
        if (val := os.environ.get("GHOS_KEYPAIR_ELGAMAL_SEED_PATH")) is not None:
            keypair.elgamal_seed_path = val

        if (val := os.environ.get("GHOS_AUDITOR_ENABLED")) is not None:
            auditor.enabled = _parse_bool(val)
        if (val := os.environ.get("GHOS_AUDITOR_PUBLIC_KEY")) is not None:
            auditor.public_key = val
        if (val := os.environ.get("GHOS_AUDITOR_SECRET_KEY_PATH")) is not None:
            auditor.secret_key_path = val

        if (val := os.environ.get("GHOS_UI_COLOR")) is not None:
            ui.color = val
        if (val := os.environ.get("GHOS_UI_COMPACT")) is not None:
            ui.compact = _parse_bool(val)
        if (val := os.environ.get("GHOS_UI_TIMESTAMP_FORMAT")) is not None:
            ui.timestamp_format = val

        return Config(
            cluster=cluster,
            keypair=keypair,
            auditor=auditor,
            ui=ui,
            _source_path=self._source_path,
        )

    def to_toml_dict(self) -> dict[str, Any]:
        """Produce a nested dict suitable for `tomli_w.dump`."""
        return {
            "cluster": {
                "name": self.cluster.name,
                "rpc_url": self.cluster.rpc_url,
                "ws_url": self.cluster.ws_url,
                "commitment": self.cluster.commitment,
            },
            "keypair": {
                "path": self.keypair.path,
                "elgamal_seed_path": self.keypair.elgamal_seed_path,
            },
            "auditor": {
                "enabled": self.auditor.enabled,
                "public_key": self.auditor.public_key,
                "secret_key_path": self.auditor.secret_key_path,
            },
            "ui": {
                "color": self.ui.color,
                "compact": self.ui.compact,
                "timestamp_format": self.ui.timestamp_format,
            },
        }


def _parse_bool(value: str) -> bool:
    """Accept the usual yes/no/true/false/1/0 forms from env vars."""
    lowered = value.strip().lower()
    if lowered in {"1", "true", "yes", "on", "y", "t"}:
        return True
    if lowered in {"0", "false", "no", "off", "n", "f"}:
        return False
    raise ConfigError(f"cannot parse boolean from {value!r}")


def default_config_dir() -> Path:
    """Return the directory where the config file lives.

    Honors `GHOS_CONFIG_DIR` if set. Otherwise uses `~/.config/ghos`.
    """
    override = os.environ.get(CONFIG_DIR_ENV)
    if override:
        return Path(override).expanduser()
    return Path.home() / ".config" / "ghos"


def default_config_path() -> Path:
    """Return the absolute path to the `config.toml` file."""
    return default_config_dir() / CONFIG_FILE_NAME


def load_config(path: Path | None = None) -> Config:
    """Load a `Config` from disk, falling back to defaults.

    A missing file is not an error; the resulting object just uses
    defaults. A malformed file is an error and raises `ConfigError`.
    Env var overrides are applied on top before returning.
    """
    source = path or default_config_path()
    cfg = Config(_source_path=source)
    if source.is_file():
        try:
            raw = source.read_bytes()
            parsed = _toml.loads(raw.decode("utf-8"))
        except (OSError, ValueError) as exc:
            raise ConfigError(f"cannot read config at {source}: {exc}") from exc
        cfg = _config_from_dict(parsed, source)
    return cfg.merge_env()


def save_config(cfg: Config, path: Path | None = None) -> Path:
    """Persist a `Config` to disk, creating parent directories as needed.

    Returns the path that was written to.
    """
    target = path or cfg._source_path or default_config_path()
    target = Path(target).expanduser()
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("wb") as fh:
            tomli_w.dump(cfg.to_toml_dict(), fh)
    except OSError as exc:
        raise ConfigError(f"cannot write config to {target}: {exc}") from exc
    return target


def set_value(cfg: Config, dotted_key: str, value: str) -> Config:
    """Return a new `Config` with a single `section.key` value updated.

    The dotted-key form matches what `ghos config set cluster.name devnet`
    will pass through. Unknown keys are rejected with a clear error.
    """
    if "." not in dotted_key:
        raise ConfigError(f"key must be of the form section.key, got {dotted_key!r}")
    section, key = dotted_key.split(".", 1)
    section = section.strip().lower()
    key = key.strip().lower()
    if not section or not key:
        raise ConfigError(f"empty section or key in {dotted_key!r}")

    new_cfg = Config(
        cluster=replace(cfg.cluster),
        keypair=replace(cfg.keypair),
        auditor=replace(cfg.auditor),
        ui=replace(cfg.ui),
        _source_path=cfg._source_path,
    )

    if section == "cluster":
        _set_cluster_value(new_cfg.cluster, key, value)
    elif section == "keypair":
        _set_keypair_value(new_cfg.keypair, key, value)
    elif section == "auditor":
        _set_auditor_value(new_cfg.auditor, key, value)
    elif section == "ui":
        _set_ui_value(new_cfg.ui, key, value)
    else:
        raise ConfigError(f"unknown section: {section!r}")
    return new_cfg


def _set_cluster_value(cluster: ClusterConfig, key: str, value: str) -> None:
    if key == "name":
        canonical = canonical_cluster(value)
        cluster.name = canonical
        cluster.rpc_url = DEFAULT_RPC.get(canonical, cluster.rpc_url)
        cluster.ws_url = DEFAULT_WS.get(canonical, cluster.ws_url)
    elif key == "rpc_url":
        cluster.rpc_url = value
    elif key == "ws_url":
        cluster.ws_url = value
    elif key == "commitment":
        if value not in {"processed", "confirmed", "finalized"}:
            raise ConfigError(
                f"commitment must be processed|confirmed|finalized, got {value!r}"
            )
        cluster.commitment = value
    else:
        raise ConfigError(f"unknown key cluster.{key}")


def _set_keypair_value(keypair: KeypairConfig, key: str, value: str) -> None:
    if key == "path":
        keypair.path = value
    elif key == "elgamal_seed_path":
        keypair.elgamal_seed_path = value
    else:
        raise ConfigError(f"unknown key keypair.{key}")


def _set_auditor_value(auditor: AuditorConfig, key: str, value: str) -> None:
    if key == "enabled":
        auditor.enabled = _parse_bool(value)
    elif key == "public_key":
        auditor.public_key = value
    elif key == "secret_key_path":
        auditor.secret_key_path = value
    else:
        raise ConfigError(f"unknown key auditor.{key}")


def _set_ui_value(ui: UiConfig, key: str, value: str) -> None:
    if key == "color":
        ui.color = value
    elif key == "compact":
        ui.compact = _parse_bool(value)
    elif key == "timestamp_format":
        ui.timestamp_format = value
    else:
        raise ConfigError(f"unknown key ui.{key}")


def _config_from_dict(data: dict[str, Any], source: Path) -> Config:
    """Build a `Config` from a parsed TOML dict, validating known fields."""
    cluster_data = data.get("cluster", {}) or {}
    keypair_data = data.get("keypair", {}) or {}
    auditor_data = data.get("auditor", {}) or {}
    ui_data = data.get("ui", {}) or {}
    if not isinstance(cluster_data, dict):
        raise ConfigError(f"[cluster] must be a table, got {type(cluster_data).__name__}")
    if not isinstance(keypair_data, dict):
        raise ConfigError(f"[keypair] must be a table, got {type(keypair_data).__name__}")
    if not isinstance(auditor_data, dict):
        raise ConfigError(f"[auditor] must be a table, got {type(auditor_data).__name__}")
    if not isinstance(ui_data, dict):
        raise ConfigError(f"[ui] must be a table, got {type(ui_data).__name__}")

    cluster_name_raw = str(cluster_data.get("name", "devnet"))
    cluster_name = canonical_cluster(cluster_name_raw)
    cluster = ClusterConfig(
        name=cluster_name,
        rpc_url=str(cluster_data.get("rpc_url", DEFAULT_RPC.get(cluster_name, ""))),
        ws_url=str(cluster_data.get("ws_url", DEFAULT_WS.get(cluster_name, ""))),
        commitment=str(cluster_data.get("commitment", "confirmed")),
    )
    keypair = KeypairConfig(
        path=str(keypair_data.get("path", "~/.config/solana/id.json")),
        elgamal_seed_path=str(keypair_data.get("elgamal_seed_path", "")),
    )
    auditor = AuditorConfig(
        enabled=bool(auditor_data.get("enabled", False)),
        public_key=str(auditor_data.get("public_key", "")),
        secret_key_path=str(auditor_data.get("secret_key_path", "")),
    )
    ui = UiConfig(
        color=str(ui_data.get("color", BRAND_PRIMARY)),
        compact=bool(ui_data.get("compact", False)),
        timestamp_format=str(ui_data.get("timestamp_format", "%Y-%m-%d %H:%M:%S")),
    )
    return Config(
        cluster=cluster,
        keypair=keypair,
        auditor=auditor,
        ui=ui,
        _source_path=source,
    )
