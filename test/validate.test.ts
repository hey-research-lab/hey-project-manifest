import { describe, expect, it } from 'vitest';

import {
  CONTRACT_TYPES,
  heyProjectManifestSchema,
  ISSUE_CODES,
  LIMITS,
  parseManifest,
  validateManifest,
  type HeyProjectManifest,
} from '../src/index.js';
import { fixtureJson, INVALID_CASES, listFixtures, readFixture } from './helpers.js';

describe('valid fixtures', () => {
  it.each(listFixtures('valid'))('%s is a valid, declared, unverified manifest', (file) => {
    const result = parseManifest(readFixture('valid', file));
    expect(result.issues.filter((found) => found.severity === 'error')).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.declarationState).toBe('DECLARED');
    expect(result.verified).toBe(false);
    expect(result.manifest?.chainId).toBe(4663);
  });

  it('the minimal manifest is valid but warns that nothing can be corroborated', () => {
    const result = parseManifest(readFixture('valid', 'minimal.json'));
    expect(result.valid).toBe(true);
    expect(result.warningCount).toBe(1);
    expect(result.issues[0]).toMatchObject({
      code: 'nothing_to_corroborate',
      severity: 'warning',
      pointer: '',
    });
  });

  it('the full manifest has no issues at all and keeps every field', () => {
    const result = parseManifest(readFixture('valid', 'full.json'));
    expect(result.issues).toEqual([]);
    const manifest = result.manifest as HeyProjectManifest;
    expect(Object.keys(manifest)).toEqual([
      '$schema',
      'version',
      'name',
      'website',
      'chainId',
      'repositories',
      'contracts',
      'documentation',
      'changelog',
      'feed',
      'officialX',
      'logo',
      'release',
      'commit',
    ]);
    expect(manifest.contracts?.map((contract) => contract.type).sort()).toEqual(
      [...CONTRACT_TYPES].sort(),
    );
  });

  it('normalises addresses, hashes, URLs and repositories', () => {
    const result = parseManifest(readFixture('valid', 'normalises.json'));
    expect(result.valid).toBe(true);
    expect(result.manifest).toEqual({
      version: 1,
      name: 'Example Protocol',
      website: 'https://example.com/',
      chainId: 4663,
      repositories: ['https://github.com/example/protocol', 'https://github.com/example/sdk'],
      contracts: [
        {
          address: '0xdbf03b407c01e7cd3cbea99509d93f8dddc8c6fb',
          type: 'token',
          deploymentTx: `0x${'ab'.repeat(32)}`,
        },
      ],
      officialX: 'https://x.com/Example',
      commit: '0123456789abcdef0123456789abcdef01234567',
    });
  });
});

describe('invalid fixtures', () => {
  it('every invalid fixture has an expectation, and every expectation a fixture', () => {
    expect(listFixtures('invalid').sort()).toEqual(Object.keys(INVALID_CASES).sort());
  });

  it.each(Object.entries(INVALID_CASES))('%s raises %j', (file, expected) => {
    const result = parseManifest(readFixture('invalid', file));
    expect(result.valid).toBe(false);
    expect(result.manifest).toBeUndefined();
    expect(result.verified).toBe(false);
    expect(result.declarationState).toBe('DECLARED');
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: expected.code,
        pointer: expected.pointer,
        severity: 'error',
      }),
    );
    expect(result.errorCount).toBeGreaterThan(0);
  });

  it('malformed JSON is invalid_json', () => {
    const result = parseManifest(readFixture('invalid', 'not-json.txt'));
    expect(result.valid).toBe(false);
    expect(result.issues).toEqual([expect.objectContaining({ code: 'invalid_json', pointer: '' })]);
  });
});

