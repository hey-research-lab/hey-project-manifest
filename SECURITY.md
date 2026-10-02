# Security policy

## Reporting a vulnerability

Please report privately through GitHub's "Report a vulnerability" (Security → Advisories) on this
repository, or email hi@heyresearch.xyz with "security" in the subject. Do not open a public issue.
We aim to acknowledge within 3 working days. There is no bug bounty for this repository.

## Scope

This package parses and validates `hey-project.json` manifests, which are untrusted input, and can
read one from a website.

- **Parsing.** Input is capped at 256 KB before `JSON.parse`. Keys `__proto__`, `constructor` and
  `prototype` anywhere in the document are refused (`forbidden_key`) and every object is validated
  strictly (unknown fields are errors). The validator never merges document objects into others,
  never evaluates anything and never throws on any input. Deeply nested input is scanned
  iteratively in linear time. Text and keys that appear in issue messages are escaped, and the CLI
  strips control, zero-width and bidirectional-override characters before printing.
- **URLs inside a manifest are data.** They are checked (`https:` only; no credentials, IP
  literals, local or internationalised hosts; at most 500 characters) and never fetched.
- **Remote reads** (`fetchManifest`, `hey-project validate|inspect https://…`) request exactly one
  URL, `https://<host>/.well-known/hey-project.json`. The host must be a public DNS name (no IP
  literal, port, credentials, `localhost`, `.local`/`.internal`, single-label or punycode name).
  Every address the host resolves to is checked at connect time through the socket's own `lookup`,
  so the connection only opens to an address that passed (private, loopback, link-local, CGNAT,
  benchmarking, documentation, multicast, IPv4-mapped/compatible, NAT64, 6to4 and Teredo ranges
  are refused, IPv4 and IPv6). Any 3xx is a failure and is never followed. The body is capped at
  256 KB (declared length and streamed bytes), the whole read at 10 seconds. No cookies, no
  credentials, no connection reuse.
- **Files.** The CLI refuses to read or write through a symbolic link, reads at most 256 KB + 1
  byte, creates new files exclusively and replaces an existing one (`--force`) by rename. Paths
  come from the person running the command.
- **No child processes**, no shell, no network calls other than the remote read above.

## Handling secrets

This project never needs HEY credentials or any other secret. It reads no environment variables
for credentials and sends none. Never commit a `.env` with values.

## Supported versions

The latest 0.x minor receives fixes.
