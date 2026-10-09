# Contributing

Thank you for helping. This package defines a format other tools rely on, so changes are careful
and small.

## Setup

```sh
corepack enable
pnpm install
pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm scan
```

Node 22 is used for development and CI; the published library supports Node 18 and later.

## Rules

- **Tests never touch the network.** `vitest.setup.ts` replaces `fetch` with a function that
  throws. Remote reads are tested with an injected `transport` and `resolve`.
- **Every rule has a fixture.** A new rule adds an invalid fixture under `test/fixtures/invalid/`,
  its expected code and pointer in `test/helpers.ts`, and whether the JSON Schema can also reject
  it. Valid fixtures must pass both the validator and the JSON Schema.
- **Issue codes are public.** Never rename or repurpose one within a major version.
- **The format is strict and additive.** A new optional field updates the zod schema, the JSON
  Schema, the types, `docs/specification.md`, the README table and the fixtures together. A change
  of meaning is a new major format.
- **Declared is not verified.** Nothing in this package may describe a manifest, or anything it
  computes, as verified, owned, safe or endorsed.
- **Robinhood Chain only.** No multi-chain options.
- **Minimal dependencies.** Runtime dependencies are `zod` and `@noble/hashes`; anything else needs
  a justification in the README.
- Never commit secrets or a `.env` with values. `pnpm scan` checks for secret shapes and
  attribution lines; it runs in CI.
- Conventional commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`, `ci:`).

## Maintainers: parity

This repository is new (not extracted). The pieces it shares with HEY Research Lab's production
contract were taken from it on 2026-10-02 and were last brought in step with production as of
2026-10-09:

- `src/chain.ts` and `src/evm.ts` are the ecosystem's shared chain and EVM helpers, identical in
  every HEY ecosystem repository (chain id `4663`, `eip155:4663`, the explorer, the
  `unsupported_chain` error and its message, lowercase address and hash normalisation).
- `src/ip.ts` classifies refused addresses with the same ranges as the public URL-safety guard in
  `hey-research-lab/hey-research-open` (`packages/sources/src/http/url-safety.ts`).
- `src/rolling-tag.ts` restates HEY's rolling-tag rule (prefixes, suffixes, exact words, data-date
  and build-stamp tags, and since 2026-10-08 CI build stamps) as production applies it. Here it
  only raises a warning.
- `CLAIM_CHALLENGE_PATH` (`/.well-known/hey-research.txt`) names HEY's ownership-claim challenge
  file, which this format must never replace.

When production changes any of these, update this repository and the date above together.

## Releasing

Releases are cut by the maintainers: bump the version in `package.json` and `src/version.ts`
(a test keeps them equal), add a `CHANGELOG.md` entry, tag `vX.Y.Z`, and publish from a clean
checkout with `npm publish --access public`.
