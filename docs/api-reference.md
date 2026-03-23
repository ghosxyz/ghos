# API Reference

Complete reference for the ghos TypeScript SDK and the Python CLI. Every
entry here maps to exactly one on-chain instruction; the two client
surfaces are kept in lock step by the shared IDL and a shared conformance
test suite.

## SDK surface

### GhosClient

```ts
class GhosClient {
  constructor(options: GhosClientOptions);
  readonly programId: PublicKey;
  readonly connection: Connection;

  shield(args: ShieldArgs, opts?: SendOpts): Promise<ShieldResult>;
  applyPendingBalance(args: { mint: PublicKey }, opts?: SendOpts): Promise<ApplyResult>;
  confidentialTransfer(args: TransferArgs, opts?: SendOpts): Promise<TransferResult>;
  withdraw(args: WithdrawArgs, opts?: SendOpts): Promise<WithdrawResult>;

  createBurner(args: CreateBurnerArgs, opts?: SendOpts): Promise<BurnerResult>;
  destroyBurner(args: { entry: PublicKey }, opts?: SendOpts): Promise<TxResult>;

  mixInit(args: MixInitArgs, opts?: SendOpts): Promise<MixInitResult>;
  mixCommit(args: MixCommitArgs, opts?: SendOpts): Promise<TxResult>;
  mixReveal(args: MixRevealArgs, opts?: SendOpts): Promise<TxResult>;
  mixSettle(args: { round: PublicKey }, opts?: SendOpts): Promise<TxResult>;

  registerAuditor(args: AuditorRegisterArgs, opts?: SendOpts): Promise<TxResult>;
  rotateAuditor(args: AuditorRotateArgs, opts?: SendOpts): Promise<TxResult>;

  updateConfig(args: ConfigUpdateArgs, opts?: SendOpts): Promise<TxResult>;

  on(event: GhosEventName, cb: (payload: unknown) => void): EventSubscription;
  getConfig(): Promise<GhosConfigAccount>;
  getAuditor(mint: PublicKey): Promise<AuditorEntryAccount | null>;
  getBurner(owner: PublicKey, nonce: number): Promise<BurnerAccountAccount | null>;
  getMixRound(host: PublicKey, nonce: number): Promise<MixRoundAccount | null>;
}
```

### Option types

```ts
interface GhosClientOptions {
  connection: Connection;
  payer: Keypair | Signer;
  programId?: PublicKey;
  commitment?: Commitment;
  computeUnitLimit?: number;
  computeUnitPrice?: number;
}

interface SendOpts {
  feePayer?: Signer;
  additionalSigners?: Signer[];
  skipPreflight?: boolean;
  maxRetries?: number;
}
```

### Instruction argument types

```ts
interface ShieldArgs {
  mint: PublicKey;
  amount: bigint; // atomic, multiple of 1000
}

interface TransferArgs {
  mint: PublicKey;
  toOwner: PublicKey;
  amount: bigint; // atomic, multiple of 1000
}

interface WithdrawArgs {
  mint: PublicKey;
  amount: bigint;
  destination?: PublicKey; // defaults to payer's public ATA
}

interface CreateBurnerArgs {
  ttlSeconds: number; // 60..2_592_000
  nonce?: number;     // defaults to monotonic
}

interface MixInitArgs {
  mint: PublicKey;
  denomination: bigint;
  capacity: number; // 4..16
}

interface MixCommitArgs {
  round: PublicKey;
  commitment: Uint8Array; // 32 bytes
}

interface MixRevealArgs {
  round: PublicKey;
  amount: bigint;
  salt: Uint8Array;
  output: PublicKey;
}

interface AuditorRegisterArgs {
  mint: PublicKey;
  auditorPubkey: Uint8Array; // 32 bytes
  rotationCooldown: number;  // seconds
}

interface AuditorRotateArgs {
  mint: PublicKey;
  newPubkey: Uint8Array;
}

type ConfigUpdateField =
  | "paused"
  | "dust_free_unit"
  | "burner_ttl_max"
  | "burner_ttl_min"
  | "mix_min_participants"
  | "mix_max_participants"
  | "mix_reveal_window"
  | "auditor_cosign_lamports";

interface ConfigUpdateArgs {
  field: ConfigUpdateField;
  value: bigint | number | boolean;
}
```

### Result types

