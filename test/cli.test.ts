import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { validateManifest, type ManifestTransport } from '../src/index.js';
import { run, type RunIO } from '../src/run.js';
import { PUBLIC_V4, readFixture } from './helpers.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hey-project-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function io(transport?: ManifestTransport) {
  const out: string[] = [];
  const err: string[] = [];
  const world: RunIO = {
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    cwd: dir,
    env: {},
    now: () => new Date('2026-10-02T12:00:00.000Z'),
    ...(transport ? { fetchOptions: { transport, resolve: async () => [PUBLIC_V4] } } : {}),
  };
  return { world, stdout: () => out.join(''), stderr: () => err.join('') };
}

const answering =
  (status: number, body = ''): ManifestTransport =>
  async (request) => {
    await request.resolve(new URL(request.url).hostname);
    return {
      status,
      headers: { 'content-type': 'application/json' },
      body: (async function* () {
        yield new TextEncoder().encode(body);
      })(),
      close: () => undefined,
    };
  };

const put = (name: string, text: string) => {
  const path = join(dir, name);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
  return path;
};

describe('hey-project init', () => {
  it('writes a valid template with no flags at all', async () => {
    const t = io();
    expect(await run(['init'], t.world)).toBe(0);
    const written = JSON.parse(readFileSync(join(dir, '.well-known/hey-project.json'), 'utf8'));
    expect(validateManifest(written).valid).toBe(true);
    expect(written.chainId).toBe(4663);
    expect(t.stderr()).toContain('placeholder');
  });

  it('writes the normalised values it was given', async () => {
    const t = io();
    const code = await run(
      [
        'init',
        '--name',
        'Example Protocol',
        '--website',
        'https://example.org',
        '--repository',
        'https://github.com/Example/Protocol.git',
        '--contract',
        '0X5AAEB6053F3E94C9B9A09F33669435E7EF1BEAED:token',
        '--contract',
        '0x0000000000000000000000000000000000000002',
        '--x',
        'https://twitter.com/example',
        '--out',
        'site/hey-project.json',
      ],
      t.world,
    );
    expect(code).toBe(0);
    const written = JSON.parse(readFileSync(join(dir, 'site/hey-project.json'), 'utf8'));
    expect(written).toMatchObject({
      name: 'Example Protocol',
      repositories: ['https://github.com/example/protocol'],
      contracts: [
        { address: '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed', type: 'token' },
        { address: '0x0000000000000000000000000000000000000002', type: 'other' },
      ],
      officialX: 'https://x.com/example',
    });
    expect(t.stderr()).toBe('');
  });

  it('refuses invalid values with a usage error and writes nothing', async () => {
    const t = io();
    expect(await run(['init', '--website', 'http://example.org'], t.world)).toBe(2);
    expect(t.stderr()).toContain('unsafe_url_scheme');
    expect(() => readFileSync(join(dir, '.well-known/hey-project.json'))).toThrow();
    expect(await run(['init', '--contract', '0x01:token'], io().world)).toBe(2);
    expect(await run(['init', '--contract', `0x${'1'.repeat(40)}:wallet`], io().world)).toBe(2);
  });

  it('never overwrites without --force, and overwrites with it', async () => {
    put('.well-known/hey-project.json', 'keep me');
    expect(await run(['init'], io().world)).toBe(2);
    expect(readFileSync(join(dir, '.well-known/hey-project.json'), 'utf8')).toBe('keep me');
    expect(await run(['init', '--force', '--name', 'Second'], io().world)).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, '.well-known/hey-project.json'), 'utf8')).name).toBe(
      'Second',
    );
  });

  it('refuses to write through a symbolic link, even with --force', async () => {
    const victim = put('victim.txt', 'untouched');
    symlinkSync(victim, join(dir, 'link.json'));
    expect(await run(['init', '--out', 'link.json', '--force'], io().world)).toBe(2);
    expect(readFileSync(victim, 'utf8')).toBe('untouched');
  });

  it('prints instead of writing with --stdout', async () => {
    const t = io();
    expect(await run(['init', '--stdout', '--name', 'Printed'], t.world)).toBe(0);
    expect(JSON.parse(t.stdout()).name).toBe('Printed');
  });

  it('emits one JSON document with --json', async () => {
    const t = io();
    expect(await run(['init', '--json'], t.world)).toBe(0);
    const doc = JSON.parse(t.stdout());
    expect(doc).toMatchObject({
      schema: 'hey.cli/v1',
      command: 'init',
      ok: true,
      chain: { name: 'Robinhood Chain', chainId: 4663, caip2: 'eip155:4663' },
      data: { written: '.well-known/hey-project.json', placeholders: true },
      error: null,
    });
  });
});

