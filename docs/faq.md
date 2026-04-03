# FAQ

Answers to the 15+ questions that actually come up.

## 1. What is ghos?

A Solana on-chain program plus an SDK and a CLI that wrap the Token-2022
Confidential Transfer extension and add burner accounts, CoinJoin mixing
rounds, and an auditor registry. Balances are ElGamal-encrypted on-chain,
transfer amounts never appear in plaintext, and proof generation runs
on the user's device.

## 2. Is ghos a wallet?

No, it is a protocol plus client tooling. A wallet (Phantom, Backpack,
Solflare, a hardware signer, or any Solana-compatible wallet) signs
transactions. The ghos SDK produces those transactions. The ghos
program validates them on-chain.

## 3. What does the ticker $GHOS represent?

Network and community governance token. The ghos Anchor program does
not require $GHOS for any instruction. Having the token is not a
precondition to using the privacy features.

## 4. Do I need a special mint?

Yes, the mint must be a Token-2022 mint with the Confidential Transfer
extension initialized at mint creation. Regular SPL Token v1 mints are
not usable. The extension cannot be added retroactively.

## 5. Who can audit my transactions?

Only the holder of the auditor ElGamal secret for the relevant mint. The
auditor pubkey is set at mint creation (Token-2022 level) and mirrored
in ghos's AuditorEntry PDA. If a mint has no auditor configured,
nobody can decrypt transfer amounts on that mint.

## 6. Can the admin read my balance?

No. The admin (ghos multisig) holds no user ElGamal secret. The admin
can pause the protocol, tune knobs in GhosConfig, and rotate an
auditor's registered pubkey, but cannot decrypt ciphertexts.

## 7. What is a burner account?

An ephemeral signer registered to an owner for a bounded lifetime
(60 seconds to 30 days). Use burners to authorize ghos instructions
from short-lived contexts (browser tab, mobile session, bot), keeping
the long-lived signer offline. See `docs/burner-accounts.md`.

## 8. What is a mix round?

A denomination-fixed CoinJoin: N participants contribute equal-note
amounts of the same denomination, then receive equal notes at fresh
output addresses. The anonymity set is the round's participant count.
See `docs/coinjoin.md`.

## 9. Why denomination-fixed and not variable?

Variable-amount mixes leak information via the amount itself. An
observer who sees a 1.37-unit input and a 1.37-unit output likely
identified the same participant. Equal-note mixes reduce every output
to an indistinguishable quantum.

## 10. Can I mix any amount?

Only in multiples of the round's denomination. The usual flow is:
split your balance into equal-denomination notes via one or more
preparatory transfers, then mix each note through a separate round.
This preserves the anonymity set property.

## 11. What is the minimum participant count for a mix?

4 by default, set by `MIX_MIN_PARTICIPANTS`. Any round with fewer than
4 revealers aborts and returns notes to the participants. In practice
aim for the maximum (16) for meaningful privacy.

## 12. What if the host disappears?

Each round has a reveal deadline `reveal_close_at = commit_close_at +
MIX_REVEAL_WINDOW_SECONDS (10 minutes)`. After the deadline anyone can
trigger a refund path for revealed participants. The host cannot lock
funds.

## 13. How are ElGamal keys managed?

Derived deterministically from the owner's Solana signer plus the mint.
No extra seed phrase to back up. Losing the Solana signer loses the
confidential balance, same as regular self-custody.

## 14. Does ghos support hardware wallets?

Yes for signing. Ledger / Keystone / Trezor produce the Ed25519
signatures needed by ghos instructions. Proof generation happens on
the host device, not on the hardware wallet, because it requires access
to the derived ElGamal key (which in turn requires signing a domain-
separated message with the signer).

## 15. How fast is a confidential transfer?

Roughly:

- Proof generation (client): 180 to 250 ms on a mid-range CPU.
- Transaction submission: 400 to 1000 ms to landed + confirmed.
- Confidential transfer CU cost: ~410 k, within the 600 k budget.

End-to-end time is dominated by network latency to the RPC.

## 16. Does ghos work on localnet?

Partially. The ghos program itself runs on any validator. The
spl-zk-token-proof program is not loaded by default in
`solana-test-validator`, so the proof-verifying paths fail. Work around
this by cloning the program:

```
solana-test-validator --clone ZkTokenProof1111111111111111111111111111111 \
  --url https://api.devnet.solana.com --reset
```

## 17. How much SOL do I need?

| Action                       | Approx SOL                     |
| ---------------------------- | ------------------------------ |
| One shield + transfer + apply | 0.001 (fees, ignoring rent)    |
| Creating a Token-2022 mint    | 0.003 (rent + account init)    |
| Creating a burner entry       | 0.0006 (rent)                  |
| Opening a mix round           | 0.0008 (rent)                  |
| Registering an auditor        | 0.0012 (rent)                  |

Budget 0.05 SOL for a full mainnet onboarding. Reclaim rent on destroy
paths.

## 18. Can ghos see the amounts?

No. The on-chain program only handles ciphertexts, proofs, and
commitments. No plaintext amount ever appears in program memory
outside of the public SPL balance at shield time and at withdraw time.

## 19. What happens if I lose my burner secret?

The burner is unusable until it expires or is destroyed. Since the
owner signer can always destroy a burner entry, you can reclaim rent
and issue a fresh burner. Any funds routed through the lost burner
that haven't been swept elsewhere are recoverable only if the attacker
doesn't race you to the withdraw.

## 20. Is there a token launch schedule?

See the project website (ghos.xyz) and X account (@ghosxyz) for
launch-related announcements. The ghos privacy program does not
require any token and is usable against any Token-2022 confidential
mint independent of the launch schedule.

## 21. Can I integrate ghos into my own program?

Yes. Add the `ghos` crate as an Anchor CPI dependency. See
`docs/integration.md` for a full Rust example.

## 22. Can I run ghos with my own auditor?

Yes. Create a Token-2022 mint with your auditor ElGamal public key at
mint creation, then register the same pubkey in ghos via
`auditor_register`. The program ties the two together automatically.

## 23. What is the license?

MIT. See `LICENSE` at the repo root.

## 24. How do I report security issues?

Email `security@ghos.xyz`. Do not open a public GitHub issue for
anything that could put users at risk before a fix lands.

## 25. Where is the program deployed?

`EnKo8EbfJkani8UePTmAVPzdCZM8vMEYYkjTar4fwBPg` on devnet. Mainnet
deployment happens after the audit. The program id is identical across
clusters, matching the declared id in `programs/ghos/src/lib.rs`.

## 26. Why did my transfer fail with `AmountNotAligned`?

Amounts must be a multiple of 1000 atomic units (the dust-free
quantization unit). Round up or down to the nearest 1000.

## 27. How often is the codebase audited?

Every public release receives at minimum an internal review; external
audits land before mainnet deployment and on major version bumps.
Audit reports are published under `audits/` in the repo once available.

## 28. Is there a bug bounty?

See `SECURITY.md` for the current bounty tiers.

## 29. Does ghos require KYC?

No. ghos is a protocol. KYC is a mint-level and jurisdiction-level
concern. A mint authority who wants KYC can disable
`auto_approve_new_accounts` and require off-chain attestation before
approving confidential accounts. ghos itself takes no position.

## 30. How do I back up my ElGamal keys?

You do not need to. The keys are derived from your Solana signer.
Back up the Solana signer the same way you would for any Solana
wallet (seed phrase, hardware device).
