/**
 * Every finding the validator can report, with a stable code.
 *
 * Codes are part of the public contract: tools may switch on them, so they are
 * never renamed within a major version. An `error` makes the manifest invalid;
 * a `warning` is worth fixing but leaves it valid.
 */
export const ISSUE_CODES = {
  // Document
  invalid_json: 'error',
  too_large: 'error',
  not_an_object: 'error',
  forbidden_key: 'error',
  unknown_field: 'error',
  missing_field: 'error',
  invalid_type: 'error',
  invalid_schema_reference: 'error',
  unsupported_version: 'error',
  unsupported_chain: 'error',
  too_many_items: 'error',
  invalid_text: 'error',
  // Identifiers
  invalid_address: 'error',
  invalid_checksum: 'error',
  not_a_contract_identity: 'error',
  invalid_tx_hash: 'error',
  invalid_commit: 'error',
  invalid_release: 'error',
  invalid_contract_type: 'error',
  duplicate_contract: 'error',
  // URLs
  invalid_url: 'error',
  unsafe_url_scheme: 'error',
  url_credentials: 'error',
  url_ip_literal: 'error',
  url_local_host: 'error',
  url_idn_host: 'error',
  url_too_long: 'error',
  invalid_repository_url: 'error',
  duplicate_repository: 'error',
  invalid_x_url: 'error',
  // Warnings
  rolling_release_tag: 'warning',
  nothing_to_corroborate: 'warning',
  website_host_mismatch: 'warning',
} as const;

export type ManifestIssueCode = keyof typeof ISSUE_CODES;
export type IssueSeverity = 'error' | 'warning';

export type ManifestIssue = {
  code: ManifestIssueCode;
  severity: IssueSeverity;
  /** Where in the document, as keys and indexes: `['contracts', 0, 'address']`. */
  path: (string | number)[];
  /** The same location as an RFC 6901 JSON Pointer: `/contracts/0/address`. */
  pointer: string;
  message: string;
};

const escapePointer = (segment: string | number): string =>
  String(segment).replace(/~/g, '~0').replace(/\//g, '~1');

export const toPointer = (path: readonly (string | number)[]): string =>
  path.length === 0 ? '' : `/${path.map(escapePointer).join('/')}`;

export function issue(
  code: ManifestIssueCode,
  path: readonly (string | number)[],
  message: string,
): ManifestIssue {
  return { code, severity: ISSUE_CODES[code], path: [...path], pointer: toPointer(path), message };
}

export const isManifestIssueCode = (value: unknown): value is ManifestIssueCode =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(ISSUE_CODES, value);
