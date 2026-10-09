# Changelog

All notable changes to this package are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package uses
[Semantic Versioning](https://semver.org/). The manifest format has its own version (`version: 1`),
independent of the package version.

## Unreleased

- Development: vitest 4.1.11 / tsup 8.5.1, with esbuild held at ^0.28.1 by a pnpm override; clears
  dev-only advisories in the test and build toolchain. No runtime change.

## 0.1.2 — 2026-10-09

- `isRollingTag` and the `rolling_release_tag` warning follow HEY's rule as of 2026-10-09: a CI
  build stamp — a word stem, a run number and an attempt (`server-image-1234-1`, `docker_412_2`),
  or `build`/`ci` straight before a number (`build-123`, `ci-456`) — is rolling too. Versions near
  that shape (`release-12-1`, `release-2024-10`, `app-1-4`, `v1.2.3-build-45`) are not. A warning
  only: no manifest that was valid becomes invalid.
- The README points at HEY's own manifest, https://heyresearch.xyz/.well-known/hey-project.json, as
  a working reference; it validates with no error and no warning.

## 0.1.1 — 2026-10-02

- `ManifestValidation` is a union narrowed on `valid`: `if (result.valid) result.manifest.contracts` compiles under strict TypeScript, as the README shows. The JSON shape is unchanged.
- Issue templates (bug, idea) with private security reporting and HEY corrections linked.

## 0.1.0 — 2026-10-02

Initial release.

### Added

- The `hey-project.json` v1 format for Robinhood Chain projects (chainId `4663` only, no
  `chains[]`), published at `/.well-known/hey-project.json`.
- JSON Schema (draft 2020-12) at `schema/hey-project.v1.json`, also exported as
  `@hey-research-lab/project-manifest/schema/hey-project.v1.json`.
- zod runtime schema (`heyProjectManifestSchema`) and TypeScript types (`HeyProjectManifest`,
  `HeyProjectContract`, `ManifestValidation`, `ManifestIssue`).
- `parseManifest` and `validateManifest`: every issue at once, each with a stable code, severity,
  path and JSON Pointer; the normalised manifest when valid; `declarationState: "DECLARED"` and
  `verified: false` on every result.
- Rules: version 1; chainId 4663 (`unsupported_chain`); EVM addresses with EIP-55 checksums for
  mixed case and lowercase normalisation; zero and dead addresses refused as contract identities;
  transaction hashes and commit ids; contract types `token`, `protocol`, `factory`, `router`,
  `pool`, `vault`, `nft`, `other`; https-only URLs; duplicate contracts and repositories after
  normalisation; GitHub repositories canonicalised to `https://github.com/<owner>/<repo>`; X
  profiles canonicalised to `https://x.com/<handle>`; size and item limits; prototype-pollution
  keys refused; warnings for rolling release tags, a manifest with nothing to corroborate, and a
  website on another host than the one the manifest was read from.
- `fetchManifest`: reads only `https://<host>/.well-known/hey-project.json`, with connect-time
  address checks, no redirects, a 256 KB body cap and a 10 second timeout.
- `hey-project` CLI: `init` (flags only, writes a valid template), `validate [file|url]` and
  `inspect [file|url]`, with `--json` output (`hey.cli/v1`) and the ecosystem's exit codes.