describe('hey-project validate', () => {
  it('exits 0 for a valid file and prints that it is declared, not verified', async () => {
    const t = io();
    put('m.json', readFixture('valid', 'full.json'));
    expect(await run(['validate', 'm.json'], t.world)).toBe(0);
    expect(t.stdout()).toContain('valid manifest (declared, not verified)');
  });

  it('exits 1 for an invalid file and lists the issues on stderr', async () => {
    const t = io();
    put('m.json', readFixture('invalid', 'chain-ethereum.json'));
    expect(await run(['validate', 'm.json'], t.world)).toBe(1);
    expect(t.stderr()).toContain('unsupported_chain');
  });

  it('finds the default locations', async () => {
    put('hey-project.json', readFixture('valid', 'minimal.json'));
    expect(await run(['validate'], io().world)).toBe(0);
    put('.well-known/hey-project.json', readFixture('invalid', 'version-2.json'));
    expect(await run(['validate'], io().world)).toBe(1);
  });

  it('is a usage error when there is nothing to read', async () => {
    const t = io();
    expect(await run(['validate'], t.world)).toBe(2);
    expect(t.stderr()).toContain('no manifest found');
    expect(await run(['validate', 'missing.json'], io().world)).toBe(2);
  });

  it('refuses to follow a symbolic link', async () => {
    const target = put('real.json', readFixture('valid', 'minimal.json'));
    symlinkSync(target, join(dir, 'link.json'));
    const t = io();
    expect(await run(['validate', 'link.json'], t.world)).toBe(2);
    expect(t.stderr()).toContain('symbolic link');
  });

  it('reports an oversized file as too_large without reading it all', async () => {
    put('big.json', `{"name":"${'x'.repeat(300 * 1024)}"}`);
    const t = io();
    expect(await run(['validate', 'big.json', '--json'], t.world)).toBe(1);
    expect(JSON.parse(t.stdout()).data.issues[0].code).toBe('too_large');
  });

  it('prints one JSON document with the issues and the source', async () => {
    const t = io();
    put('m.json', readFixture('invalid', 'duplicate-contract.json'));
    expect(await run(['validate', 'm.json', '--json'], t.world)).toBe(1);
    const doc = JSON.parse(t.stdout());
    expect(doc).toMatchObject({
      schema: 'hey.cli/v1',
      command: 'validate',
      ok: false,
      data: { valid: false, declarationState: 'DECLARED', verified: false },
      error: { code: 'invalid_manifest' },
      source: { kind: 'file', path: 'm.json', readAt: '2026-10-02T12:00:00.000Z' },
    });
    expect(doc.data.issues[0]).toMatchObject({
      code: 'duplicate_contract',
      pointer: '/contracts/1/address',
    });
    expect(t.stderr()).toBe('');
  });

  it('is silent on success with --quiet', async () => {
    const t = io();
    put('m.json', readFixture('valid', 'full.json'));
    expect(await run(['validate', 'm.json', '--quiet'], t.world)).toBe(0);
    expect(t.stdout()).toBe('');
  });

  it('reads a remote manifest from the well-known path', async () => {
    const t = io(answering(200, readFixture('valid', 'full.json')));
    expect(await run(['validate', 'https://example.com', '--json'], t.world)).toBe(0);
    expect(JSON.parse(t.stdout()).source).toMatchObject({
      kind: 'url',
      url: 'https://example.com/.well-known/hey-project.json',
      status: 200,
    });
  });

  it.each([
    [404, 4],
    [429, 5],
    [503, 6],
    [403, 1],
    [302, 1],
  ])('maps a remote %s to exit %s', async (status, exit) => {
    expect(await run(['validate', 'https://example.com'], io(answering(status)).world)).toBe(exit);
  });

  it.each(['http://example.com', 'https://localhost', 'https://example.com/elsewhere.json'])(
    'treats the unreadable target %s as a usage error',
    async (target) => {
      expect(await run(['validate', target], io(answering(200)).world)).toBe(2);
    },
  );
});

