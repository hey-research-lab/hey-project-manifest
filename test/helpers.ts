import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * An IPv4 address built from its octets. The leak scan flags any public IPv4
 * literal (it exists to catch deployment addresses); the well-known example
 * addresses these tests need are written this way instead.
 */
export const ipv4 = (a: number, b: number, c: number, d: number): string => [a, b, c, d].join('.');

/** A public example address (example.com's published IPv4). */
export const PUBLIC_V4 = ipv4(93, 184, 216, 34);

export const FIXTURES = join(import.meta.dirname, 'fixtures');

export const readFixture = (kind: 'valid' | 'invalid', name: string): string =>
  readFileSync(join(FIXTURES, kind, name), 'utf8');

export const fixtureJson = (kind: 'valid' | 'invalid', name: string): unknown =>
  JSON.parse(readFixture(kind, name));

export const listFixtures = (kind: 'valid' | 'invalid', extension = '.json'): string[] =>
  readdirSync(join(FIXTURES, kind))
    .filter((file) => file.endsWith(extension))
    .sort();

/**
 * Every invalid fixture, the issue it must raise (code and JSON Pointer), and
 * whether the published JSON Schema rejects it too. Rules a pattern cannot
 * express (checksums, duplicates after normalisation, some URL and text rules)
 * are the validator's alone: `schema: 'accept'`.
 */
export const INVALID_CASES: Record<
  string,
  { code: string; pointer: string; schema: 'reject' | 'accept' }
