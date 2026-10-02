# hey-project-manifest

A machine-readable file, `/.well-known/hey-project.json`, in which a Robinhood Chain project
declares its name, website, repositories and contracts — with a JSON Schema, TypeScript types, a
validator and the `hey-project` CLI. **Declared, not verified.**

[![CI](https://github.com/hey-research-lab/hey-project-manifest/actions/workflows/ci.yml/badge.svg)](https://github.com/hey-research-lab/hey-project-manifest/actions/workflows/ci.yml)
[![Licence: MIT](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-informational.svg)](package.json)
[![Robinhood Chain 4663](https://img.shields.io/badge/Robinhood%20Chain-4663-informational.svg)](https://robinhoodchain.blockscout.com)

## Why it exists

Anyone researching a Robinhood Chain project has to piece its identity together from a website, an
explorer, a repository host and social profiles, and every reader repeats the work. A small file
the project publishes on its own site gives every reader the same starting point: what the project
says its contracts and repositories are. It is a first-party statement in a known place and a
known shape — a lead that readers check, not a conclusion.

## Why Robinhood Chain only

HEY Research Lab researches projects on Robinhood Chain (chain id `4663`, CAIP-2 `eip155:4663`)
and nothing else. A v1 manifest has `"chainId": 4663` and no `chains[]` list, network option or
RPC field. Any other chain id — including the string `"4663"` — is rejected with
`unsupported_chain`.

## Install

```sh
npm i @hey-research-lab/project-manifest
# or run the CLI without installing
npx @hey-research-lab/project-manifest init
```

Once the package is installed in a project, the bin is `hey-project` (`npx hey-project init`).
Without it installed, use the scoped name above: `npx hey-project` alone would resolve a different
package on the registry. The library
supports Node 18 and later; it depends only on `zod` and `@noble/hashes`.

## Smallest working example

```sh
npx hey-project init \
  --name "Example Protocol" \
  --website https://example.com \
  --repository https://github.com/example/protocol \
  --contract 0x0000000000000000000000000000000000000001:token
npx hey-project validate        # reads ./.well-known/hey-project.json
```

That writes, and then validates:

```json
{
  "$schema": "https://raw.githubusercontent.com/hey-research-lab/hey-project-manifest/main/schema/hey-project.v1.json",
  "version": 1,
  "name": "Example Protocol",
  "website": "https://example.com/",
  "chainId": 4663,
  "repositories": ["https://github.com/example/protocol"],
  "contracts": [{ "address": "0x0000000000000000000000000000000000000001", "type": "token" }]
}
```

Publish it so that `https://<your domain>/.well-known/hey-project.json` answers `200` with that
JSON — directly, without a redirect.

From code:

```ts
import { parseManifest } from '@hey-research-lab/project-manifest';

const result = parseManifest(text);
result.declarationState; // always "DECLARED"
result.verified; // always false
if (result.valid) console.log(result.manifest.contracts);
else for (const issue of result.issues) console.log(issue.code, issue.pointer, issue.message);
```

## The format

The full specification is [`docs/specification.md`](docs/specification.md). In short:

| Field           | Required | Rule                                                                                                        |
| --------------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| `version`       | yes      | The integer `1`.                                                                                            |
| `name`          | yes      | 1–120 characters; no leading/trailing space, control, zero-width or bidi-override characters.               |
| `website`       | yes      | https URL (rules below). The site that serves the manifest.                                                 |
| `chainId`       | yes      | The integer `4663` (Robinhood Chain).                                                                       |
| `repositories`  | no       | Up to 20 https URLs. GitHub: `https://github.com/<owner>/<repo>`. No duplicates after canonicalisation.     |
| `contracts`     | no       | Up to 100 objects (below). No address twice, compared in lowercase.                                         |
| `documentation` | no       | https URL.                                                                                                  |
| `changelog`     | no       | https URL.                                                                                                  |
| `feed`          | no       | https URL of an RSS, Atom or JSON feed.                                                                     |
| `officialX`     | no       | `https://x.com/<handle>` (twitter.com accepted, canonicalised to x.com).                                    |
| `logo`          | no       | https URL.                                                                                                  |
| `release`       | no       | The release tag or version the contracts correspond to. A rolling tag (`latest`, `nightly…`, `edge`) warns. |
| `commit`        | no       | Full git commit id (40 or 64 hex).                                                                          |
| `$schema`       | no       | Editor hint; when present, exactly the schema `$id`.                                                        |

A contract is `{ "address", "type", "name"?, "deployer"?, "deploymentTx"? }`:

- `address` — `0x` + 40 hex. Lowercase or uppercase as written; mixed case must pass EIP-55
  (`invalid_checksum`). A `0X` prefix is refused. Normalised to lowercase. The zero and dead
  addresses are never a contract identity (`not_a_contract_identity`).
- `type` — one of `token`, `protocol`, `factory`, `router`, `pool`, `vault`, `nft`, `other`.
- `name` — 1–80 characters, same text rules as `name`.
- `deployer` — the address the project says deployed this contract (same address rules).
- `deploymentTx` — the creating transaction, `0x` + 64 hex, normalised to lowercase.

`deployer` and `deploymentTx` are declared per contract, because a project's contracts are
deployed separately.

**URLs** in a manifest must be `https:`. Refused: every other scheme (`http:`, `javascript:`,
`data:`, `file:`, `blob:` …), a username or password, IP-literal hosts, `localhost`, `.local`,
`.internal`, single-label hosts, internationalised (`xn--` or non-ASCII) hosts, spaces, control
characters, backslashes, and anything over 500 characters. They are normalised: lowercase host, no
default port, no fragment. Unknown fields are errors: v1 is strict.

## CLI

```
hey-project init [options]                  Write a valid manifest (no prompts)
hey-project validate [file | https://domain]
hey-project inspect  [file | https://domain]
```

- `init` writes `.well-known/hey-project.json` (or `--out <path>`, or `--stdout`). Flags:
  `--name`, `--website`, `--repository` (repeatable), `--contract <address[:type]>` (repeatable,
  type defaults to `other`), `--documentation`, `--changelog`, `--feed`, `--x`, `--logo`,
  `--release`, `--commit`, `--force`. Without `--name`/`--website` it writes placeholders and says
  so. It never overwrites without `--force` and never writes through a symbolic link. Values are
  validated before anything is written; the file holds the normalised form.
- `validate` and `inspect` read `./.well-known/hey-project.json`, then `./hey-project.json`, or the
  file given. An argument starting `https://` reads `https://<domain>/.well-known/hey-project.json`
  — only that URL. `inspect` prints what is declared, with EIP-55 display addresses and explorer
  links.
- Common flags: `--json` (one `hey.cli/v1` document on stdout), `--quiet`, `--no-color` (output is
  never coloured), `--help`, `--version`.

| Exit | Meaning                                                                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------ |
| 0    | valid (warnings allowed) / written                                                                           |
| 1    | invalid manifest, or the site answered with a redirect, a 4xx other than 404/429, or too much data           |
| 2    | usage error: bad flag or argument, unreadable/symlinked file, refused target (scheme, host, private address) |
| 4    | no manifest at the URL (404 or 410)                                                                          |
| 5    | rate limited (429)                                                                                           |
| 6    | network failure, DNS failure, timeout or 5xx                                                                 |

## Library API

| Export                                                                                                                                                     | What it does                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parseManifest(text \| bytes, options?)`                                                                                                                   | Size cap, UTF-8, JSON parse, then `validateManifest`. Never throws.                                                                                                                                               |
| `validateManifest(value, options?)`                                                                                                                        | Every v1 rule. Returns `{ valid, declarationState: 'DECLARED', verified: false, manifest?, issues, errorCount, warningCount }`.                                                                                   |
| `fetchManifest(domain, options?)`                                                                                                                          | Reads `https://<domain>/.well-known/hey-project.json` with the guards in [SECURITY.md](SECURITY.md). Never throws; returns `{ ok: true, validation, … }` or `{ ok: false, error: { code, message, retryable } }`. |
| `heyProjectManifestSchema`                                                                                                                                 | The same rules as one zod schema (issue codes in `params.code`), output normalised.                                                                                                                               |
| `ISSUE_CODES`                                                                                                                                              | Every issue code and its severity.                                                                                                                                                                                |
| `createManifestTemplate(input)`                                                                                                                            | The document `init` writes.                                                                                                                                                                                       |
| `checkAuthoredUrl`, `checkRepositoryUrl`, `checkXProfileUrl`, `toChecksumAddress`, `isValidChecksum`, `isRollingTag`, `isPrivateAddress`, `manifestTarget` | The individual rules.                                                                                                                                                                                             |
| `CHAIN_ID`, `CAIP2`, `WELL_KNOWN_PATH`, `CLAIM_CHALLENGE_PATH`, `SCHEMA_ID`, `CONTRACT_TYPES`, `LIMITS`                                                    | Constants.                                                                                                                                                                                                        |

`validateManifest(value, { expectedHost })` adds the `website_host_mismatch` warning when the
website is on another host; `fetchManifest` sets it to the host it read from. `fetchManifest`
accepts an injected `transport` and `resolve` for tests or other runtimes.

Issue codes — errors: `invalid_json`, `too_large`, `not_an_object`, `forbidden_key`,
`unknown_field`, `missing_field`, `invalid_type`, `invalid_schema_reference`,
`unsupported_version`, `unsupported_chain`, `too_many_items`, `invalid_text`, `invalid_address`,
`invalid_checksum`, `not_a_contract_identity`, `invalid_tx_hash`, `invalid_commit`,
`invalid_release`, `invalid_contract_type`, `duplicate_contract`, `invalid_url`,
`unsafe_url_scheme`, `url_credentials`, `url_ip_literal`, `url_local_host`, `url_idn_host`,
`url_too_long`, `invalid_repository_url`, `duplicate_repository`, `invalid_x_url`. Warnings:
`rolling_release_tag`, `nothing_to_corroborate`, `website_host_mismatch`.

### JSON Schema

[`schema/hey-project.v1.json`](schema/hey-project.v1.json) (draft 2020-12, `$id`
`https://raw.githubusercontent.com/hey-research-lab/hey-project-manifest/main/schema/hey-project.v1.json`,
served from this repository until HEY serves it). It is the structural subset of the rules: it
cannot express EIP-55 checksums, duplicates after normalisation, or some text and URL rules. Use
the validator for the full set; the test suite checks that every valid fixture passes the schema
and records which invalid fixtures only the validator catches.

## How it relates to HEY Research Lab

[HEY Research Lab](https://heyresearch.xyz) researches which Robinhood Chain projects are still
building. This package defines a file a project can publish; it does not talk to HEY, and HEY's
production does not read `hey-project.json` today. If HEY reads it in future, it will be through a
source adapter that must first be given an explicit authority in HEY's provider registry, and the
manifest's role is fixed by the format itself:

- **A manifest is declared, never verified.** HEY would treat its contents as a first-party
  declaration — leads pointing at contracts and repositories — and corroborate each one from
  evidence HEY reads itself (on-chain records, the repository host, the project's own site). HEY's
  private quality gate stays authoritative; a manifest cannot publish, rank or verify a project,
  and it never moves activity status, Build Momentum or any other HEY rule.
- **It is not the claim file.** `/.well-known/hey-research.txt` is HEY's ownership-claim challenge:
  a one-time value HEY asks a claimant to publish while claiming a project page. That is a
  different mechanism with a different meaning. A manifest never carries, replaces or answers a
  claim challenge, and publishing one claims nothing.

HEY's public API and SDK are documented at https://heyresearch.xyz/developers.

## What it does NOT prove

A `hey-project.json` file is a first-party declaration. It does not prove that the publisher owns the listed contracts or repositories, who the builder is, which token is the project's, or that the project is legitimate. HEY treats it as declared and corroborates it independently; a valid manifest is never a verification.

HEY Research Lab is an independent research project and is not affiliated with, endorsed by or partnered with Robinhood Markets, Inc. or Robinhood Chain.

## Security

See [SECURITY.md](SECURITY.md). The library reads only what you give it. The CLI reads local files
(never through a symbolic link, at most 256 KB) and writes only with `init`. The one network call
is a remote read you ask for: exactly `https://<host>/.well-known/hey-project.json`, to a public
address checked at connect time, no redirects, 256 KB, 10 seconds. URLs inside a manifest are
never fetched.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). `pnpm install`, then `pnpm lint`, `pnpm typecheck`,
`pnpm test`, `pnpm build` and `pnpm scan` (leak and attribution scan). Tests never touch the
network. Never commit secrets.

## Licence

[MIT](LICENSE) © 2026 HEY Research Lab
