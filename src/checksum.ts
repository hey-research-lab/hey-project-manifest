import { keccak_256 } from '@noble/hashes/sha3';
import { utf8ToBytes } from '@noble/hashes/utils';

import { isAddress } from './evm.js';

/**
 * EIP-55 mixed-case checksums.
 *
 * The rule the ecosystem shares: an all-lowercase or all-uppercase address
 * carries no checksum and is accepted as it is; a mixed-case address must
 * match its EIP-55 form exactly. Machine output is always lowercase; the
 * checksummed form is for display only.
 */
export function toChecksumAddress(address: string): string {
  if (!isAddress(address)) {
    throw Object.assign(new Error('not an EVM address'), { code: 'invalid_address' });
  }
  const lower = address.slice(2).toLowerCase();
  const hash = keccak_256(utf8ToBytes(lower));
  let out = '0x';
  for (let index = 0; index < lower.length; index += 1) {
    const char = lower[index] as string;
    // One nibble of the hash per hex character: the high nibble for even positions.
    const byte = hash[index >> 1] as number;
    const nibble = index % 2 === 0 ? byte >> 4 : byte & 0x0f;
    out += nibble >= 8 ? char.toUpperCase() : char;
  }
  return out;
}

/** True when the address carries a checksum, i.e. mixes upper and lower case letters. */
export function hasChecksumCase(address: string): boolean {
  const body = address.slice(2);
  return /[a-f]/.test(body) && /[A-F]/.test(body);
}

/**
 * True for an address with no checksum to check (all one case) or with a
 * correct EIP-55 checksum. False for a mixed-case address whose checksum is
 * wrong, and for anything that is not an address.
 */
export function isValidChecksum(address: string): boolean {
  if (!isAddress(address)) return false;
  if (!hasChecksumCase(address)) return true;
  return toChecksumAddress(address) === address;
}
