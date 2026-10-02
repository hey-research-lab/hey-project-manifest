# Changelog

All notable changes to this package are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package uses
[Semantic Versioning](https://semver.org/). The manifest format has its own version (`version: 1`),
independent of the package version.

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
