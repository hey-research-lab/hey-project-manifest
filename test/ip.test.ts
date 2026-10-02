import { describe, expect, it } from 'vitest';

import { isPrivateAddress } from '../src/index.js';
import { ipv4, PUBLIC_V4 } from './helpers.js';

describe('isPrivateAddress', () => {
  it.each([
    '10.0.0.1',
    '127.0.0.1',
    '0.0.0.0',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '100.64.0.1',
    ipv4(198, 18, 0, 1),
    ipv4(192, 0, 0, 8),
    '192.0.2.1',
    '198.51.100.7',
    '203.0.113.9',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:a00:1',
    '::7f00:1',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'febf::1',
    'fec0::1',
    '64:ff9b::7f00:1',
    '2002:7f00:1::1',
    '2001:0:4136:e378::1',
    '2001:db8::1',
    '100::1',
    'ff02::1',
    'fe80::1%en0',
    'not-an-address',
    '1.2.3.999',
  ])('refuses %s', (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each([
    PUBLIC_V4,
    ipv4(1, 1, 1, 1),
    ipv4(172, 32, 0, 1),
    '2606:2800:220:1:248:1893:25c8:1946',
    '::ffff:5db8:d822',
  ])('allows the public address %s', (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });
});
