# ghos examples

Runnable TypeScript programs that drive the ghos SDK against a real Solana
cluster. Every example reads `GHOS_CLUSTER` for the RPC URL and falls back
to `https://api.devnet.solana.com`.

| File                          | What it demonstrates                                                |
| ----------------------------- | ------------------------------------------------------------------- |
| `shield_and_transfer.ts`      | Minimal end-to-end: shield SPL, apply pending, confidential send    |
| `burner_wallet_flow.ts`       | Create a burner, fund it, use it once, destroy it                   |
| `mix_coinjoin.ts`             | Join a 4-participant CoinJoin round and redeem the output note      |
| `auditor_setup.ts`            | Register a per-mint auditor and decrypt an amount auditor-side      |
| `batch_airdrop.ts`            | Shield confidentially to N recipients in a single transaction batch |
| `watcher_bot.ts`              | Long-running event subscription loop that tails ghos program logs   |

## Running

```bash
# set cluster (default: devnet)
export GHOS_CLUSTER=https://api.devnet.solana.com

# set the sender wallet; a JSON file exported by solana-keygen
export GHOS_WALLET=~/.config/solana/id.json

# run one example
npx ts-node examples/shield_and_transfer.ts

# list files
ls examples/
```

## Common flags

Most examples accept the following environment variables:

- `GHOS_CLUSTER`: RPC URL. Default `https://api.devnet.solana.com`.
- `GHOS_WALLET`: path to a Solana keypair JSON. Default `~/.config/solana/id.json`.
- `GHOS_MINT`: Token-2022 mint to use, must have the confidential transfer
  extension enabled.
- `GHOS_AMOUNT`: amount in atomic units (6-decimals USDC-like, so 1_000_000 = 1.00).

All amounts are expressed in atomic units to avoid float drift. The SDK
converts between atomic and UI amounts for display, never in the wire
format.

## Expected network prerequisites

- A Token-2022 mint with the confidential transfer extension initialized.
  The `createConfidentialMint` helper in `tests/fixtures/mints.ts` is the
  canonical reference.
- The `spl-zk-token-proof` program loaded. This is present on devnet and
  mainnet; local validator runs require `solana-test-validator --clone
  ZkTokenProof1111111111111111111111111111111`.
- Sufficient SOL for rent + compute. Each of these flows requests around
  600_000 CU and creates one to three rent-exempt accounts; budget
  approximately 0.02 SOL per run.

## Troubleshooting

| Symptom                                   | Likely cause                                       |
| ----------------------------------------- | -------------------------------------------------- |
| `ConfidentialTransferDisabled`            | Mint was created without the extension             |
| `AmountNotAligned`                        | Amount not a multiple of the dust-free unit 1000   |
| `AuditorEntryMissing`                     | Mint requires an auditor but no entry is registered |
| `MixRevealTimeout`                        | Reveal window lapsed; round aborted, refund needed  |
| `RangeProofVerificationFailed`            | Bad proof bytes or wrong pubkey in the proof-ctx    |
| `BurnerExpired`                           | TTL elapsed since the burner entry was created      |