describe('rules', () => {
  const base = fixtureJson('valid', 'minimal.json') as Record<string, unknown>;
  const withFields = (fields: Record<string, unknown>) => ({ ...base, ...fields });
  const codes = (value: unknown) => validateManifest(value).issues.map((found) => found.code);

  it('chainId must be the JSON integer 4663', () => {
    for (const chainId of [1, 8453, 4663.5, -4663, 0, '04663', null, true, [4663], { id: 4663 }]) {
      expect(codes(withFields({ chainId }))).toContain('unsupported_chain');
    }
    expect(validateManifest(withFields({ chainId: 4663 })).valid).toBe(true);
  });

  it('the unsupported_chain message follows the shared pattern', () => {
    const [found] = validateManifest(withFields({ chainId: 1 })).issues;
    expect(found?.message).toBe(
      'HEY supports Robinhood Chain (4663) only; chain 1 is not supported.',
    );
  });

  it('version must be 1', () => {
    for (const version of [0, 2, 1.1, '1', null]) {
      expect(codes(withFields({ version }))).toContain('unsupported_version');
    }
  });

  it.each(['chains', 'network', 'rpc'])('a %s field is refused as not part of v1', (key) => {
    const result = validateManifest(withFields({ [key]: [4663] }));
    expect(result.issues[0]).toMatchObject({ code: 'unknown_field', pointer: `/${key}` });
    expect(result.issues[0]?.message).toContain('Robinhood Chain');
  });

  it('accepts every contract type and nothing else', () => {
    for (const type of CONTRACT_TYPES) {
      const result = validateManifest(
        withFields({
          contracts: [{ address: '0x0000000000000000000000000000000000000001', type }],
        }),
      );
      expect(result.valid).toBe(true);
    }
    for (const type of ['Token', 'erc20', '', 'wallet']) {
      expect(
        codes(
          withFields({
            contracts: [{ address: '0x0000000000000000000000000000000000000001', type }],
          }),
        ),
      ).toContain('invalid_contract_type');
    }
  });

  it('accepts all-lowercase and all-uppercase addresses without a checksum', () => {
    const result = validateManifest(
      withFields({
        contracts: [
          { address: '0xfb6916095ca1df60bb79ce92ce3ea74c37c5d359', type: 'token' },
          { address: '0xDBF03B407C01E7CD3CBEA99509D93F8DDDC8C6FB', type: 'pool' },
        ],
      }),
    );
    expect(result.valid).toBe(true);
    expect(result.manifest?.contracts?.map((contract) => contract.address)).toEqual([
      '0xfb6916095ca1df60bb79ce92ce3ea74c37c5d359',
      '0xdbf03b407c01e7cd3cbea99509d93f8dddc8c6fb',
    ]);
  });

  it('checks the deployer checksum too', () => {
    expect(
      codes(
        withFields({
          contracts: [
            {
              address: '0x0000000000000000000000000000000000000001',
              type: 'token',
              deployer: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD',
            },
          ],
        }),
      ),
    ).toContain('invalid_checksum');
  });

  it('reports every duplicate, against the first occurrence', () => {
    const result = validateManifest(
      withFields({
        contracts: [
          { address: '0x0000000000000000000000000000000000000001', type: 'token' },
          { address: '0x0000000000000000000000000000000000000002', type: 'pool' },
          { address: '0x0000000000000000000000000000000000000001', type: 'pool' },
          { address: '0x0000000000000000000000000000000000000001', type: 'vault' },
        ],
        repositories: [
          'https://github.com/example/a',
          'https://github.com/EXAMPLE/A/',
          'https://github.com/example/a.git',
          'https://gitlab.com/example/a',
          'https://GitLab.com/Example/A/',
        ],
      }),
    );
    const duplicates = result.issues.filter((found) => found.code.startsWith('duplicate_'));
    expect(duplicates.map((found) => found.pointer)).toEqual([
      '/contracts/2/address',
      '/contracts/3/address',
      '/repositories/1',
      '/repositories/2',
      '/repositories/4',
    ]);
    expect(duplicates[0]?.message).toContain('contracts[0]');
  });

  it('reports duplicates even when another field is invalid', () => {
    const issues = codes(
      withFields({
        chainId: 1,
        contracts: [
          { address: '0x0000000000000000000000000000000000000001', type: 'token' },
          { address: '0x0000000000000000000000000000000000000001', type: 'erc20' },
        ],
      }),
    );
    expect(issues).toEqual(
      expect.arrayContaining(['unsupported_chain', 'invalid_contract_type', 'duplicate_contract']),
    );
  });

  it('reports every issue at once, not only the first', () => {
    const result = validateManifest({
      version: 2,
      name: '',
      website: 'http://example.com',
      chainId: 1,
      logo: 'javascript:alert(1)',
    });
    expect(result.issues.map((found) => found.code)).toEqual(
      expect.arrayContaining([
        'unsupported_version',
        'invalid_text',
        'unsafe_url_scheme',
        'unsupported_chain',
      ]),
    );
    expect(result.errorCount).toBe(5);
  });

  it('enforces the item limits', () => {
    const contracts = Array.from({ length: LIMITS.maxContracts + 1 }, (_, index) => ({
      address: `0x${(index + 1).toString(16).padStart(40, '0')}`,
      type: 'other',
    }));
    expect(codes(withFields({ contracts }))).toContain('too_many_items');
    const repositories = Array.from(
      { length: LIMITS.maxRepositories + 1 },
      (_, index) => `https://github.com/example/r${index}`,
    );
    expect(codes(withFields({ repositories }))).toContain('too_many_items');
  });

  it('warns on a rolling release tag and not on a fixed one', () => {
    for (const release of [
      'latest',
      'nightly-2026-10-01',
      'build-debug',
      'edge',
      'data-2026-10-01',
    ]) {
      const result = validateManifest(withFields({ release }));
      expect(result.valid).toBe(true);
      expect(result.issues.map((found) => found.code)).toContain('rolling_release_tag');
    }
    for (const release of ['v1.2.0', 'v1.2.0-dev.3', 'v2026.10.01', 'docs-latest']) {
      expect(codes(withFields({ release }))).not.toContain('rolling_release_tag');
    }
  });

  it('flags a website on another host only when the read host is known', () => {
    expect(codes(base)).not.toContain('website_host_mismatch');
    expect(
      validateManifest(base, { expectedHost: 'www.example.com' }).issues.map((found) => found.code),
    ).not.toContain('website_host_mismatch');
    const result = validateManifest(base, { expectedHost: 'other.example.org' });
    expect(result.valid).toBe(true);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'website_host_mismatch', severity: 'warning' }),
    );
  });

  it('accepts a 64-hex (SHA-256) commit id', () => {
    expect(validateManifest(withFields({ commit: 'a'.repeat(64) })).valid).toBe(true);
  });
});

