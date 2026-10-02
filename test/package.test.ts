import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';

import { VERSION, type heyProjectManifestSchema, type HeyProjectManifest } from '../src/index.js';

const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8')) as {
  version: string;
  bin: Record<string, string>;
  files: string[];
  dependencies: Record<string, string>;
};

describe('package', () => {
  it('reports the package version', () => {
    expect(VERSION).toBe(pkg.version);
  });

  it('ships the hey-project bin and the schema', () => {
    expect(pkg.bin['hey-project']).toBe('./dist/cli.js');
    expect(pkg.files).toContain('schema');
  });

  it('keeps runtime dependencies to zod and @noble/hashes', () => {
    expect(Object.keys(pkg.dependencies).sort()).toEqual(['@noble/hashes', 'zod']);
  });

  it('types the zod output as the manifest type', () => {
    expectTypeOf<z.output<typeof heyProjectManifestSchema>>().toEqualTypeOf<HeyProjectManifest>();
  });
});
