import { constants as fsConstants } from 'node:fs';
import { lstat, mkdir, open, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { CAIP2, CHAIN_ID, CHAIN_NAME, explorerAddressUrl, explorerTxUrl } from './chain.js';
import { toChecksumAddress } from './checksum.js';
import {
  CLAIM_CHALLENGE_PATH,
  CONTRACT_TYPES,
  LIMITS,
  WELL_KNOWN_PATH,
  type ContractType,
} from './constants.js';
import {
  fetchManifest,
  type FetchErrorCode,
  type FetchManifestOptions,
  type FetchManifestResult,
} from './fetch.js';
import type { ManifestIssue } from './issues.js';
import { createManifestTemplate, TEMPLATE_PLACEHOLDERS, type TemplateInput } from './template.js';
import { stripUnsafe } from './text.js';
import type { HeyProjectManifest, ManifestValidation } from './types.js';
import { parseManifest, tooLargeResult, validateManifest } from './validate.js';
import { VERSION } from './version.js';

/**
 * The `hey-project` command line. `run` takes its arguments and its world
 * (output streams, working directory, remote-read options) so it can be
 * tested without a process or a network.
 */

export const EXIT = {
  ok: 0,
  invalid: 1,
  usage: 2,
  notFound: 4,
  rateLimited: 5,
  network: 6,
} as const;

export type RunIO = {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  cwd: string;
  env: Record<string, string | undefined>;
  /** Options for remote reads (tests inject a transport and resolver). */
  fetchOptions?: FetchManifestOptions;
  now?: () => Date;
};

const DEFAULT_PATHS = ['.well-known/hey-project.json', 'hey-project.json'];

const HELP = `hey-project ${VERSION} — hey-project.json manifests for Robinhood Chain projects

A manifest is a first-party declaration. Declared is not verified: a valid
manifest does not prove ownership, identity or legitimacy.

Usage
  hey-project init [options]            Write a valid manifest template
  hey-project validate [file | https://domain]
  hey-project inspect  [file | https://domain]

With no argument, validate and inspect read ./.well-known/hey-project.json,
then ./hey-project.json. An https:// argument reads
https://<domain>${WELL_KNOWN_PATH} and nothing else.

init options
  --name <text>            Project name
  --website <url>          Project website (https)
  --repository <url>       Source repository (repeatable)
  --contract <addr[:type]> Contract on Robinhood Chain (repeatable; type is one of
                           ${CONTRACT_TYPES.join(', ')}; default other)
  --documentation <url>    --changelog <url>   --feed <url>   --logo <url>
  --x <url>                X profile, https://x.com/<handle>
  --release <tag>          --commit <sha>
  --out <path>             Where to write (default .well-known/hey-project.json)
  --stdout                 Print instead of writing
  --force                  Overwrite an existing file

Common options
  --json       One JSON document on stdout
  --quiet      No output on success
  --no-color   Plain output (output is never coloured)
  --help, -h   This help
  --version    Print the version

Exit codes
  0 valid / written   1 invalid manifest or refused document   2 usage error
  4 no manifest at the URL (404)   5 rate limited (429)   6 network error, timeout or 5xx
`;

// ------------------------------------------------------------------ output

type Envelope = {
  schema: 'hey.cli/v1';
  command: string;
  ok: boolean;
  chain: { name: string; chainId: number; caip2: string };
  data: unknown;
  error: { code: string; message: string; retryable: boolean; status?: number } | null;
  source: Record<string, unknown> | null;
};

const CHAIN = { name: CHAIN_NAME, chainId: CHAIN_ID, caip2: CAIP2 };

class Output {
  constructor(
    private readonly io: RunIO,
    readonly json: boolean,
    readonly quiet: boolean,
  ) {}

  line(text = ''): void {
    if (!this.json && !this.quiet) this.io.stdout(`${stripUnsafe(text)}\n`);
  }

  /** Diagnostics go to stderr, even in quiet mode; never in JSON mode. */
  diag(text: string): void {
    if (!this.json) this.io.stderr(`${stripUnsafe(text)}\n`);
  }

  envelope(envelope: Omit<Envelope, 'schema' | 'chain'>): void {
    if (!this.json) return;
    const full: Envelope = {
      schema: 'hey.cli/v1',
      command: envelope.command,
      ok: envelope.ok,
      chain: CHAIN,
      data: envelope.data,
      error: envelope.error,
      source: envelope.source,
    };
    this.io.stdout(`${JSON.stringify(full, null, 2)}\n`);
  }
}

const usageError = (out: Output, command: string, message: string): number => {
  out.diag(`hey-project: ${message}`);
  if (!out.quiet || out.json) out.diag('Run hey-project --help for usage.');
  out.envelope({
    command,
    ok: false,
    data: null,
    error: { code: 'usage', message, retryable: false },
    source: null,
  });
  return EXIT.usage;
};

// ------------------------------------------------------------- reading input

type Loaded =
  | {
      kind: 'file';
      location: string;
      validation: ManifestValidation;
      source: Record<string, unknown>;
    }
  | {
      kind: 'url';
      location: string;
      result: FetchManifestResult;
      source: Record<string, unknown>;
    }
  | { kind: 'usage'; message: string };

async function readLocal(path: string): Promise<Uint8Array | 'too_large'> {
  const nofollow = fsConstants.O_NOFOLLOW ?? 0;
  const handle = await open(path, fsConstants.O_RDONLY | nofollow);
  try {
    const buffer = new Uint8Array(LIMITS.maxBytes + 1);
    let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await handle.read(buffer, total, buffer.length - total, null);
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    return total > LIMITS.maxBytes ? 'too_large' : buffer.subarray(0, total);
  } finally {
    await handle.close();
  }
}

async function load(target: string | undefined, io: RunIO, now: () => Date): Promise<Loaded> {
  if (target !== undefined && target.includes('://')) {
    const result = await fetchManifest(target, { now, ...io.fetchOptions });
    const source: Record<string, unknown> = {
      kind: 'url',
      url: result.url,
      fetchedAt: result.fetchedAt,
      ...(result.ok
        ? { status: result.status, contentType: result.contentType, bytes: result.bytes }
        : {}),
    };
    return { kind: 'url', location: result.url ?? target, result, source };
  }

  let path: string;
  let shown: string;
  if (target !== undefined) {
    path = resolve(io.cwd, target);
    shown = target;
  } else {
    const found = await firstExisting(io.cwd);
    if (found === undefined) {
      return {
        kind: 'usage',
        message: `no manifest found: looked for ${DEFAULT_PATHS.join(' and ')}. Pass a file or an https:// domain.`,
      };
    }
    path = resolve(io.cwd, found);
    shown = found;
  }

  let stat;
  try {
    stat = await lstat(path);
  } catch {
    return { kind: 'usage', message: `cannot read ${shown}: no such file.` };
  }
  if (stat.isSymbolicLink()) {
    return { kind: 'usage', message: `refusing to follow the symbolic link ${shown}.` };
  }
  if (!stat.isFile()) return { kind: 'usage', message: `${shown} is not a file.` };

  let bytes: Uint8Array | 'too_large';
  try {
    bytes = await readLocal(path);
  } catch {
    return { kind: 'usage', message: `cannot read ${shown}.` };
  }
  const validation = bytes === 'too_large' ? tooLargeResult(stat.size) : parseManifest(bytes);
  return {
    kind: 'file',
    location: shown,
    validation,
    source: { kind: 'file', path: shown, readAt: now().toISOString() },
  };
}

async function firstExisting(cwd: string): Promise<string | undefined> {
  for (const candidate of DEFAULT_PATHS) {
    try {
      await lstat(resolve(cwd, candidate));
      return candidate;
    } catch {
      // try the next one
    }
  }
  return undefined;
}

const FETCH_EXIT: Record<FetchErrorCode, number> = {
  invalid_domain: EXIT.usage,
  unsafe_url_scheme: EXIT.usage,
  not_well_known_path: EXIT.usage,
  private_address: EXIT.usage,
  unresolvable_host: EXIT.network,
  redirect_refused: EXIT.invalid,
  not_found: EXIT.notFound,
  rate_limited: EXIT.rateLimited,
  http_error: EXIT.invalid,
  too_large: EXIT.invalid,
  timeout: EXIT.network,
  network_error: EXIT.network,
};

/** Shared by validate and inspect: load, then hand a validation (or a fetch failure) back. */
async function withManifest(
  command: string,
  target: string | undefined,
  out: Output,
  io: RunIO,
  now: () => Date,
  render: (validation: ManifestValidation, location: string, loaded: Loaded) => void,
): Promise<number> {
  const loaded = await load(target, io, now);
  if (loaded.kind === 'usage') return usageError(out, command, loaded.message);

  if (loaded.kind === 'url' && !loaded.result.ok) {
    const { error } = loaded.result;
    out.diag(`hey-project: ${loaded.location}: ${error.message}`);
    out.envelope({ command, ok: false, data: null, error, source: loaded.source });
    const code = FETCH_EXIT[error.code];
    if (error.code === 'http_error' && error.retryable) return EXIT.network;
    return code;
  }

  const validation = loaded.kind === 'url' && loaded.result.ok ? loaded.result.validation : null;
  const result = loaded.kind === 'file' ? loaded.validation : (validation as ManifestValidation);
  render(result, loaded.location, loaded);
  out.envelope({
    command,
    ok: result.valid,
    data: result,
    error: result.valid
      ? null
      : {
          code: 'invalid_manifest',
          message: `${result.errorCount} error(s) in the manifest.`,
          retryable: false,
        },
    source: loaded.source,
  });
  return result.valid ? EXIT.ok : EXIT.invalid;
}

const formatIssue = (found: ManifestIssue): string =>
  `  ${found.severity.padEnd(7)} ${found.code}  ${found.pointer || '(document)'}  ${found.message}`;

function printIssues(out: Output, issues: ManifestIssue[]): void {
  for (const found of issues) {
    if (found.severity === 'error') out.diag(formatIssue(found));
    else out.line(formatIssue(found));
  }
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

const DECLARED_LINE =
  'Declared, not verified: HEY treats this as a first-party declaration and corroborates it independently.';

// ------------------------------------------------------------------ commands

async function validateCommand(
  target: string | undefined,
  out: Output,
  io: RunIO,
  now: () => Date,
): Promise<number> {
  return withManifest('validate', target, out, io, now, (result, location) => {
    if (result.valid) {
      out.line(`${location}: valid manifest (declared, not verified)`);
      out.line(
        `  ${plural(result.errorCount, 'error')}, ${plural(result.warningCount, 'warning')}`,
      );
    } else {
      out.diag(`${location}: invalid manifest`);
      out.diag(
        `  ${plural(result.errorCount, 'error')}, ${plural(result.warningCount, 'warning')}`,
      );
    }
    printIssues(out, result.issues);
  });
}

function printManifest(out: Output, manifest: HeyProjectManifest): void {
  out.line(manifest.name);
  out.line(`  ${DECLARED_LINE}`);
  out.line(`  Chain        ${CHAIN_NAME} (${CHAIN_ID}, ${CAIP2})`);
  out.line(`  Website      ${manifest.website}`);
  const contracts = manifest.contracts ?? [];
  out.line();
  out.line(`Contracts (${contracts.length})`);
  if (contracts.length === 0) out.line('  none declared in this manifest');
  for (const contract of contracts) {
    const label = contract.name !== undefined ? `  ${contract.name}` : '';
    out.line(`  ${contract.type.padEnd(9)}${toChecksumAddress(contract.address)}${label}`);
    out.line(`           ${explorerAddressUrl(contract.address)}`);
    if (contract.deployer !== undefined) {
      out.line(`           deployer (declared)    ${toChecksumAddress(contract.deployer)}`);
    }
    if (contract.deploymentTx !== undefined) {
      out.line(`           deployment (declared)  ${explorerTxUrl(contract.deploymentTx)}`);
    }
  }
  const repositories = manifest.repositories ?? [];
  out.line();
  out.line(`Repositories (${repositories.length})`);
  if (repositories.length === 0) out.line('  none declared in this manifest');
  for (const repository of repositories) out.line(`  ${repository}`);

  const links: [string, string | undefined][] = [
    ['documentation', manifest.documentation],
    ['changelog', manifest.changelog],
    ['feed', manifest.feed],
    ['X', manifest.officialX],
    ['logo', manifest.logo],
    ['release', manifest.release],
    ['commit', manifest.commit],
  ];
  const present = links.filter(([, value]) => value !== undefined);
  if (present.length > 0) {
    out.line();
    out.line('Also declared');
    for (const [label, value] of present) out.line(`  ${label.padEnd(14)}${value as string}`);
  }
}

async function inspectCommand(
  target: string | undefined,
  out: Output,
  io: RunIO,
  now: () => Date,
): Promise<number> {
  return withManifest('inspect', target, out, io, now, (result, location, loaded) => {
    if (loaded.kind === 'url' && loaded.result.ok) {
      out.line(`Read ${loaded.result.url} at ${loaded.result.fetchedAt}`);
    } else {
      out.line(`Read ${location}`);
    }
    out.line();
    if (result.manifest) {
      printManifest(out, result.manifest);
    } else {
      out.diag('The manifest is invalid; nothing it declares is shown.');
    }
    if (result.issues.length > 0) {
      out.line();
      out.line(
        `Issues (${plural(result.errorCount, 'error')}, ${plural(result.warningCount, 'warning')})`,
      );
      printIssues(out, result.issues);
    }
    out.line();
    out.line(
      `Not the claim file: ${CLAIM_CHALLENGE_PATH} is HEY's ownership-claim challenge, a different mechanism.`,
    );
  });
}

type InitValues = {
  name?: string;
  website?: string;
  repository?: string[];
  contract?: string[];
  documentation?: string;
  changelog?: string;
  feed?: string;
  x?: string;
  logo?: string;
  release?: string;
  commit?: string;
  out?: string;
  stdout?: boolean;
  force?: boolean;
};

function parseContract(value: string): { address: string; type: ContractType | string } {
  const [address = '', type] = value.split(':');
  return {
    address: address.startsWith('0X') ? `0x${address.slice(2)}` : address,
    type: type ?? 'other',
  };
}

async function writeExclusive(
  path: string,
  text: string,
  force: boolean,
): Promise<'exists' | 'symlink' | 'ok'> {
  let existing;
  try {
    existing = await lstat(path);
  } catch {
    existing = undefined;
  }
  if (existing?.isSymbolicLink()) return 'symlink';
  if (existing && !force) return 'exists';
  await mkdir(dirname(path), { recursive: true });
  if (!existing) {
    // Exclusive create: never clobbers a file that appeared in the meantime.
    await writeFile(path, text, { flag: 'wx', mode: 0o644 });
    return 'ok';
  }
  // Overwrite through a temporary file and a rename, which replaces the entry itself.
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, text, { flag: 'wx', mode: 0o644 });
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  return 'ok';
}

async function initCommand(values: InitValues, out: Output, io: RunIO): Promise<number> {
  const input: TemplateInput = {
    ...(values.name !== undefined ? { name: values.name } : {}),
    ...(values.website !== undefined ? { website: values.website } : {}),
    ...(values.repository ? { repositories: values.repository } : {}),
    ...(values.contract ? { contracts: values.contract.map(parseContract) } : {}),
    ...(values.documentation !== undefined ? { documentation: values.documentation } : {}),
    ...(values.changelog !== undefined ? { changelog: values.changelog } : {}),
    ...(values.feed !== undefined ? { feed: values.feed } : {}),
    ...(values.x !== undefined ? { officialX: values.x } : {}),
    ...(values.logo !== undefined ? { logo: values.logo } : {}),
    ...(values.release !== undefined ? { release: values.release } : {}),
    ...(values.commit !== undefined ? { commit: values.commit } : {}),
  };
  const document = createManifestTemplate(input);
  const validation = validateManifest(document);
  if (!validation.valid || !validation.manifest) {
    out.diag('hey-project: the values given do not make a valid manifest:');
    printIssues(
      out,
      validation.issues.filter((found) => found.severity === 'error'),
    );
    out.envelope({
      command: 'init',
      ok: false,
      data: validation,
      error: { code: 'usage', message: 'invalid init values', retryable: false },
      source: null,
    });
    return EXIT.usage;
  }
  // Write the normalised form: lowercase addresses, canonical repository URLs.
  const text = `${JSON.stringify(validation.manifest, null, 2)}\n`;

  if (values.stdout) {
    if (out.json) {
      out.envelope({
        command: 'init',
        ok: true,
        data: { manifest: validation.manifest, written: null },
        error: null,
        source: null,
      });
    } else {
      io.stdout(text);
    }
    return EXIT.ok;
  }

  const relative = values.out ?? DEFAULT_PATHS[0];
  const path = resolve(io.cwd, relative as string);
  let written;
  try {
    written = await writeExclusive(path, text, values.force === true);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return usageError(
      out,
      'init',
      code === 'EEXIST'
        ? `${relative} already exists; pass --force to overwrite it.`
        : `cannot write ${relative}.`,
    );
  }
  if (written === 'symlink') {
    return usageError(out, 'init', `refusing to write through the symbolic link ${relative}.`);
  }
  if (written === 'exists') {
    return usageError(out, 'init', `${relative} already exists; pass --force to overwrite it.`);
  }

  const placeholders =
    values.name === undefined || values.website === undefined
      ? `Replace the placeholder ${[
          values.name === undefined ? `name ("${TEMPLATE_PLACEHOLDERS.name}")` : '',
          values.website === undefined ? `website (${TEMPLATE_PLACEHOLDERS.website})` : '',
        ]
          .filter(Boolean)
          .join(' and ')} before publishing.`
      : null;
  out.line(`Wrote ${relative}`);
  out.line(`Publish it at https://<your domain>${WELL_KNOWN_PATH}.`);
  if (placeholders) out.diag(placeholders);
  out.line(
    'A manifest is a declaration: HEY corroborates it independently and it never proves ownership.',
  );
  out.envelope({
    command: 'init',
    ok: true,
    data: { manifest: validation.manifest, written: relative, placeholders: placeholders !== null },
    error: null,
    source: null,
  });
  return EXIT.ok;
}

// ------------------------------------------------------------------ dispatch

export async function run(argv: readonly string[], io: RunIO): Promise<number> {
  const now = io.now ?? (() => new Date());
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        json: { type: 'boolean' },
        quiet: { type: 'boolean', short: 'q' },
        'no-color': { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
        name: { type: 'string' },
        website: { type: 'string' },
        repository: { type: 'string', multiple: true },
        contract: { type: 'string', multiple: true },
        documentation: { type: 'string' },
        changelog: { type: 'string' },
        feed: { type: 'string' },
        x: { type: 'string' },
        logo: { type: 'string' },
        release: { type: 'string' },
        commit: { type: 'string' },
        out: { type: 'string' },
        stdout: { type: 'boolean' },
        force: { type: 'boolean' },
      },
    });
  } catch (error) {
    const json = argv.includes('--json');
    const out = new Output(io, json, false);
    const message = error instanceof Error ? error.message : 'invalid arguments';
    return usageError(out, argv.find((arg) => !arg.startsWith('-')) ?? '', message);
  }

  const { values, positionals } = parsed;
  const out = new Output(io, values.json === true, values.quiet === true);
  const [command, ...rest] = positionals;

  if (values.version) {
    if (out.json) {
      out.envelope({
        command: 'version',
        ok: true,
        data: { version: VERSION },
        error: null,
        source: null,
      });
    } else {
      io.stdout(`${VERSION}\n`);
    }
    return EXIT.ok;
  }
  if (values.help || command === 'help') {
    io.stdout(HELP);
    return EXIT.ok;
  }
  if (command === undefined) {
    if (!out.json) io.stderr(HELP);
    out.envelope({
      command: '',
      ok: false,
      data: null,
      error: { code: 'usage', message: 'no command given', retryable: false },
      source: null,
    });
    return EXIT.usage;
  }

  const initOnly = [
    'name',
    'website',
    'repository',
    'contract',
    'documentation',
    'changelog',
    'feed',
    'x',
    'logo',
    'release',
    'commit',
    'out',
    'stdout',
    'force',
  ] as const;
  if (command !== 'init') {
    const misplaced = initOnly.find((key) => values[key] !== undefined);
    if (misplaced) return usageError(out, command, `--${misplaced} is an init option.`);
  }

  switch (command) {
    case 'init':
      if (rest.length > 0) return usageError(out, command, 'init takes no positional arguments.');
      return initCommand(values, out, io);
    case 'validate':
    case 'inspect': {
      if (rest.length > 1) return usageError(out, command, `${command} takes one file or URL.`);
      const target = rest[0];
      return command === 'validate'
        ? validateCommand(target, out, io, now)
        : inspectCommand(target, out, io, now);
    }
    default:
      return usageError(out, command, `unknown command "${command}".`);
  }
}
