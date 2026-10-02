import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import { CHAIN_ID, CONTRACT_TYPES, LIMITS, SCHEMA_ID } from '../src/index.js';
import { fixtureJson, INVALID_CASES, listFixtures } from './helpers.js';

type JsonSchema = {
  $id: string;
  $schema: string;
  required: string[];
  properties: Record<string, Record<string, unknown>>;
  $defs: Record<string, Record<string, unknown>>;
};

const schema = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'schema', 'hey-project.v1.json'), 'utf8'),
) as JsonSchema;

const ajv = new Ajv2020({ strict: true, allErrors: true });
const validate = ajv.compile(schema);

describe('the published JSON Schema', () => {
  it('is draft 2020-12 with the agreed $id', () => {
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema.$id).toBe(SCHEMA_ID);
    expect(schema.properties.$schema).toEqual(expect.objectContaining({ const: SCHEMA_ID }));
  });

  it('agrees with the package constants', () => {
    expect(schema.properties.chainId).toEqual(expect.objectContaining({ const: CHAIN_ID }));
    expect(schema.properties.version).toEqual(expect.objectContaining({ const: 1 }));
    expect(schema.$defs.contractType?.enum).toEqual([...CONTRACT_TYPES]);
    expect(schema.properties.contracts?.maxItems).toBe(LIMITS.maxContracts);
    expect(schema.properties.repositories?.maxItems).toBe(LIMITS.maxRepositories);
    expect(schema.$defs.httpsUrl?.maxLength).toBe(LIMITS.maxUrlLength);
    expect(schema.required).toEqual(['version', 'name', 'website', 'chainId']);
    expect(schema.properties).not.toHaveProperty('chains');
  });

  it('describes DECLARED as never VERIFIED', () => {
    expect(JSON.stringify(schema)).toContain('DECLARED is not VERIFIED');
  });

  it.each(listFixtures('valid'))('accepts the valid fixture %s', (file) => {
    expect(validate(fixtureJson('valid', file)), JSON.stringify(validate.errors)).toBe(true);
  });

  it.each(Object.entries(INVALID_CASES))('%s: the schema %s', (file, expected) => {
    const accepted = validate(fixtureJson('invalid', file));
    expect(accepted ? 'accept' : 'reject').toBe(expected.schema);
  });
});
