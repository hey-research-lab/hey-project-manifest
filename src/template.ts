import { CHAIN_ID } from './chain.js';
import { MANIFEST_VERSION, SCHEMA_ID, type ContractType } from './constants.js';

export type TemplateInput = {
  name?: string;
  website?: string;
  repositories?: string[];
  contracts?: { address: string; type: ContractType | string; name?: string }[];
  documentation?: string;
  changelog?: string;
  feed?: string;
  officialX?: string;
  logo?: string;
  release?: string;
  commit?: string;
};

/** Placeholders `init` writes when no name or website is given. Replace them before publishing. */
export const TEMPLATE_PLACEHOLDERS = {
  name: 'Example Project',
  website: 'https://example.com',
} as const;

/**
 * A manifest document in the field order the format documents, with only the
 * fields given. The result still has to pass `validateManifest`; `init` checks
 * it before writing.
 */
export function createManifestTemplate(input: TemplateInput = {}): Record<string, unknown> {
  const doc: Record<string, unknown> = {
    $schema: SCHEMA_ID,
    version: MANIFEST_VERSION,
    name: input.name ?? TEMPLATE_PLACEHOLDERS.name,
    website: input.website ?? TEMPLATE_PLACEHOLDERS.website,
    chainId: CHAIN_ID,
  };
  if (input.repositories && input.repositories.length > 0) doc.repositories = input.repositories;
  if (input.contracts && input.contracts.length > 0) {
    doc.contracts = input.contracts.map((contract) => ({
      address: contract.address,
      type: contract.type,
      ...(contract.name !== undefined ? { name: contract.name } : {}),
    }));
  }
  for (const key of [
    'documentation',
    'changelog',
    'feed',
    'officialX',
    'logo',
    'release',
    'commit',
  ] as const) {
    const value = input[key];
    if (value !== undefined) doc[key] = value;
  }
  return doc;
}
