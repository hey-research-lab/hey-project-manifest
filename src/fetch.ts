import type { LookupFunction } from 'node:net';

import { LIMITS, WELL_KNOWN_PATH } from './constants.js';
import { isPrivateAddress } from './ip.js';
import type { ManifestValidation } from './types.js';
import { checkAuthoredUrl } from './url.js';
import { parseManifest } from './validate.js';
import { VERSION } from './version.js';

/**
 * Reading a manifest from a project's website.
 *
 * The only URL this ever requests is `https://<host>/.well-known/hey-project.json`.
 * It never fetches a URL found inside a manifest (those are data). The host
 * must be a public DNS name; every address it resolves to is checked at
 * connect time, so the socket only ever opens to an address that passed
 * (no DNS-rebinding window). Any redirect is a failure, the body is capped at
 * 256 KB, the whole read at 10 seconds, and no cookies or credentials are
 * sent.
 */

/** Resolves a host name to every address it currently points at. */
export type AddressLookup = (hostname: string) => Promise<string[]>;

export type TransportRequest = {
  url: string;
  headers: Record<string, string>;
  signal: AbortSignal;
  /** Resolve-and-check: the transport must connect only to addresses this returns. */
  resolve: AddressLookup;
};

export type TransportResponse = {
  status: number;
  headers: Record<string, string | undefined>;
  body: AsyncIterable<Uint8Array>;
  /** Release the connection without reading the rest of the body. */
  close: () => void;
};

/** Performs one GET. Swappable so tests and other runtimes can drive the reader. */
export type ManifestTransport = (request: TransportRequest) => Promise<TransportResponse>;

export type FetchErrorCode =
  | 'invalid_domain'
  | 'unsafe_url_scheme'
  | 'not_well_known_path'
  | 'private_address'
  | 'unresolvable_host'
  | 'redirect_refused'
  | 'not_found'
  | 'rate_limited'
  | 'http_error'
  | 'too_large'
  | 'timeout'
  | 'network_error';

export type FetchError = {
  code: FetchErrorCode;
  message: string;
  retryable: boolean;
  status?: number;
};

export type FetchManifestResult =
  | {
      ok: true;
      url: string;
      host: string;
      status: number;
      fetchedAt: string;
      contentType: string | null;
      bytes: number;
      validation: ManifestValidation;
    }
  | {
      ok: false;
      url: string | null;
      host: string | null;
      fetchedAt: string;
      error: FetchError;
    };

export type FetchManifestOptions = {
  /** Milliseconds for the whole read, DNS and body included. At most 10 000. */
  timeoutMs?: number;
  /** Bytes of body accepted. At most 256 KB. */
  maxBytes?: number;
  signal?: AbortSignal;
  /** Host-name resolver; defaults to the system resolver. */
  resolve?: AddressLookup;
  /** The GET itself; defaults to Node's `https` with the connect-time address check. */
  transport?: ManifestTransport;
  now?: () => Date;
};

class GuardError extends Error {
  constructor(
    readonly code: 'private_address' | 'unresolvable_host',
    message: string,
  ) {
    super(message);
  }
}

// --------------------------------------------------------------- the target

export type ManifestTarget =
  { ok: true; host: string; url: string } | { ok: false; error: FetchError };

const targetError = (code: FetchErrorCode, message: string): ManifestTarget => ({
  ok: false,
  error: { code, message, retryable: false },
});

/**
 * Turn what a user typed into the one URL this package may request.
 * Accepts `example.com`, `https://example.com`, `https://example.com/` and
 * `https://example.com/.well-known/hey-project.json`; nothing else.
 */
