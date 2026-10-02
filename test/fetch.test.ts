import { describe, expect, it, vi } from 'vitest';

import {
  checkedResolver,
  fetchManifest,
  guardedLookup,
  manifestTarget,
  nodeHttpsTransport,
  type AddressLookup,
  type ManifestTransport,
  type TransportRequest,
} from '../src/index.js';
import { PUBLIC_V4, readFixture } from './helpers.js';

const NOW = () => new Date('2026-10-02T12:00:00.000Z');
const PUBLIC: AddressLookup = async () => [PUBLIC_V4];

async function* chunks(...parts: (string | Uint8Array)[]): AsyncIterable<Uint8Array> {
  for (const part of parts) yield typeof part === 'string' ? new TextEncoder().encode(part) : part;
}

/** A transport that answers from a table and records what it was asked. */
function stubTransport(
  answer: (request: TransportRequest) => {
    status: number;
    headers?: Record<string, string>;
    body?: AsyncIterable<Uint8Array>;
  },
) {
  const requests: TransportRequest[] = [];
  const closed = vi.fn();
  const transport: ManifestTransport = async (request) => {
    requests.push(request);
    // The resolver is part of the contract: a transport connects only after it answers.
    await request.resolve(new URL(request.url).hostname);
    const { status, headers = {}, body = chunks() } = answer(request);
    return { status, headers, body, close: closed };
  };
  return { transport, requests, closed };
}

describe('manifestTarget', () => {
  it.each([
    ['example.com', 'https://example.com/.well-known/hey-project.json'],
    ['Example.COM.', 'https://example.com/.well-known/hey-project.json'],
    ['https://example.com', 'https://example.com/.well-known/hey-project.json'],
    ['https://example.com/', 'https://example.com/.well-known/hey-project.json'],
    [
      'https://www.example.com/.well-known/hey-project.json',
      'https://www.example.com/.well-known/hey-project.json',
    ],
  ])('reads %s at %s', (input, url) => {
    expect(manifestTarget(input)).toEqual(expect.objectContaining({ ok: true, url }));
  });

  it.each([
    ['http://example.com', 'unsafe_url_scheme'],
    ['ftp://example.com', 'unsafe_url_scheme'],
    ['file:///etc/passwd', 'unsafe_url_scheme'],
    ['https://example.com/other.json', 'not_well_known_path'],
    ['https://example.com/.well-known/hey-research.txt', 'not_well_known_path'],
    ['https://example.com/.well-known/hey-project.json?x=1', 'not_well_known_path'],
    ['https://example.com:8443/', 'invalid_domain'],
    ['https://user:pw@example.com/', 'invalid_domain'],
    ['localhost', 'invalid_domain'],
    ['https://127.0.0.1', 'invalid_domain'],
    ['https://[::1]', 'invalid_domain'],
    ['192.0.2.1', 'invalid_domain'],
    ['metadata.google.internal', 'invalid_domain'],
    ['xn--80ak6aa92e.com', 'invalid_domain'],
    ['example.com/path', 'invalid_domain'],
    ['exa mple.com', 'invalid_domain'],
    ['intranet', 'invalid_domain'],
    [`${'a'.repeat(64)}.com`, 'invalid_domain'],
  ])('refuses %s with %s', (input, code) => {
    const target = manifestTarget(input);
    expect(target.ok).toBe(false);
    if (!target.ok) expect(target.error.code).toBe(code);
  });
});

