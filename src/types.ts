import type { ContractType, DECLARATION_STATE, SCHEMA_ID } from './constants.js';
import type { ManifestIssue } from './issues.js';

/** One contract the project declares on Robinhood Chain. */
export type HeyProjectContract = {
  /** The contract address. Normalised to lowercase. */
  address: string;
  /** The role the project gives the contract. */
  type: ContractType;
  /** A short label for the contract, as the project names it. */
  name?: string;
  /** The address the project says deployed this contract. Normalised to lowercase. */
  deployer?: string;
  /** The transaction the project says created this contract. Normalised to lowercase. */
  deploymentTx?: string;
};

/**
 * A `hey-project.json` manifest, version 1, as this package normalises it:
 * lowercase addresses and hashes, canonical repository URLs, URLs without
 * fragments. Every field is a first-party declaration — never a verification.
 */
export type HeyProjectManifest = {
  /** Optional editor hint; when present it must be the v1 schema's `$id`. */
  $schema?: typeof SCHEMA_ID;
  version: 1;
  name: string;
  website: string;
  /** Robinhood Chain. The only chain a v1 manifest can declare. */
  chainId: 4663;
  repositories?: string[];
  contracts?: HeyProjectContract[];
  documentation?: string;
  changelog?: string;
  /** An RSS, Atom or JSON feed of the project's updates. */
  feed?: string;
  /** The project's X profile, canonicalised to `https://x.com/<handle>`. */
  officialX?: string;
  logo?: string;
  /** The release (tag or version) the declared contracts correspond to. */
  release?: string;
  /** The source commit (40- or 64-hex git object id) the declared contracts correspond to. */
  commit?: string;
};

export type DeclarationState = typeof DECLARATION_STATE;

/**
 * The outcome of validating a manifest. `declarationState` is always
 * `DECLARED` and `verified` is always `false`: a valid manifest is
 * well-formed, not true.
 */
type ManifestValidationBase = {
  declarationState: DeclarationState;
  verified: false;
  issues: ManifestIssue[];
  errorCount: number;
  warningCount: number;
};

/**
 * Narrow on `valid`: `if (result.valid) result.manifest` is typed without a
 * non-null assertion (0.1.1). The JSON shape is unchanged.
 */
export type ManifestValidation =
  | (ManifestValidationBase & {
      valid: true;
      /** The normalised manifest. */
      manifest: HeyProjectManifest;
    })
  | (ManifestValidationBase & { valid: false; manifest?: undefined });