```ts
interface TxResult {
  signature: string;
  slot: number;
  blockTime?: number | null;
}

interface ShieldResult extends TxResult {
  amount: bigint;
  mint: PublicKey;
}

interface ApplyResult extends TxResult {
  appliedCounter: bigint;
}

interface TransferResult extends TxResult {
  proofContext: PublicKey;
  mint: PublicKey;
}

interface WithdrawResult extends TxResult {
  amount: bigint;
  auditorCosigned: boolean;
}

interface BurnerResult extends TxResult {
  entry: PublicKey;
  burner: Keypair;
  expiresAt: number;
}

interface MixInitResult extends TxResult {
  round: PublicKey;
  nonce: number;
  commitCloseAt: number;
  revealCloseAt: number;
}
```

### Account views

```ts
interface GhosConfigAccount {
  admin: PublicKey;
  version: number;
  paused: boolean;
  dustFreeUnit: bigint;
  burnerTtlMax: bigint;
  burnerTtlMin: bigint;
  burnerRegistryCap: number;
  mixMinParticipants: number;
  mixMaxParticipants: number;
  mixRevealWindow: bigint;
  auditorCosignLamports: bigint;
  lastUpdated: bigint;
  bump: number;
}

interface AuditorEntryAccount {
  mint: PublicKey;
  auditorPubkey: Uint8Array;
  registeredAt: bigint;
  lastRotatedAt: bigint;
  rotationCooldown: bigint;
  admin: PublicKey;
  bump: number;
}

interface BurnerAccountAccount {
  owner: PublicKey;
  burnerPubkey: PublicKey;
  createdAt: bigint;
  expiresAt: bigint;
  nonce: bigint;
  revoked: boolean;
  usageCount: number;
  bump: number;
}

interface MixRoundAccount {
  mint: PublicKey;
  denomination: bigint;
  host: PublicKey;
  capacity: number;
  committed: number;
  revealed: number;
  phase: MixPhase;
  openedAt: bigint;
  commitCloseAt: bigint;
  revealCloseAt: bigint;
  settledAt: bigint;
  bump: number;
}

type MixPhase = "Open" | "Commit" | "Reveal" | "Settling" | "Settled" | "Aborted";
```

### Crypto helpers

```ts
namespace crypto {
  function deriveElGamalKey(
    signer: Signer | Keypair,
    mint: PublicKey
  ): ElGamalKeyPair;

  class ElGamalKeyPair {
    encrypt(amount: bigint): Ciphertext;
    decrypt(cipher: Ciphertext): bigint;
    public: Uint8Array; // 32 bytes
    secret: Uint8Array; // 32 bytes
  }

  interface Ciphertext {
    c1: Uint8Array; // 32 bytes
    c2: Uint8Array; // 32 bytes
  }

  function rangeProof(amount: bigint, randomness: Uint8Array): Uint8Array;
  function equalityProof(params: EqualityParams): Uint8Array;
  function pubkeyValidityProof(pk: Uint8Array, secret: Uint8Array): Uint8Array;
  function zeroBalanceProof(cipher: Ciphertext, secret: Uint8Array): Uint8Array;
}
```

### Events

```ts
type GhosEventName =
  | "ConfigInitialized"
  | "ConfigUpdated"
  | "ShieldExecuted"
  | "ConfidentialTransferSubmitted"
  | "PendingApplied"
  | "WithdrawExecuted"
  | "BurnerCreated"
  | "BurnerDestroyed"
  | "AuditorRegistered"
  | "AuditorRotated"
  | "MixRoundOpened"
  | "MixCommitted"
  | "MixRevealed"
  | "MixSettled";

interface EventSubscription {
  dispose(): void;
  id: number;
}
```

### Errors

```ts
class GhosError extends Error {
  code: number;
  name: string;
  logs: string[];
}
```

Error codes follow the Rust enum in `errors.rs`, ordinals match.

