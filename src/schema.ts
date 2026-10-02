import { z } from 'zod';

import { CHAIN_ID } from './chain.js';
import { isValidChecksum } from './checksum.js';
import {
  CONTRACT_TYPES,
  LIMITS,
  MANIFEST_VERSION,
  SCHEMA_ID,
  type ContractType,
} from './constants.js';
import { DEAD_ADDRESS, isAddress, isTxHash, ZERO_ADDRESS } from './evm.js';
import type { ManifestIssueCode } from './issues.js';
import { findDuplicates } from './duplicates.js';
import type { HeyProjectContract, HeyProjectManifest } from './types.js';
import { checkAuthoredUrl, checkRepositoryUrl, checkXProfileUrl } from './url.js';

/**
 * The zod runtime schema. Each refinement carries its stable issue code in
 * `params.code`, which `validateManifest` turns into a `ManifestIssue`.
 * Output is the normalised manifest.
 */

type Checked<T> = { ok: true; value: T } | { ok: false; code: ManifestIssueCode; message: string };

const coded = <T>(check: (value: string) => Checked<T>) =>
  z.string().transform((value, ctx): T => {
    const result = check(value);
    if (!result.ok) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: result.message,
        params: { code: result.code },
      });
      return z.NEVER;
    }
    return result.value;
  });

// Control characters, zero-width characters and bidirectional overrides.
// eslint-disable-next-line no-control-regex
const UNSAFE_TEXT_RE = /[\x00-\x1f\x7f-\x9f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/;

const text = (max: number) =>
  coded<string>((value) => {
    if (value.trim() === '')
      return { ok: false, code: 'invalid_text', message: 'Must not be empty.' };
    if (value.trim() !== value) {
      return { ok: false, code: 'invalid_text', message: 'Must not start or end with whitespace.' };
    }
    if ([...value].length > max) {
      return { ok: false, code: 'invalid_text', message: `Must be at most ${max} characters.` };
    }
    if (UNSAFE_TEXT_RE.test(value)) {
      return {
        ok: false,
        code: 'invalid_text',
        message: 'Must not contain control, zero-width or bidirectional-override characters.',
      };
    }
    return { ok: true, value };
  });

const httpsUrl = coded<string>((value) => {
  const result = checkAuthoredUrl(value);
  return result.ok ? { ok: true, value: result.url } : result;
});

const repositoryUrl = coded<string>((value) => {
  const result = checkRepositoryUrl(value);
  return result.ok ? { ok: true, value: result.url } : result;
});

const xProfileUrl = coded<string>((value) => {
  const result = checkXProfileUrl(value);
  return result.ok ? { ok: true, value: result.url } : result;
});

/** An authored address: `0x` + 40 hex, EIP-55 when mixed-case. Normalised to lowercase. */
export const checkAddress = (value: string): Checked<string> => {
  if (!isAddress(value)) {
    return {
      ok: false,
      code: 'invalid_address',
      message: /^0X/.test(value)
        ? 'Addresses start with a lowercase "0x".'
        : 'Expected an EVM address: "0x" followed by 40 hexadecimal characters.',
    };
  }
  if (!isValidChecksum(value)) {
    return {
      ok: false,
      code: 'invalid_checksum',
      message:
        'This mixed-case address fails its EIP-55 checksum. Write it in lowercase or with the correct checksum.',
    };
  }
  return { ok: true, value: value.toLowerCase() };
};

const contractAddress = coded<string>((value) => {
  const result = checkAddress(value);
  if (!result.ok) return result;
  if (result.value === ZERO_ADDRESS || result.value === DEAD_ADDRESS) {
    return {
      ok: false,
      code: 'not_a_contract_identity',
      message: 'The zero and dead addresses are never a contract identity.',
    };
  }
  return result;
});

const deployer = coded<string>((value) => {
  const result = checkAddress(value);
  if (!result.ok) return result;
  if (result.value === ZERO_ADDRESS || result.value === DEAD_ADDRESS) {
    return {
      ok: false,
      code: 'invalid_address',
      message: 'The zero and dead addresses cannot deploy a contract.',
    };
  }
  return result;
});

const txHash = coded<string>((value) =>
  isTxHash(value)
    ? { ok: true, value: value.toLowerCase() }
    : {
        ok: false,
        code: 'invalid_tx_hash',
        message: 'Expected a transaction hash: "0x" followed by 64 hexadecimal characters.',
      },
);

const commit = coded<string>((value) =>
  /^([0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/.test(value)
    ? { ok: true, value: value.toLowerCase() }
    : {
        ok: false,
        code: 'invalid_commit',
        message:
          'Expected a full git commit id: 40 (SHA-1) or 64 (SHA-256) hexadecimal characters.',
      },
);

export const RELEASE_RE = /^[A-Za-z0-9][A-Za-z0-9._+/-]*$/;

const release = coded<string>((value) =>
  value.length <= LIMITS.maxReleaseLength && RELEASE_RE.test(value) && !value.includes('..')
    ? { ok: true, value }
    : {
        ok: false,
        code: 'invalid_release',
        message: `Expected a release tag or version (letters, digits, ".", "_", "+", "-", "/"; at most ${LIMITS.maxReleaseLength} characters).`,
      },
);

const contractType = coded<ContractType>((value) =>
  (CONTRACT_TYPES as readonly string[]).includes(value)
    ? { ok: true, value: value as ContractType }
    : {
        ok: false,
        code: 'invalid_contract_type',
        message: `Contract type must be one of: ${CONTRACT_TYPES.join(', ')}.`,
      },
);

const version = z.unknown().transform((value, ctx): 1 => {
  if (value !== MANIFEST_VERSION) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        value === undefined
          ? 'version is required.'
          : `Unsupported manifest version ${JSON.stringify(value)}; this package reads version 1.`,
      params: { code: value === undefined ? 'missing_field' : 'unsupported_version' },
    });
    return z.NEVER;
  }
  return MANIFEST_VERSION;
});

