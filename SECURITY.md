# Security Policy

## Supported versions

The `main` branch and the most recent minor release receive security updates.

| Version | Supported |
| ------- | --------- |
| 0.4.x   | yes       |
| 0.3.x   | no        |
| < 0.3   | no        |

## Reporting a vulnerability

Email `security@ghos.xyz` with a reproduction. Do not file a public issue.
Encrypt with the PGP key published at https://ghos.xyz/.well-known/pgp.asc.

You should get an acknowledgement within 72 hours. A first triage update is
sent within 7 days. If a vulnerability is confirmed, a fix and a disclosure
timeline follow, typically 30 days from triage unless active exploitation is
observed.

## Out of scope

- Known-to-be-public cryptographic properties of Token-2022 Confidential
  Transfer or twisted ElGamal. Those are upstream Solana primitives.
- Attacks that require compromise of the RPC endpoint the user connects to.
  Use a node you trust.
- Social engineering, physical access, and supply chain attacks on the user's
  own device.

## In scope

- Anchor program state corruption via crafted inputs
- Proof verification bypass in the ghos program or CPI boundary
- PDA seed collisions, account substitution, sysvar spoofing
- SDK / CLI bugs that leak plaintext amounts or secret keys to the network
- Any bug that breaks single-author commit integrity on this repository
