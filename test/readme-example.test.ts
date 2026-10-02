import { describe, expect, it } from 'vitest';
import { parseManifest, validateManifest } from '../src/index.js';

describe('the README example compiles under strict TypeScript (0.1.1)', () => {
  it('runs the README lines as written', () => {
    const lines: string[] = [];
    const result = parseManifest('{"version":1}');
    if (result.valid) lines.push(String(result.manifest.contracts));
    else
      for (const issue of result.issues)
        lines.push(`${issue.code} ${issue.pointer} ${issue.message}`);
    expect(lines.length).toBeGreaterThan(0);
  });

  it('narrows on valid without a non-null assertion', () => {
    const result = validateManifest({});
    if (result.valid) {
      // Typed: no "possibly undefined" here.
      expect(Array.isArray(result.manifest.contracts ?? [])).toBe(true);
    } else {
      expect(result.manifest).toBeUndefined();
    }
  });
});
