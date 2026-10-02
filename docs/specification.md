# `hey-project.json` — specification, version 1

Status: version 1, 2026-10-02. Reference implementation: `@hey-research-lab/project-manifest`.
JSON Schema: `schema/hey-project.v1.json`.

The key words "must", "must not", "should" and "may" are used as in RFC 2119.

## 1. Purpose and meaning

A `hey-project.json` file is a **first-party declaration** a Robinhood Chain project publishes
about itself: its name, website, source repositories and contracts. It gives every reader the same
starting point.

**Declared is not verified.** A manifest does not prove:

- that the publisher owns, controls or deployed the listed contracts;
- that the publisher owns or maintains the listed repositories;
- who the builder is;
- which token is the project's;
- that the project is legitimate, or anything about a token's price or future.

A reader must treat every field as the project's own statement and corroborate it from evidence it
reads itself. A tool must never present a valid manifest as a verification. Validation results
from the reference implementation always carry `declarationState: "DECLARED"` and
`verified: false`.

### 1.1 How HEY Research Lab treats a manifest

HEY's production does not read manifests today. When it does, the manifest will be a source with
an explicit, limited authority in HEY's provider registry: its contracts and repositories are
leads, each corroborated independently (on-chain creation records, the repository host, the
project's own site) before HEY relies on it. A manifest cannot publish, rank or verify a project on
HEY, and nothing in it reaches activity status, Build Momentum, the Discovery Gap or the Builder
Radar. HEY's quality gate stays authoritative.

### 1.2 Not the claim challenge

`/.well-known/hey-research.txt` is a different file with a different meaning: the value HEY asks a
claimant to publish while claiming a project page on HEY (ownership-claim challenge). A manifest
must not carry, replace or answer a claim challenge; publishing a manifest claims nothing on HEY.

## 2. Discovery

A project publishes its manifest at

```
https://<host>/.well-known/hey-project.json
```

on the host of its `website`. The response should be `200` with `content-type: application/json`,
at most 256 KB, UTF-8 (a leading byte-order mark is tolerated). Readers following this
specification:

- request only that URL, over `https:`, on the default port, without credentials or cookies;
- must not follow redirects — a 3xx is a failure;
- must refuse hosts that are IP literals, `localhost`, `.local`, `.internal`, single-label or
  internationalised names, and must refuse to connect to a private, loopback, link-local, CGNAT,
  documentation, multicast or otherwise reserved address (IPv4 and IPv6) the host resolves to;
- should time out after 10 seconds;
- must not fetch any URL found inside a manifest. Those URLs are data.

A reader may warn (`website_host_mismatch`) when the manifest's `website` is on another host than
the one it was read from (ignoring a leading `www.`).

## 3. Document

A manifest is a JSON object. Unknown fields are errors (v1 is strict). The keys `__proto__`,
`constructor` and `prototype` must not appear at any depth.

| Field           | Type   | Required | Rule                                                                                  |
| --------------- | ------ | -------- | ------------------------------------------------------------------------------------- |
| `$schema`       | string | no       | When present, exactly the v1 schema `$id`.                                            |
| `version`       | number | yes      | The integer `1`.                                                                      |
| `name`          | string | yes      | Text, 1–120 characters (§4.1).                                                        |
| `website`       | string | yes      | URL (§4.2).                                                                           |
| `chainId`       | number | yes      | The integer `4663`, Robinhood Chain (`eip155:4663`).                                  |
| `repositories`  | array  | no       | At most 20 repository URLs (§4.3), no duplicates after canonicalisation.              |
| `contracts`     | array  | no       | At most 100 contracts (§3.1), no address twice (compared in lowercase).               |
| `documentation` | string | no       | URL.                                                                                  |
| `changelog`     | string | no       | URL.                                                                                  |
| `feed`          | string | no       | URL of an RSS, Atom or JSON feed of the project's updates.                            |
| `officialX`     | string | no       | X profile URL (§4.4).                                                                 |
| `logo`          | string | no       | URL.                                                                                  |
| `release`       | string | no       | The release tag or version the declared contracts correspond to (§4.6).               |
| `commit`        | string | no       | The full git commit id the declared contracts correspond to: 40 or 64 hex characters. |

There is no `chains[]`, network, RPC or explorer field. Robinhood Chain is the only chain a v1
manifest can declare; any other `chainId` value — another chain, the string `"4663"`, a CAIP-2
string — is `unsupported_chain`.

### 3.1 Contract

| Field          | Type   | Required | Rule                                                                                  |
| -------------- | ------ | -------- | ------------------------------------------------------------------------------------- |
| `address`      | string | yes      | Address (§4.5). Never the zero or dead address (`not_a_contract_identity`).           |
| `type`         | string | yes      | `token`, `protocol`, `factory`, `router`, `pool`, `vault`, `nft` or `other`.          |
| `name`         | string | no       | Text, 1–80 characters.                                                                |
| `deployer`     | string | no       | Address (§4.5): the address the project says deployed the contract. Not zero or dead. |
| `deploymentTx` | string | no       | `0x` + 64 hex: the transaction the project says created the contract.                 |

A contract's `type` is the project's own description of its role. `deployer` is a declaration a
reader can check against the chain; it is never a label for a person.

## 4. Value rules

### 4.1 Text

Not empty, no leading or trailing whitespace, within its length limit (counted in code points), and
free of control characters (U+0000–U+001F, U+007F–U+009F), zero-width characters
(U+200B–U+200F, U+2060–U+2069), bidirectional overrides (U+202A–U+202E) and U+FEFF.

### 4.2 URL

- Scheme `https:` only, written `https://`. Every other scheme (`http:`, `javascript:`, `data:`,
  `file:`, `blob:`, `ftp:` …) is `unsafe_url_scheme`.
- At most 500 characters (`url_too_long`); printable ASCII only, no spaces or backslashes
  (`invalid_url`); non-ASCII in a path must be percent-encoded.
- No username or password (`url_credentials`).
- The host is a public DNS name: not an IP literal in any notation (`url_ip_literal`); not
  `localhost`, `*.localhost`, `*.local`, `*.internal`, `*.home.arpa`, `*.lan`, `*.intranet` or a
  single-label name (`url_local_host`); not internationalised (`xn--` labels or non-ASCII,
  `url_idn_host`).
- Normalised form: lowercase host without a trailing dot, default port dropped, fragment dropped.

### 4.3 Repository URL

A URL (§4.2). On `github.com` (or `www.github.com`) it must name exactly one repository,
`https://github.com/<owner>/<repo>`, optionally with `.git` or a trailing slash, and no query;
it canonicalises to lowercase `https://github.com/<owner>/<repo>`. On other hosts the path must be
non-empty; a trailing slash and `.git` are dropped. Duplicates are compared on the canonical form,
case-insensitively.

### 4.4 X profile

`https://x.com/<handle>` (also `www.x.com`, `twitter.com`, `www.twitter.com`,
`mobile.twitter.com`), handle 1–15 characters of `A–Z a–z 0–9 _`, not a reserved path such as
`home`, `i`, `intent` or `search`. A query or fragment is dropped. Canonical form:
`https://x.com/<handle>`.

### 4.5 Address

`0x` followed by 40 hexadecimal characters. An all-lowercase or all-uppercase address carries no
checksum and is accepted; a mixed-case address must match its EIP-55 checksum
(`invalid_checksum`). A `0X` prefix is refused. Normalised (and compared) in lowercase; tools may
display the EIP-55 form.

### 4.6 Release

1–128 characters: a letter or digit, then letters, digits, `.`, `_`, `+`, `-` or `/`, without `..`.
A rolling or automated tag — `latest*`, `nightly*`, `*-debug`, exactly `edge`, `canary`, `dev` or
`snapshot`, a data word before a date (`data-2026-10-01`) or a date-and-hash build stamp — raises
the warning `rolling_release_tag`: HEY never counts such a tag as a release, and it does not pin the
declared contracts to a build anyone can find again.

## 5. Results

A validator reports every issue it finds, not only the first. Each issue has a stable `code`, a
`severity` (`error` or `warning`), a `path` and the same location as an RFC 6901 JSON Pointer. A
manifest with no error is valid; warnings do not make it invalid. The codes are listed in the
README and exported as `ISSUE_CODES`; they are never renamed within a major version.

Warnings: `rolling_release_tag`; `nothing_to_corroborate` (no contracts and no repositories);
`website_host_mismatch` (only when the reading host is known).

## 6. Versioning

`version` is the format version, independent of the package version. Changes within version 1
are additive and ship with a new package minor (v1 validators are strict, so a new optional field
needs an updated validator). A change of meaning is a new major format, served beside the old one.
The schema `$id` is served from this repository until HEY serves the schema itself.