const chainId = z.unknown().transform((value, ctx): 4663 => {
  if (value !== CHAIN_ID) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        value === undefined
          ? 'chainId is required (4663, Robinhood Chain).'
          : `HEY supports Robinhood Chain (4663) only; chain ${JSON.stringify(value)} is not supported.`,
      params: { code: value === undefined ? 'missing_field' : 'unsupported_chain' },
    });
    return z.NEVER;
  }
  return CHAIN_ID;
});

const schemaReference = coded<typeof SCHEMA_ID>((value) =>
  value === SCHEMA_ID
    ? { ok: true, value: SCHEMA_ID }
    : {
        ok: false,
        code: 'invalid_schema_reference',
        message: `$schema, when present, must be ${SCHEMA_ID}.`,
      },
);

export const contractSchema: z.ZodType<HeyProjectContract, z.ZodTypeDef, unknown> = z
  .object({
    address: contractAddress,
    type: contractType,
    name: text(LIMITS.maxContractNameLength).optional(),
    deployer: deployer.optional(),
    deploymentTx: txHash.optional(),
  })
  .strict();

/** Every rule that concerns one field at a time. Duplicates are checked across fields. */
export const manifestFieldsSchema = z
  .object({
    $schema: schemaReference.optional(),
    version,
    name: text(LIMITS.maxNameLength),
    website: httpsUrl,
    chainId,
    repositories: z.array(repositoryUrl).max(LIMITS.maxRepositories).optional(),
    contracts: z.array(contractSchema).max(LIMITS.maxContracts).optional(),
    documentation: httpsUrl.optional(),
    changelog: httpsUrl.optional(),
    feed: httpsUrl.optional(),
    officialX: xProfileUrl.optional(),
    logo: httpsUrl.optional(),
    release: release.optional(),
    commit: commit.optional(),
  })
  .strict();

/**
 * The complete v1 rule set as one zod schema, duplicates included: what
 * `validateManifest` applies, for callers who compose zod schemas. Its output
 * is the normalised manifest.
 */
export const heyProjectManifestSchema: z.ZodType<HeyProjectManifest, z.ZodTypeDef, unknown> =
  manifestFieldsSchema.superRefine((value, ctx) => {
    for (const found of findDuplicates(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: found.path,
        message: found.message,
        params: { code: found.code },
      });
    }
  });
