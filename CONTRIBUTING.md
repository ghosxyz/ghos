# Contributing to ghos

Thanks for thinking about contributing. ghos is a small codebase with a narrow
scope: Solana privacy OS primitives. The bar for changes is correctness and
clarity, in that order.

## Ground rules

1. Do not introduce dependencies that are not already in the workspace manifest
   unless the PR description explains why.
2. Every new instruction must be paired with at least one unit test and one
   integration test.
3. Public SDK and CLI surface is semver-stable across minor versions. Breaking
   changes bump the minor version and are called out in CHANGELOG.md.
4. No secrets in commits. If you accidentally add one, rotate it first,
   then remove it from history.

## Local setup

```bash
git clone https://github.com/ghosxyz/ghos.git
cd ghos
yarn install
anchor build
anchor test
```

For the Python CLI:

```bash
cd cli
pip install -e ".[dev]"
pytest
```

## Pull request flow

1. Fork, branch from `main`, and keep your branch current with `git fetch upstream && git rebase upstream/main`.
2. Commit messages use conventional commits: `feat:`, `fix:`, `refactor:`,
   `docs:`, `test:`, `chore:`, `ci:`, `perf:`, `deps:`, `style:`.
3. Run `yarn format`, `anchor test`, and `cargo fmt --all` before pushing.
4. Open a PR using the template. Fill in the test plan. Empty test plans get
   closed without discussion.
5. CI must be green before a maintainer reviews.

## Style

- Rust: `rustfmt` config in `rustfmt.toml`, clippy config in `clippy.toml`.
  No `unwrap()` in program code; bubble up a typed error.
- TypeScript: prettier config in `.prettierrc`, 2-space indent, trailing commas.
- Python: ruff defaults, 88-col line length, type hints on public surface.

## Security

See [SECURITY.md](SECURITY.md). Do not file security issues in public GitHub
issues.

## License

By contributing, you agree that your contributions will be licensed under the
MIT license as set out in [LICENSE](LICENSE).
