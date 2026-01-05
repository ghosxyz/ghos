<p align="center">
  <img src="../assets/banner.png" alt="ghos.xyz sdk" width="100%" />
</p>

<p align="center">
  <a href="https://github.com/ghosxyz/ghos/blob/main/LICENSE">
    <img src="https://img.shields.io/badge/License-MIT-ff1249?style=for-the-badge&labelColor=0a0a0a" alt="License MIT" />
  </a>
  <a href="https://www.npmjs.com/package/@ghos/sdk">
    <img src="https://img.shields.io/badge/npm-%40ghos%2Fsdk-ff1249?style=for-the-badge&labelColor=0a0a0a" alt="npm package" />
  </a>
  <a href="https://github.com/ghosxyz/ghos/releases">
    <img src="https://img.shields.io/badge/Version-0.4.1-ff1249?style=for-the-badge&labelColor=0a0a0a" alt="Version 0.4.1" />
  </a>
  <a href="https://github.com/ghosxyz/ghos">
    <img src="https://img.shields.io/badge/TypeScript-5.5-ff1249?style=for-the-badge&labelColor=0a0a0a&logo=typescript&logoColor=white" alt="TypeScript 5.5" />
  </a>
  <a href="https://github.com/ghosxyz/ghos/tree/main/programs/ghos">
    <img src="https://img.shields.io/badge/Anchor-0.30.1-ff1249?style=for-the-badge&labelColor=0a0a0a" alt="Anchor 0.30.1" />
  </a>
  <a href="https://github.com/ghosxyz/ghos/tree/main/programs/ghos">
    <img src="https://img.shields.io/badge/Solana-1.18-ff1249?style=for-the-badge&labelColor=0a0a0a" alt="Solana 1.18" />
  </a>
  <a href="https://ghos.xyz">
    <img src="https://img.shields.io/badge/Website-ghos.xyz-ff1249?style=for-the-badge&labelColor=0a0a0a" alt="ghos.xyz" />
  </a>
</p>

@ghos/sdk is the TypeScript client for the ghos privacy OS on Solana. It wraps the 14 Anchor instructions of the ghos program, provides a full client-side twisted ElGamal + bulletproof + sigma proof stack over Ristretto255, and ships typed helpers for PDA derivation, retry-aware RPC submission, deterministic keypair derivation, and event subscription.

## Install

```bash
yarn add @ghos/sdk @solana/web3.js
# or
npm install @ghos/sdk @solana/web3.js
```

Node 20 or later is required. Tree-shaking is enabled via `"sideEffects": false`.

## Quick start

```ts
import {
  GhosClient,
  loadKeypair,
  deriveGhosKeypair
} from "@ghos/sdk";
import { Connection, PublicKey } from "@solana/web3.js";

const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const payer = loadKeypair("~/.config/solana/id.json");
const client = new GhosClient({ connection, payer });

const mint = new PublicKey("<Token-2022 mint with confidential ext>");

// Shield 1.00 USDC into the confidential balance.
await client.shield({ mint, amount: 1_000_000n });

// Apply pending -> available.
await client.applyPendingBalance({ mint });

// Derive a deterministic ElGamal keypair per mint.
const ghosKey = deriveGhosKeypair(payer, { mint });

// Send confidentially.
await client.confidentialTransfer({
  mint,
  toOwner: new PublicKey("<recipient>"),
  amount: 250_000n,
  sourceAccount: await client.deriveAta(mint, payer.publicKey),
  destinationAccount: await client.deriveAta(mint, new PublicKey("<recipient>")),
  rangeProofContext: new PublicKey("<preuploaded range ctx>"),
  equalityProofContext: new PublicKey("<preuploaded equality ctx>"),
  sourceCiphertext: { c1: new Uint8Array(32), c2: new Uint8Array(32) },
  destCiphertext: { c1: new Uint8Array(32), c2: new Uint8Array(32) }
});
```

## API reference

| Area | Symbol | Description |
| ---- | ------ | ----------- |
| Client | `GhosClient` | Main class, one method per on-chain instruction |
| Client | `client.initialize` | Create the `GhosConfig` singleton |
| Client | `client.shield` | SPL to confidential balance |
| Client | `client.confidentialTransfer` | Move confidential balance between owners |
| Client | `client.applyPending` | Drain pending to available |
| Client | `client.withdraw` | Confidential to SPL |
| Client | `client.createBurner` | Register an ephemeral keypair |
| Client | `client.destroyBurner` | Revoke a burner before TTL |
| Client | `client.mixInit` | Open a CoinJoin round |
| Client | `client.mixCommit` | Post a commitment |
| Client | `client.mixReveal` | Reveal against a prior commit |
| Client | `client.mixSettle` | Redistribute outputs |
| Client | `client.auditorRegister` | Register a per-mint auditor |
| Client | `client.auditorRotate` | Rotate an auditor |
| Client | `client.configUpdate` | Update one config field |
| Crypto | `encrypt`, `decrypt`, `randomize` | Twisted ElGamal primitives |
| Crypto | `proveRange`, `verifyRangeProof` | 64-bit bulletproof |
| Crypto | `proveEquality`, `verifyEquality` | Sigma proof of ciphertext equality |
| Crypto | `provePubkeyValidity`, `verifyPubkeyValidity` | Schnorr-style key validity |
| Crypto | `proveZeroBalance`, `verifyZeroBalance` | Zero-ciphertext attestation |
| Crypto | `GhosKeypair`, `deriveGhosKeypair` | Deterministic keypair from signer |
| PDAs | `deriveConfigPda`, `deriveBurnerPda`, `deriveMixRoundPda`, `deriveMixCommitmentPda`, `deriveAuditorPda` | Seed-based PDA derivation |
| Watcher | `subscribeToEvent`, `subscribeToAllEvents` | Event stream helpers |
| Errors | `GhosSdkError`, `GHOS_ERROR_CODES`, `SDK_ERROR_CODES` | Typed error surface |

## Deterministic keypair derivation

Every owner holds one ElGamal keypair per Token-2022 mint, derived from their Solana signer:

```ts
import { deriveGhosKeypair, GhosKeypair } from "@ghos/sdk";
const kp = GhosKeypair.fromSigner(payer, { mint });
console.log(kp.publicKeyHex());
```

Derivation signs a fixed challenge message, hashes the signature with the mint, and uses the 32-byte output as the seed. Two different mints produce two independent keypairs even for the same wallet.

## Event subscription

```ts
import { subscribeToEvent } from "@ghos/sdk";
const sub = await subscribeToEvent(connection, "ShieldExecuted", (ev, slot, sig) => {
  console.log("shield event", ev, slot, sig);
});
await sub.unsubscribe();
```

## Building from source

```bash
cd sdk
yarn install
yarn build
yarn test
```

Build output lands in `dist/`. The package.json `files` field ensures only `dist`, `src`, `README.md`, and `LICENSE` are packed on publish.

## License

MIT. See [LICENSE](./LICENSE).

## Links

- Main repo: [ghosxyz/ghos](https://github.com/ghosxyz/ghos)
- Website: [ghos.xyz](https://ghos.xyz)
- Docs: [ghos.xyz/docs](https://ghos.xyz/docs/)
- Program ID (devnet and mainnet): `EnKo8EbfJkani8UePTmAVPzdCZM8vMEYYkjTar4fwBPg`