describe('robustness', () => {
  it.each([null, undefined, 0, 'text', true, [], () => 1])('never throws on %s', (value) => {
    const result = validateManifest(value);
    expect(result.valid).toBe(false);
  });

  it('rejects documents over the size limit before parsing', () => {
    const big = JSON.stringify({ name: 'x'.repeat(LIMITS.maxBytes) });
    expect(parseManifest(big).issues).toEqual([expect.objectContaining({ code: 'too_large' })]);
    expect(parseManifest(new TextEncoder().encode(big)).issues[0]?.code).toBe('too_large');
  });

  it('rejects invalid UTF-8 bytes', () => {
    expect(parseManifest(new Uint8Array([0x7b, 0xff, 0x7d])).issues[0]?.code).toBe('invalid_json');
  });

  it('accepts a leading byte-order mark', () => {
    const text = `\ufeff${readFixture('valid', 'brief-shape.json')}`;
    expect(parseManifest(text).valid).toBe(true);
  });

  it('survives deeply nested input without exhausting the stack', () => {
    const depth = 120_000; // about 240 KB, just under the size limit
    const text = `${'['.repeat(depth)}${']'.repeat(depth)}`;
    expect(() => parseManifest(text)).not.toThrow();
  });

  it('never leaves prototype pollution behind', () => {
    parseManifest(readFixture('invalid', 'proto-key.json'));
    parseManifest(readFixture('invalid', 'constructor-key.json'));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('escapes untrusted keys in messages', () => {
    const key = 'evil\u001b[31m\u202e';
    const [found] = validateManifest({
      ...(fixtureJson('valid', 'minimal.json') as object),
      [key]: 1,
    }).issues;
    expect(found?.code).toBe('unknown_field');
    // eslint-disable-next-line no-control-regex
    expect(found?.message).not.toMatch(/[\u001b\u202e]/);
  });

  it('every reported code is a documented code with its documented severity', () => {
    for (const file of Object.keys(INVALID_CASES)) {
      for (const found of parseManifest(readFixture('invalid', file)).issues) {
        expect(ISSUE_CODES[found.code]).toBe(found.severity);
      }
    }
  });
});

describe('the exported zod schema', () => {
  it('parses a valid manifest into the normalised form', () => {
    const parsed = heyProjectManifestSchema.parse(fixtureJson('valid', 'normalises.json'));
    expect(parsed.contracts?.[0]?.address).toBe('0xdbf03b407c01e7cd3cbea99509d93f8dddc8c6fb');
  });

  it('carries the issue code on each zod issue, duplicates included', () => {
    const result = heyProjectManifestSchema.safeParse(
      fixtureJson('invalid', 'duplicate-contract.json'),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]).toMatchObject({
        path: ['contracts', 1, 'address'],
        params: { code: 'duplicate_contract' },
      });
    }
    const chain = heyProjectManifestSchema.safeParse(fixtureJson('invalid', 'chain-ethereum.json'));
    expect(chain.success).toBe(false);
    if (!chain.success) {
      expect(chain.error.issues[0]).toMatchObject({ params: { code: 'unsupported_chain' } });
    }
  });
});