export function manifestTarget(input: string): ManifestTarget {
  const raw = input.trim();
  let host: string;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) {
    if (!/^https:\/\//i.test(raw)) {
      return targetError(
        'unsafe_url_scheme',
        'Only https:// is read; a manifest is always fetched over https.',
      );
    }
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return targetError('invalid_domain', 'Not a valid URL.');
    }
    if (url.username !== '' || url.password !== '') {
      return targetError('invalid_domain', 'URLs with a username or password are not read.');
    }
    if (url.port !== '') {
      return targetError('invalid_domain', 'Only the standard https port (443) is read.');
    }
    if (url.search !== '' || url.hash !== '') {
      return targetError(
        'not_well_known_path',
        `Only ${WELL_KNOWN_PATH} is read, without a query.`,
      );
    }
    if (url.pathname !== '/' && url.pathname !== WELL_KNOWN_PATH) {
      return targetError(
        'not_well_known_path',
        `Only ${WELL_KNOWN_PATH} is read; pass the site's domain or that exact URL.`,
      );
    }
    host = url.hostname;
  } else {
    if (!/^[A-Za-z0-9.-]+$/.test(raw)) {
      return targetError('invalid_domain', 'Expected a domain such as example.com.');
    }
    host = raw;
  }
  host = host.toLowerCase().replace(/\.$/, '');
  if (
    host.length > 253 ||
    host.split('.').some((label) => label.length === 0 || label.length > 63)
  ) {
    return targetError('invalid_domain', 'Not a valid domain name.');
  }
  const checked = checkAuthoredUrl(`https://${host}/`);
  if (!checked.ok) {
    return targetError('invalid_domain', `${host} is not a public domain name (${checked.code}).`);
  }
  return { ok: true, host: checked.hostname, url: `https://${checked.hostname}${WELL_KNOWN_PATH}` };
}

// ------------------------------------------------------------ resolution

/** Node's resolver: every address, in the order the system returns them. */
export const systemResolve: AddressLookup = async (hostname) => {
  const { lookup } = await import('node:dns/promises');
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
};

/** Resolve, then refuse unless every answer is a public address. */
export function checkedResolver(resolve: AddressLookup): AddressLookup {
  return async (hostname) => {
    let addresses: string[];
    try {
      addresses = await resolve(hostname);
    } catch {
      throw new GuardError('unresolvable_host', `${hostname} does not resolve.`);
    }
    if (addresses.length === 0) {
      throw new GuardError('unresolvable_host', `${hostname} does not resolve.`);
    }
    const offending = addresses.find((address) => isPrivateAddress(address));
    if (offending !== undefined) {
      throw new GuardError(
        'private_address',
        `${hostname} resolves to a private, reserved or local address; it is not read.`,
      );
    }
    return addresses;
  };
}

/**
 * A `lookup` for `node:https` that answers only with checked addresses, so
 * the socket connects to exactly what was validated.
 */
export function guardedLookup(resolve: AddressLookup): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname).then(
      (addresses) => {
        const family = (address: string): 4 | 6 => (address.includes(':') ? 6 : 4);
        const wanted =
          options.family === 4 || options.family === 6
            ? addresses.filter((address) => family(address) === options.family)
            : addresses;
        if (wanted.length === 0) {
          callback(new GuardError('unresolvable_host', `${hostname} does not resolve.`), '', 4);
          return;
        }
        if (options.all) {
          callback(
            null,
            wanted.map((address) => ({ address, family: family(address) })),
          );
          return;
        }
        const first = wanted[0] as string;
        callback(null, first, family(first));
      },
      (error: unknown) => {
        callback(error instanceof Error ? error : new Error(String(error)), '', 4);
      },
    );
  };
}

/** The default transport: one HTTPS GET, no agent reuse, connect-time address check. */
export const nodeHttpsTransport: ManifestTransport = async (request) => {
  const https = await import('node:https');
  return new Promise<TransportResponse>((resolve, reject) => {
    const outgoing = https.request(
      request.url,
      {
        method: 'GET',
        headers: request.headers,
        lookup: guardedLookup(request.resolve),
        agent: false,
        signal: request.signal,
      },
      (response) => {
        const headers: Record<string, string | undefined> = {};
        for (const [name, value] of Object.entries(response.headers)) {
          headers[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
        }
        resolve({
          status: response.statusCode ?? 0,
          headers,
          body: response,
          close: () => response.destroy(),
        });
      },
    );
    outgoing.on('error', reject);
    outgoing.end();
  });
};

// ------------------------------------------------------------------ the read

const failure = (
  target: { url: string | null; host: string | null },
  fetchedAt: string,
  error: FetchError,
): FetchManifestResult => ({ ok: false, ...target, fetchedAt, error });

function errorCodeOf(error: unknown): string | undefined {
  if (error instanceof GuardError) return error.code;
  let current: unknown = error;
  // Node wraps lookup failures; walk `cause` a few levels.
  for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
    if (current instanceof GuardError) return current.code;
    current = (current as Error & { cause?: unknown }).cause;
  }
  return undefined;
}