| Name                          | Code |
| ----------------------------- | ---- |
| AmountBelowDustFloor          | 6000 |
| AmountNotAligned              | 6001 |
| MintMissingConfidentialExt    | 6002 |
| MintWrongProgramOwner         | 6003 |
| AccountNotConfidential        | 6004 |
| AccountOwnerMismatch          | 6005 |
| InvalidCiphertext             | 6006 |
| RangeProofVerificationFailed  | 6007 |
| EqualityProofVerificationFailed | 6008 |
| PubkeyValidityProofFailed     | 6009 |
| ZeroBalanceProofFailed        | 6010 |
| AuditorEntryMissing           | 6011 |
| AuditorMismatch               | 6012 |
| AuditorRotationTooSoon        | 6013 |
| BurnerTtlOutOfRange           | 6014 |
| BurnerExpired                 | 6015 |
| BurnerAlreadyRegistered       | 6016 |
| BurnerCapReached              | 6017 |
| MixBelowMinimum               | 6018 |
| MixRoundFull                  | 6019 |
| MixNotInCommit                | 6020 |
| MixNotInReveal                | 6021 |
| MixRevealMismatch             | 6022 |
| MixRevealTimeout              | 6023 |
| MixDenominationMismatch       | 6024 |
| MixAlreadyCommitted           | 6025 |
| MixNotCommitted               | 6026 |
| NotAdmin                      | 6027 |
| Paused                        | 6028 |
| UnexpectedProofContext        | 6029 |
| ConfidentialTransferDisabled  | 6030 |
| NothingToApply                | 6031 |
| WithdrawExceedsAvailable      | 6032 |
| ProtocolVersionMismatch       | 6033 |

## CLI surface

```
ghos init
  --cluster <url|alias>   devnet | mainnet-beta | localnet | <url>
  --wallet  <path>        default ~/.config/solana/id.json

ghos shield --mint <pk> --amount <ui>
ghos apply --mint <pk>
ghos send <recipient> <amount> --mint <pk> [--confidential]
ghos withdraw --mint <pk> --amount <ui>
ghos status [--mint <pk>]

ghos burner create --ttl <duration>   e.g. 24h, 30m, 7d
ghos burner list
ghos burner destroy <burner-pubkey>

ghos mix open --mint <pk> --denom <ui> --capacity <n>
ghos mix join <round> --amount <ui>
ghos mix reveal <round>
ghos mix settle <round>
ghos mix status <round>
ghos mix list [--mint <pk>]

ghos audit register --mint <pk> --pubkey <hex> [--cooldown <duration>]
ghos audit rotate   --mint <pk> --pubkey <hex>
ghos audit list

ghos config paused <true|false>
ghos config get <field>
```

### Global flags

| Flag          | Description                                          |
| ------------- | ---------------------------------------------------- |
| `--cluster`   | Override the active cluster                          |
| `--wallet`    | Override the active wallet                           |
| `--json`      | Emit machine-readable JSON on stdout                 |
| `--verbose`   | Include full hex, PDA bumps, timing                  |
| `--dry-run`   | Build but do not send the transaction                |
| `--help`      | Show command help                                    |

### Duration parsing

Accepted suffixes: `s`, `m`, `h`, `d`. Examples: `30s`, `5m`, `24h`,
`7d`, `30d`. Values above `BURNER_TTL_MAX` are rejected client-side
before hitting the network.

### Environment variables

| Env                | Overrides                                  |
| ------------------ | ------------------------------------------ |
| `GHOS_CLUSTER`     | `--cluster`                                |
| `GHOS_WALLET`      | `--wallet`                                 |
| `GHOS_MINT`        | Default mint for shield/send/withdraw/etc. |
| `GHOS_JSON`        | Treat output as JSON always                |

### Exit codes

| Code | Meaning                                   |
| ---- | ----------------------------------------- |
| 0    | success                                   |
| 1    | user error (bad argument)                 |
| 2    | config error (missing wallet, bad rpc)    |
| 3    | network error                             |
| 4    | program error (any GhosError variant)     |
| 5    | cryptographic error (proof gen failed)    |

## IDL

The Anchor-generated IDL lives at `sdk/src/idl/ghos.json` and is
rewritten on every `anchor build`. The `scripts/export_idl.ts` script
copies the fresh IDL into the SDK bundle. The SDK imports it at compile
time, so a mismatch between the deployed program and the SDK version is
caught by the TypeScript compiler before any runtime call.

## Version compatibility matrix

| SDK version | Program version | Anchor | Solana CLI |
| ----------- | --------------- | ------ | ---------- |
| 0.4.1       | 0x0401          | 0.30.1 | 1.18.x     |
| 0.4.0       | 0x0400          | 0.30.1 | 1.18.x     |
| 0.3.x       | 0x0300          | 0.30.x | 1.18.x     |

## Determinism guarantees

- Every PDA derivation call returns the same pubkey given the same
  inputs across runs, language runtimes, and operating systems.
- `deriveElGamalKey(signer, mint)` is deterministic over
  `(signer.secret, mint)`.
- `buildMixCommitment(amount, output, salt)` is deterministic over its
  three inputs.
- Anchor discriminators are computed as `sha256("global:<name>")[..8]`,
  fixed across builds.