describe('fetchManifest', () => {
  it('reads and validates the manifest from the well-known path only', async () => {
    const { transport, requests } = stubTransport(() => ({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: chunks(readFixture('valid', 'full.json')),
    }));
    const result = await fetchManifest('example.com', { transport, resolve: PUBLIC, now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.url).toBe('https://example.com/.well-known/hey-project.json');
    expect(result.fetchedAt).toBe('2026-10-02T12:00:00.000Z');
    expect(result.contentType).toBe('application/json');
    expect(result.validation.valid).toBe(true);
    expect(result.validation.verified).toBe(false);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe('https://example.com/.well-known/hey-project.json');
    expect(requests[0]?.headers).not.toHaveProperty('cookie');
    expect(requests[0]?.headers).not.toHaveProperty('authorization');
  });

  it('warns when the manifest names a website on another host', async () => {
    const { transport } = stubTransport(() => ({
      status: 200,
      body: chunks(readFixture('valid', 'full.json')),
    }));
    const result = await fetchManifest('other.example.org', { transport, resolve: PUBLIC });
    expect(result.ok && result.validation.issues.map((found) => found.code)).toContain(
      'website_host_mismatch',
    );
  });

  it('reports an invalid document as a read that succeeded with an invalid validation', async () => {
    const { transport } = stubTransport(() => ({
      status: 200,
      headers: { 'content-type': 'text/html' },
      body: chunks('<!doctype html><title>App</title>'),
    }));
    const result = await fetchManifest('example.com', { transport, resolve: PUBLIC });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.validation.valid).toBe(false);
      expect(result.validation.issues[0]?.code).toBe('invalid_json');
    }
  });

  it.each([301, 302, 303, 307, 308])(
    'refuses a %s redirect without following it',
    async (status) => {
      const { transport, requests, closed } = stubTransport(() => ({
        status,
        headers: { location: 'http://169.254.169.254/latest/meta-data/' },
      }));
      const result = await fetchManifest('example.com', { transport, resolve: PUBLIC });
      expect(result).toEqual(
        expect.objectContaining({
          ok: false,
          error: expect.objectContaining({ code: 'redirect_refused', status, retryable: false }),
        }),
      );
      expect(requests).toHaveLength(1);
      expect(closed).toHaveBeenCalled();
    },
  );

  it.each([
    [404, 'not_found', false],
    [410, 'not_found', false],
    [429, 'rate_limited', true],
    [403, 'http_error', false],
    [500, 'http_error', true],
    [503, 'http_error', true],
  ])('maps HTTP %s to %s', async (status, code, retryable) => {
    const { transport } = stubTransport(() => ({ status }));
    const result = await fetchManifest('example.com', { transport, resolve: PUBLIC });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatchObject({ code, status, retryable });
  });

  it('refuses a body whose declared length is over the cap without reading it', async () => {
    let read = false;
    const { transport, closed } = stubTransport(() => ({
      status: 200,
      headers: { 'content-length': String(300 * 1024) },
      body: (async function* () {
        read = true;
        yield new Uint8Array(1);
      })(),
    }));
    const result = await fetchManifest('example.com', { transport, resolve: PUBLIC });
    expect(!result.ok && result.error.code).toBe('too_large');
    expect(read).toBe(false);
    expect(closed).toHaveBeenCalled();
  });

  it('stops reading a streamed body as soon as it passes the cap', async () => {
    let yielded = 0;
    const { transport, closed } = stubTransport(() => ({
      status: 200,
      body: (async function* () {
        for (let index = 0; index < 1000; index += 1) {
          yielded += 1;
          yield new Uint8Array(64 * 1024);
        }
      })(),
    }));
    const result = await fetchManifest('example.com', { transport, resolve: PUBLIC });
    expect(!result.ok && result.error.code).toBe('too_large');
    expect(yielded).toBe(5);
    expect(closed).toHaveBeenCalled();
  });

  it('honours a smaller maxBytes but never a larger one', async () => {
    const body = readFixture('valid', 'full.json');
    const small = stubTransport(() => ({ status: 200, body: chunks(body) }));
    const capped = await fetchManifest('example.com', {
      transport: small.transport,
      resolve: PUBLIC,
      maxBytes: 100,
    });
    expect(!capped.ok && capped.error.code).toBe('too_large');
  });

  it.each([
    ['169.254.169.254'],
    ['127.0.0.1'],
    ['10.1.2.3'],
    ['::1'],
    ['fd00::1'],
    ['::ffff:192.168.0.1'],
  ])('refuses a host that resolves to %s, before any request', async (address) => {
    let connected = false;
    const transport: ManifestTransport = async (request) => {
      await request.resolve(new URL(request.url).hostname);
      connected = true;
      return { status: 200, headers: {}, body: chunks('{}'), close: () => undefined };
    };
    const result = await fetchManifest('rebind.example.com', {
      transport,
      resolve: async () => [PUBLIC_V4, address],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('private_address');
    expect(connected).toBe(false);
  });

  it('reports a host that does not resolve', async () => {
    const { transport } = stubTransport(() => ({ status: 200 }));
    const result = await fetchManifest('missing.example.com', {
      transport,
      resolve: async () => {
        throw new Error('ENOTFOUND');
      },
    });
    expect(!result.ok && result.error.code).toBe('unresolvable_host');
  });

  it('times out a read that never finishes', async () => {
    const transport: ManifestTransport = (request) =>
      new Promise((_, reject) => {
        request.signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    const result = await fetchManifest('example.com', {
      transport,
      resolve: PUBLIC,
      timeoutMs: 20,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatchObject({ code: 'timeout', retryable: true });
  });

  it('times out a body that stalls', async () => {
    const transport: ManifestTransport = async (request) => ({
      status: 200,
      headers: {},
      close: () => undefined,
      body: (async function* () {
        yield new TextEncoder().encode('{');
        await new Promise((_, reject) =>
          request.signal.addEventListener('abort', () => reject(new Error('aborted'))),
        );
      })(),
    });
    const result = await fetchManifest('example.com', {
      transport,
      resolve: PUBLIC,
      timeoutMs: 20,
    });
    expect(!result.ok && result.error.code).toBe('timeout');
  });

  it('never allows a timeout above 10 seconds', async () => {
    const seen: number[] = [];
    const spy = vi.spyOn(globalThis, 'setTimeout');
    const { transport } = stubTransport(() => ({ status: 404 }));
    await fetchManifest('example.com', { transport, resolve: PUBLIC, timeoutMs: 600_000 });
    for (const call of spy.mock.calls) if (typeof call[1] === 'number') seen.push(call[1]);
    spy.mockRestore();
    expect(Math.max(...seen)).toBeLessThanOrEqual(10_000);
  });

  it('reports a transport failure as a retryable network error without echoing it', async () => {
    const transport: ManifestTransport = async () => {
      throw new Error('ECONNRESET secret-ish detail');
    };
    const result = await fetchManifest('example.com', { transport, resolve: PUBLIC });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({ code: 'network_error', retryable: true });
      expect(result.error.message).not.toContain('secret');
    }
  });

  it('refuses a bad target without calling the transport', async () => {
    const transport = vi.fn<ManifestTransport>();
    const result = await fetchManifest('http://example.com', { transport, resolve: PUBLIC });
    expect(!result.ok && result.error.code).toBe('unsafe_url_scheme');
    expect(transport).not.toHaveBeenCalled();
  });
});

describe('connect-time address check', () => {
  it('answers node:https lookups with checked addresses only', async () => {
    const lookup = guardedLookup(checkedResolver(async () => [PUBLIC_V4, '2606:2800:220:1::1']));
    const all = await new Promise((resolve, reject) =>
      lookup('example.com', { all: true }, (error, addresses) =>
        error ? reject(error) : resolve(addresses),
      ),
    );
    expect(all).toEqual([
      { address: PUBLIC_V4, family: 4 },
      { address: '2606:2800:220:1::1', family: 6 },
    ]);
    const v6 = await new Promise((resolve, reject) =>
      lookup('example.com', { family: 6 }, (error, address, family) =>
        error ? reject(error) : resolve([address, family]),
      ),
    );
    expect(v6).toEqual(['2606:2800:220:1::1', 6]);
  });

  it('fails the lookup when any answer is private', async () => {
    const lookup = guardedLookup(checkedResolver(async () => [PUBLIC_V4, '10.0.0.1']));
    const error = await new Promise((resolve) =>
      lookup('example.com', {}, (failure) => resolve(failure)),
    );
    expect(error).toMatchObject({ code: 'private_address' });
  });

  it('the default transport refuses a private resolution before opening a socket', async () => {
    const result = await fetchManifest('example.com', {
      transport: nodeHttpsTransport,
      resolve: async () => ['127.0.0.1'],
      timeoutMs: 2_000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('private_address');
  });
});
