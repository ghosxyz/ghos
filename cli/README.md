# ghos-cli

<p>
  <img src="https://img.shields.io/badge/License-MIT-ff1249?style=for-the-badge&labelColor=0a0a0a" alt="License MIT" />
  <img src="https://img.shields.io/badge/Version-0.4.1-ff1249?style=for-the-badge&labelColor=0a0a0a" alt="Version" />
  <img src="https://img.shields.io/badge/Python-3.11%2B-ff1249?style=for-the-badge&labelColor=0a0a0a" alt="Python" />
  <img src="https://img.shields.io/badge/Solana-1.18-ff1249?style=for-the-badge&labelColor=0a0a0a" alt="Solana" />
  <img src="https://img.shields.io/badge/Token--2022-confidential-ff1249?style=for-the-badge&labelColor=0a0a0a" alt="Token-2022" />
  <img src="https://img.shields.io/badge/Website-ghos.xyz-ff1249?style=for-the-badge&labelColor=0a0a0a" alt="Website" />
</p>

Terminal client for the [ghos](https://ghos.xyz) Solana privacy OS. Exposes the same flows as the TypeScript SDK (shield, confidential transfer, apply, withdraw, burner lifecycle, CoinJoin mixing, auditor registry) from a shell, with rich-formatted output and deterministic local ElGamal derivation.

## Install

`ghos-cli` is distributed with the `ghos` repo. Clone the monorepo and install the CLI as an editable package.

```bash
git clone https://github.com/ghosxyz/ghos.git
cd ghos/cli
pip install -e .
```

Verify the install.

```bash
ghos --version
# ghos-cli version 0.4.1
# program id: EnKo8EbfJkani8UePTmAVPzdCZM8vMEYYkjTar4fwBPg
# website: https://ghos.xyz
# source: https://github.com/ghosxyz/ghos
```

Python 3.11 or newer is required. All dependencies are installed automatically by pip: `typer`, `rich`, `solana`, `solders`, `anchorpy`, `pynacl`, `tomli_w`, `blake3`.

## Configure

The CLI keeps its settings at `~/.config/ghos/config.toml`. The first call to `ghos init` creates the file with defaults for the chosen cluster.

```bash
ghos init --cluster devnet
ghos init --cluster mainnet-beta --keypair ~/.config/solana/id.json
```

Every field can be overridden at runtime with an environment variable of the form `GHOS_<SECTION>_<KEY>`.

```bash
GHOS_CLUSTER_RPC_URL=https://my.private.rpc ghos status --mint <mint-pubkey>
```

You can inspect or mutate individual keys with `ghos config`.

```bash
ghos config show
ghos config set cluster.commitment finalized
ghos config set ui.compact true
```

## Commands

| Command                                               | Description                                                |
| ----------------------------------------------------- | ---------------------------------------------------------- |
| `ghos init --cluster <name>`                          | Initialize the config file for a cluster.                  |
| `ghos shield --mint <pk> --amount <dec>`              | Move SPL into the confidential available counter.          |
| `ghos send <recipient> <amount> --mint <pk>`          | Send tokens, confidential path by default.                 |
| `ghos apply --mint <pk>`                              | Apply pending confidential balance into available balance. |
| `ghos withdraw --mint <pk> --amount <dec> [--to <pk>]` | Withdraw from confidential back to SPL.                    |
| `ghos burner create --ttl <duration>`                 | Register an ephemeral burner account.                      |
| `ghos burner list`                                    | List registered burner slots.                              |
| `ghos burner destroy <burner-pda>`                    | Revoke a burner before its TTL.                            |
| `ghos mix join --denomination <dec> --mint <pk>`      | Join a CoinJoin round with a commitment.                   |
| `ghos mix status [--round <pk>]`                      | Inspect a specific round or scan recent rounds.            |
| `ghos mix settle --round <pk>`                        | Settle a round after the reveal phase.                     |
| `ghos audit register --mint <pk> --auditor <pk>`      | Register an auditor ElGamal pubkey.                        |
| `ghos audit rotate --mint <pk> --auditor <new-pk>`    | Rotate the auditor key.                                    |
| `ghos audit list --mint <pk>`                         | List auditor entries for given mints.                      |
| `ghos status [--mint <pk>]`                           | Cluster, wallet, and optional balance snapshot.            |
| `ghos config show`                                    | Print the current configuration.                           |
| `ghos config set <key> <value>`                       | Set a single configuration key.                            |

## Examples

Shield one whole unit of a six-decimal token:

```bash
ghos shield --mint 4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R --amount 1.0
```

Send 0.25 of the same token confidentially:

```bash
ghos send 7dHbWXmci3dT1UFY8ZcC8cG7QwjT3Z5r7UNJZb3r7D8b 0.25 \
    --mint 4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R \
    --confidential
```

Create a 24h burner and list active slots:

```bash
ghos burner create --ttl 24h
ghos burner list
```

Join a 4-party CoinJoin round for 0.1 units:

```bash
ghos mix join --mint 4k3Dyj... --denomination 0.1
ghos mix status --round <round-pda>
```

Check your decrypted balance and cluster info:

```bash
ghos status --mint 4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R
```

## Design notes

* Amounts are always parsed as decimals and converted to the mint's base units. Dust-free alignment is enforced: amounts below 1000 base units, or that would require rounding, are rejected.
* The ElGamal keypair used by the CLI is derived deterministically from the Solana signer seed, so the same wallet produces the same encryption identity across invocations and across CLI / SDK.
* Decryption is exhaustive discrete log with a configurable bound (`--decrypt-bound`). The default bound of 2^20 covers the typical user balance in under a second.
* The CoinJoin commit is a 32-byte Blake3 hash of `(elgamal_pk, note_ciphertext, salt)` under a domain tag, matching the on-chain `MIX_COMMITMENT_LEN`.
* All colored output uses the brand accent `#ff1249`. The UI can be muted with `ghos config set ui.compact true`.

## Development

Run the full test suite with:

```bash
pip install -e .[dev]
pytest
```

Lint with ruff, type-check with mypy:

```bash
ruff check .
mypy ghos_cli
```

## License

MIT. See the repository root `LICENSE` file.