/**
 * Fetch and validate `https://<domain>/.well-known/hey-project.json`.
 * Never throws: every outcome is a result. `ok: true` means a document was
 * read; whether it is a valid manifest is `validation.valid`.
 */
export async function fetchManifest(
  domain: string,
  options: FetchManifestOptions = {},
): Promise<FetchManifestResult> {
  const now = options.now ?? (() => new Date());
  const fetchedAt = now().toISOString();
  const target = manifestTarget(domain);
  if (!target.ok) return failure({ url: null, host: null }, fetchedAt, target.error);
  const where = { url: target.url, host: target.host };

  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? LIMITS.timeoutMs, 1), LIMITS.timeoutMs);
  const maxBytes = Math.min(Math.max(options.maxBytes ?? LIMITS.maxBytes, 1), LIMITS.maxBytes);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onOuterAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onOuterAbort, { once: true });
  if (options.signal?.aborted) controller.abort();

  const timedOut = (): FetchManifestResult =>
    failure(where, fetchedAt, {
      code: 'timeout',
      message: `No complete answer within ${timeoutMs} ms.`,
      retryable: true,
    });

  try {
    const transport = options.transport ?? nodeHttpsTransport;
    let response: TransportResponse;
    try {
      response = await transport({
        url: target.url,
        headers: {
          accept: 'application/json',
          'user-agent': `hey-project-manifest/${VERSION} (+https://heyresearch.xyz/developers)`,
        },
        signal: controller.signal,
        resolve: checkedResolver(options.resolve ?? systemResolve),
      });
    } catch (error) {
      if (controller.signal.aborted) return timedOut();
      const code = errorCodeOf(error);
      if (code === 'private_address' || code === 'unresolvable_host') {
        return failure(where, fetchedAt, {
          code,
          message: error instanceof Error ? error.message : String(error),
          retryable: code === 'unresolvable_host',
        });
      }
      return failure(where, fetchedAt, {
        code: 'network_error',
        message: `Could not connect to ${target.host}.`,
        retryable: true,
      });
    }

    const { status } = response;
    if (status !== 200) {
      response.close();
      if (status >= 300 && status < 400) {
        return failure(where, fetchedAt, {
          code: 'redirect_refused',
          status,
          message: `The server answered ${status} (a redirect). Redirects are never followed; publish the manifest at ${target.url} itself.`,
          retryable: false,
        });
      }
      if (status === 404 || status === 410) {
        return failure(where, fetchedAt, {
          code: 'not_found',
          status,
          message: `No manifest at ${target.url} (${status}).`,
          retryable: false,
        });
      }
      if (status === 429) {
        return failure(where, fetchedAt, {
          code: 'rate_limited',
          status,
          message: 'The server is rate limiting requests (429).',
          retryable: true,
        });
      }
      return failure(where, fetchedAt, {
        code: 'http_error',
        status,
        message: `The server answered ${status}.`,
        retryable: status >= 500,
      });
    }

    const tooLarge = (): FetchManifestResult =>
      failure(where, fetchedAt, {
        code: 'too_large',
        message: `The manifest is larger than ${maxBytes} bytes.`,
        retryable: false,
      });
    const declared = Number(response.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxBytes) {
      response.close();
      return tooLarge();
    }

    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for await (const chunk of response.body) {
        total += chunk.byteLength;
        if (total > maxBytes) {
          response.close();
          return tooLarge();
        }
        chunks.push(chunk);
      }
    } catch {
      if (controller.signal.aborted) return timedOut();
      return failure(where, fetchedAt, {
        code: 'network_error',
        message: `The connection to ${target.host} failed while reading.`,
        retryable: true,
      });
    }
    if (controller.signal.aborted) return timedOut();

    const body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return {
      ok: true,
      ...where,
      status,
      fetchedAt,
      contentType: response.headers['content-type'] ?? null,
      bytes: total,
      validation: parseManifest(body, { expectedHost: target.host }),
    };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onOuterAbort);
  }
}
