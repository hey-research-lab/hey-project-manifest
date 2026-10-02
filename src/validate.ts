import type { z } from 'zod';

import { DECLARATION_STATE, LIMITS } from './constants.js';
import { findDuplicates } from './duplicates.js';
import { issue, isManifestIssueCode, type ManifestIssue } from './issues.js';
import { isRollingTag } from './rolling-tag.js';
import { manifestFieldsSchema, RELEASE_RE } from './schema.js';
import type { HeyProjectManifest, ManifestValidation } from './types.js';
import { describe } from './text.js';
import { checkAuthoredUrl, comparableHost } from './url.js';

export type ValidateOptions = {
  /**
   * The host the manifest was read from. When set, a `website` on another
   * host raises `website_host_mismatch` (a warning: the manifest may describe
   * a project whose site lives elsewhere, but the declaration is then weaker).
   */
  expectedHost?: string;
};

/** Keys that could reach an object's prototype if a consumer merged the document carelessly. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

type Node = { value: unknown; key: string | number | null; parent: Node | null };

const pathOf = (node: Node): (string | number)[] => {
  const path: (string | number)[] = [];
  for (let current: Node | null = node; current && current.key !== null; current = current.parent) {
    path.unshift(current.key);
  }
  return path;
};

function findForbiddenKeys(root: unknown): ManifestIssue[] {
  const found: ManifestIssue[] = [];
  // Iterative with parent links, so a deeply nested document costs linear time and no stack.
  const stack: Node[] = [{ value: root, key: null, parent: null }];
  while (stack.length > 0) {
    const node = stack.pop() as Node;
    const { value } = node;
    if (value === null || typeof value !== 'object') continue;
    if (Array.isArray(value)) {
      value.forEach((item, index) => stack.push({ value: item, key: index, parent: node }));
      continue;
    }
    for (const key of Object.keys(value)) {
      const child: Node = { value: (value as Record<string, unknown>)[key], key, parent: node };
      if (FORBIDDEN_KEYS.has(key)) {
        found.push(issue('forbidden_key', pathOf(child), `The key "${key}" is not allowed.`));
        continue;
      }
      stack.push(child);
    }
  }
  return found;
}

const CHAIN_LIKE_KEYS = new Set(['chains', 'chain', 'network', 'networks', 'rpc', 'rpcUrl']);

function fromZodIssue(zodIssue: z.ZodIssue): ManifestIssue[] {
  const path = zodIssue.path;
  switch (zodIssue.code) {
    case 'custom': {
      const code: unknown = zodIssue.params?.code;
      return [issue(isManifestIssueCode(code) ? code : 'invalid_type', path, zodIssue.message)];
    }
    case 'invalid_type':
      if (path.length === 0) {
        return [issue('not_an_object', path, 'A manifest is a JSON object.')];
      }
      if (zodIssue.received === 'undefined') {
        return [issue('missing_field', path, `${String(path[path.length - 1])} is required.`)];
      }
      return [
        issue(
          'invalid_type',
          path,
          `Expected ${zodIssue.expected}, received ${zodIssue.received}.`,
        ),
      ];
    case 'unrecognized_keys':
      return zodIssue.keys.map((key) =>
        issue(
          'unknown_field',
          [...path, key],
          CHAIN_LIKE_KEYS.has(key) && path.length === 0
            ? `${describe(key)} is not part of v1: a manifest declares Robinhood Chain (chainId 4663) only.`
            : `${describe(key)} is not a v1 manifest field.`,
        ),
      );
    case 'too_big':
      return [
        zodIssue.type === 'array'
          ? issue('too_many_items', path, `At most ${String(zodIssue.maximum)} items.`)
          : issue('invalid_text', path, zodIssue.message),
      ];
    default:
      return [issue('invalid_type', path, zodIssue.message)];
  }
}

function warnings(value: unknown, options: ValidateOptions): ManifestIssue[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return [];
  const raw = value as Record<string, unknown>;
  const found: ManifestIssue[] = [];

  if (
    typeof raw.release === 'string' &&
    RELEASE_RE.test(raw.release) &&
    isRollingTag(raw.release)
  ) {
    found.push(
      issue(
        'rolling_release_tag',
        ['release'],
        `"${raw.release}" is a rolling or automated tag; HEY never counts one as a release. Name a fixed version.`,
      ),
    );
  }

  const isEmpty = (list: unknown) => !Array.isArray(list) || list.length === 0;
  if (isEmpty(raw.contracts) && isEmpty(raw.repositories)) {
    found.push(
      issue(
        'nothing_to_corroborate',
        [],
        'The manifest declares no contracts and no repositories, so there is nothing for HEY to corroborate.',
      ),
    );
  }

  if (options.expectedHost !== undefined && typeof raw.website === 'string') {
    const website = checkAuthoredUrl(raw.website);
    if (website.ok && comparableHost(website.hostname) !== comparableHost(options.expectedHost)) {
      found.push(
        issue(
          'website_host_mismatch',
          ['website'],
          `The manifest was read from ${comparableHost(options.expectedHost)} but declares the website ${website.hostname}.`,
        ),
      );
    }
  }
  return found;
}

function result(issues: ManifestIssue[], manifest?: HeyProjectManifest): ManifestValidation {
  const errorCount = issues.filter((found) => found.severity === 'error').length;
  const valid = errorCount === 0 && manifest !== undefined;
  return {
    valid,
    declarationState: DECLARATION_STATE,
    verified: false,
    ...(valid ? { manifest } : {}),
    issues,
    errorCount,
    warningCount: issues.length - errorCount,
  };
}

/**
 * Validate an already-parsed value against every v1 rule. Never throws.
 * Returns every issue found (errors and warnings) and, when there is no
 * error, the normalised manifest.
 */
export function validateManifest(
  value: unknown,
  options: ValidateOptions = {},
): ManifestValidation {
  const forbidden = findForbiddenKeys(value);
  if (forbidden.length > 0) return result(forbidden);

  const parsed = manifestFieldsSchema.safeParse(value);
  const issues: ManifestIssue[] = parsed.success ? [] : parsed.error.issues.flatMap(fromZodIssue);
  issues.push(...findDuplicates(value));
  issues.push(...warnings(value, options));
  return result(issues, parsed.success ? (parsed.data as HeyProjectManifest) : undefined);
}

/** The result for a document over the size limit, without reading it. */
export function tooLargeResult(size: number): ManifestValidation {
  return result([
    issue(
      'too_large',
      [],
      `The manifest is ${size} bytes or more; the limit is ${LIMITS.maxBytes}.`,
    ),
  ]);
}

const utf8 = new TextDecoder('utf-8', { fatal: true });

const byteLength = (text: string): number => new TextEncoder().encode(text).length;

/**
 * Parse manifest text (a string or raw bytes) and validate it. Never throws.
 * Enforces the 256 KB limit before parsing, strips a leading byte-order mark,
 * and reports malformed JSON as `invalid_json`.
 */
export function parseManifest(
  input: string | Uint8Array,
  options: ValidateOptions = {},
): ManifestValidation {
  const size = typeof input === 'string' ? byteLength(input) : input.byteLength;
  if (size > LIMITS.maxBytes) {
    return tooLargeResult(size);
  }
  let text: string;
  if (typeof input === 'string') {
    text = input;
  } else {
    try {
      text = utf8.decode(input);
    } catch {
      return result([issue('invalid_json', [], 'The manifest is not valid UTF-8.')]);
    }
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 200) : 'parse error';
    return result([issue('invalid_json', [], `The manifest is not valid JSON: ${detail}`)]);
  }
  return validateManifest(value, options);
}