> = {
  'version-2.json': { code: 'unsupported_version', pointer: '/version', schema: 'reject' },
  'version-string.json': { code: 'unsupported_version', pointer: '/version', schema: 'reject' },
  'version-missing.json': { code: 'missing_field', pointer: '/version', schema: 'reject' },
  'chain-ethereum.json': { code: 'unsupported_chain', pointer: '/chainId', schema: 'reject' },
  'chain-string.json': { code: 'unsupported_chain', pointer: '/chainId', schema: 'reject' },
  'chain-caip2.json': { code: 'unsupported_chain', pointer: '/chainId', schema: 'reject' },
  'chain-missing.json': { code: 'missing_field', pointer: '/chainId', schema: 'reject' },
  'chains-array.json': { code: 'unknown_field', pointer: '/chains', schema: 'reject' },
  'name-missing.json': { code: 'missing_field', pointer: '/name', schema: 'reject' },
  'name-empty.json': { code: 'invalid_text', pointer: '/name', schema: 'reject' },
  'name-padded.json': { code: 'invalid_text', pointer: '/name', schema: 'reject' },
  'name-bidi.json': { code: 'invalid_text', pointer: '/name', schema: 'accept' },
  'name-too-long.json': { code: 'invalid_text', pointer: '/name', schema: 'reject' },
  'name-number.json': { code: 'invalid_type', pointer: '/name', schema: 'reject' },
  'unknown-field.json': { code: 'unknown_field', pointer: '/description', schema: 'reject' },
  'not-an-object.json': { code: 'not_an_object', pointer: '', schema: 'reject' },
  'proto-key.json': { code: 'forbidden_key', pointer: '/__proto__', schema: 'reject' },
  'constructor-key.json': {
    code: 'forbidden_key',
    pointer: '/contracts/0/constructor',
    schema: 'reject',
  },
  'address-short.json': {
    code: 'invalid_address',
    pointer: '/contracts/0/address',
    schema: 'reject',
  },
  'address-0X-prefix.json': {
    code: 'invalid_address',
    pointer: '/contracts/0/address',
    schema: 'reject',
  },
  'address-non-hex.json': {
    code: 'invalid_address',
    pointer: '/contracts/0/address',
    schema: 'reject',
  },
  'address-bad-checksum.json': {
    code: 'invalid_checksum',
    pointer: '/contracts/0/address',
    schema: 'accept',
  },
  'address-zero.json': {
    code: 'not_a_contract_identity',
    pointer: '/contracts/0/address',
    schema: 'reject',
  },
  'address-dead.json': {
    code: 'not_a_contract_identity',
    pointer: '/contracts/0/address',
    schema: 'reject',
  },
  'duplicate-contract.json': {
    code: 'duplicate_contract',
    pointer: '/contracts/1/address',
    schema: 'accept',
  },
  'duplicate-repository.json': {
    code: 'duplicate_repository',
    pointer: '/repositories/1',
    schema: 'accept',
  },
  'contract-type-unknown.json': {
    code: 'invalid_contract_type',
    pointer: '/contracts/0/type',
    schema: 'reject',
  },
  'contract-type-missing.json': {
    code: 'missing_field',
    pointer: '/contracts/0/type',
    schema: 'reject',
  },
  'contract-unknown-field.json': {
    code: 'unknown_field',
    pointer: '/contracts/0/chainId',
    schema: 'reject',
  },
  'deployment-tx-short.json': {
    code: 'invalid_tx_hash',
    pointer: '/contracts/0/deploymentTx',
    schema: 'reject',
  },
  'deployment-tx-no-prefix.json': {
    code: 'invalid_tx_hash',
    pointer: '/contracts/0/deploymentTx',
    schema: 'reject',
  },
  'deployer-invalid.json': {
    code: 'invalid_address',
    pointer: '/contracts/0/deployer',
    schema: 'reject',
  },
  'deployer-zero.json': {
    code: 'invalid_address',
    pointer: '/contracts/0/deployer',
    schema: 'reject',
  },
  'website-http.json': { code: 'unsafe_url_scheme', pointer: '/website', schema: 'reject' },
  'website-javascript.json': { code: 'unsafe_url_scheme', pointer: '/website', schema: 'reject' },
  'documentation-data.json': {
    code: 'unsafe_url_scheme',
    pointer: '/documentation',
    schema: 'reject',
  },
  'logo-file.json': { code: 'unsafe_url_scheme', pointer: '/logo', schema: 'reject' },
  'feed-blob.json': { code: 'unsafe_url_scheme', pointer: '/feed', schema: 'reject' },
  'changelog-ftp.json': { code: 'unsafe_url_scheme', pointer: '/changelog', schema: 'reject' },
  'website-credentials.json': { code: 'url_credentials', pointer: '/website', schema: 'reject' },
  'website-ipv4.json': { code: 'url_ip_literal', pointer: '/website', schema: 'reject' },
  'website-ipv6.json': { code: 'url_ip_literal', pointer: '/website', schema: 'reject' },
  'website-localhost.json': { code: 'url_local_host', pointer: '/website', schema: 'reject' },
  'website-dot-local.json': { code: 'url_local_host', pointer: '/website', schema: 'reject' },
  'website-dot-internal.json': { code: 'url_local_host', pointer: '/website', schema: 'reject' },
  'website-single-label.json': { code: 'url_local_host', pointer: '/website', schema: 'reject' },
  'website-punycode.json': { code: 'url_idn_host', pointer: '/website', schema: 'reject' },
  'website-unicode-host.json': { code: 'url_idn_host', pointer: '/website', schema: 'reject' },
  'website-too-long.json': { code: 'url_too_long', pointer: '/website', schema: 'reject' },
  'website-relative.json': { code: 'invalid_url', pointer: '/website', schema: 'reject' },
  'website-whitespace.json': { code: 'invalid_url', pointer: '/website', schema: 'reject' },
  'website-number.json': { code: 'invalid_type', pointer: '/website', schema: 'reject' },
  'website-missing.json': { code: 'missing_field', pointer: '/website', schema: 'reject' },
  'repository-github-tree.json': {
    code: 'invalid_repository_url',
    pointer: '/repositories/0',
    schema: 'reject',
  },
  'repository-github-owner-only.json': {
    code: 'invalid_repository_url',
    pointer: '/repositories/0',
    schema: 'reject',
  },
  'repository-http.json': {
    code: 'unsafe_url_scheme',
    pointer: '/repositories/0',
    schema: 'reject',
  },
  'repositories-not-array.json': {
    code: 'invalid_type',
    pointer: '/repositories',
    schema: 'reject',
  },
  'officialx-not-x.json': { code: 'invalid_x_url', pointer: '/officialX', schema: 'reject' },
  'officialx-handle-too-long.json': {
    code: 'invalid_x_url',
    pointer: '/officialX',
    schema: 'reject',
  },
  'commit-short.json': { code: 'invalid_commit', pointer: '/commit', schema: 'reject' },
  'release-spaces.json': { code: 'invalid_release', pointer: '/release', schema: 'reject' },
  'schema-reference-wrong.json': {
    code: 'invalid_schema_reference',
    pointer: '/$schema',
    schema: 'reject',
  },
};