describe('hey-project inspect', () => {
  it('shows what is declared, with checksummed display addresses and explorer links', async () => {
    const t = io();
    put('m.json', readFixture('valid', 'full.json'));
    expect(await run(['inspect', 'm.json'], t.world)).toBe(0);
    const text = t.stdout();
    expect(text).toContain('Example Protocol');
    expect(text).toContain('Declared, not verified');
    expect(text).toContain('Robinhood Chain (4663, eip155:4663)');
    expect(text).toContain('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed');
    expect(text).toContain(
      'https://robinhoodchain.blockscout.com/address/0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed',
    );
    expect(text).toContain('deployer (declared)');
    expect(text).toContain('/.well-known/hey-research.txt');
    // "verified" only ever appears as "not verified".
    for (const match of text.matchAll(/(\S+)\s+verified/gi)) expect(match[1]).toMatch(/^not$/i);
  });

  it('never prints control or bidi characters from the document', async () => {
    const t = io();
    put(
      'm.json',
      JSON.stringify({
        version: 1,
        name: 'Bad\u001b[2J\u202eName',
        website: 'https://example.com',
        chainId: 4663,
      }),
    );
    expect(await run(['inspect', 'm.json'], t.world)).toBe(1);
    // eslint-disable-next-line no-control-regex
    expect(t.stdout() + t.stderr()).not.toMatch(/[\u001b\u202e]/);
  });

  it('prints the normalised manifest with --json', async () => {
    const t = io();
    put('m.json', readFixture('valid', 'normalises.json'));
    expect(await run(['inspect', 'm.json', '--json'], t.world)).toBe(0);
    expect(JSON.parse(t.stdout()).data.manifest.repositories).toEqual([
      'https://github.com/example/protocol',
      'https://github.com/example/sdk',
    ]);
  });

  it('reads a remote manifest and says where from', async () => {
    const t = io(answering(200, readFixture('valid', 'full.json')));
    expect(await run(['inspect', 'https://example.com'], t.world)).toBe(0);
    expect(t.stdout()).toContain(
      'Read https://example.com/.well-known/hey-project.json at 2026-10-02T12:00:00.000Z',
    );
  });
});

describe('usage', () => {
  it('prints the version', async () => {
    const t = io();
    expect(await run(['--version'], t.world)).toBe(0);
    expect(t.stdout()).toBe('0.1.1\n');
  });

  it('prints help with exit 0, and help on stderr with exit 2 when no command is given', async () => {
    const help = io();
    expect(await run(['--help'], help.world)).toBe(0);
    expect(help.stdout()).toContain('Declared is not verified');
    const none = io();
    expect(await run([], none.world)).toBe(2);
    expect(none.stderr()).toContain('Usage');
  });

  it.each([
    [['frobnicate']],
    [['validate', '--bogus']],
    [['validate', 'a.json', 'b.json']],
    [['validate', '--name', 'x']],
    [['init', 'extra']],
  ])('exits 2 for %j', async (argv) => {
    expect(await run(argv, io().world)).toBe(2);
  });

  it('keeps usage errors machine-readable with --json', async () => {
    const t = io();
    expect(await run(['frobnicate', '--json'], t.world)).toBe(2);
    expect(JSON.parse(t.stdout())).toMatchObject({ ok: false, error: { code: 'usage' } });
  });
});
