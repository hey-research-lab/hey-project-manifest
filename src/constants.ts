/** The discovery location a project publishes its manifest at, on its own website. */
export const WELL_KNOWN_PATH = '/.well-known/hey-project.json' as const;

/**
 * HEY's ownership-claim challenge file. A different mechanism with a different
 * meaning: a one-time value HEY asks a claimant to publish. A manifest never
 * carries, replaces or answers a claim challenge.
 */
export const CLAIM_CHALLENGE_PATH = '/.well-known/hey-research.txt' as const;

/** The manifest format version this package reads and writes. */
export const MANIFEST_VERSION = 1 as const;

/**
 * The published JSON Schema's `$id`. Served from this repository until HEY
 * serves the schema itself.
 */
export const SCHEMA_ID =
  'https://raw.githubusercontent.com/hey-research-lab/hey-project-manifest/main/schema/hey-project.v1.json' as const;

/** The only state a manifest can have: a first-party declaration, never a verification. */
export const DECLARATION_STATE = 'DECLARED' as const;

/** Every limit the validator and the remote reader enforce. */
export const LIMITS = {
  /** Bytes of manifest text, local or remote. */
  maxBytes: 256 * 1024,
  /** Characters in any URL. */
  maxUrlLength: 500,
  /** Characters in `name`. */
  maxNameLength: 120,
  /** Characters in a contract's `name`. */
  maxContractNameLength: 80,
  /** Characters in `release`. */
  maxReleaseLength: 128,
  maxContracts: 100,
  maxRepositories: 20,
  /** Milliseconds a remote read may take, DNS and body included. */
  timeoutMs: 10_000,
} as const;

/** Contract roles a manifest may declare. A role is the project's own description. */
export const CONTRACT_TYPES = [
  'token',
  'protocol',
  'factory',
  'router',
  'pool',
  'vault',
  'nft',
  'other',
] as const;

export type ContractType = (typeof CONTRACT_TYPES)[number];
