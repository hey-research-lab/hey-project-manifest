import { describe, expect, it } from 'vitest';

import {
  assertChainId,
  CAIP2,
  CHAIN_ID,
  explorerAddressUrl,
  hasChecksumCase,
  isValidChecksum,
  normalizeAddress,
  normalizeTxHash,
  toChecksumAddress,
  UnsupportedChainError,
} from '../src/index.js';

// The test vectors published with EIP-55.
const EIP55_VECTORS = [
  '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
  '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359',
  '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB',
  '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb',
];

describe('EIP-55', () => {
  it.each(EIP55_VECTORS)('reproduces %s', (vector) => {
    expect(toChecksumAddress(vector.toLowerCase())).toBe(vector);
    expect(isValidChecksum(vector)).toBe(true);
  });

  it('rejects a mixed-case address with one letter flipped', () => {
    const vector = EIP55_VECTORS[0] as string;
    const flipped = `${vector.slice(0, -1)}D`;
    expect(hasChecksumCase(flipped)).toBe(true);
    expect(isValidChecksum(flipped)).toBe(false);
  });

  it('accepts single-case addresses as carrying no checksum', () => {
    const vector = EIP55_VECTORS[1] as string;
    expect(isValidChecksum(vector.toLowerCase())).toBe(true);
    expect(isValidChecksum(`0x${vector.slice(2).toUpperCase()}`)).toBe(true);
  });

  it('is false for non-addresses and throws when asked to checksum one', () => {
    expect(isValidChecksum('0x1234')).toBe(false);
    expect(() => toChecksumAddress('0x1234')).toThrow();
  });
});

describe('shared chain and EVM helpers', () => {
  it('fixes Robinhood Chain', () => {
    expect(CHAIN_ID).toBe(4663);
    expect(CAIP2).toBe('eip155:4663');
    expect(() => assertChainId(4663)).not.toThrow();
    for (const other of [1, '4663', 4663.1, null]) {
      expect(() => assertChainId(other)).toThrow(UnsupportedChainError);
    }
    try {
      assertChainId(8453);
    } catch (error) {
      expect((error as UnsupportedChainError).code).toBe('unsupported_chain');
      expect((error as Error).message).toBe(
        'HEY supports Robinhood Chain (4663) only; chain 8453 is not supported.',
      );
    }
  });

  it('normalises to lowercase', () => {
    expect(normalizeAddress(EIP55_VECTORS[0] as string)).toBe(
      (EIP55_VECTORS[0] as string).toLowerCase(),
    );
    expect(normalizeTxHash(`0x${'AB'.repeat(32)}`)).toBe(`0x${'ab'.repeat(32)}`);
    expect(explorerAddressUrl(EIP55_VECTORS[0] as string)).toBe(
      `https://robinhoodchain.blockscout.com/address/${(EIP55_VECTORS[0] as string).toLowerCase()}`,
    );
  });
});
