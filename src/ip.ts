/**
 * Which addresses a remote read must never connect to.
 *
 * Refused: private, loopback, "this network", link-local (incl. cloud
 * metadata), CGNAT, benchmarking, IETF protocol assignments, documentation
 * ranges and multicast/reserved IPv4; and for IPv6 loopback, unspecified,
 * unique-local, link-local, site-local, IPv4-compatible, IPv4-mapped (judged
 * by the IPv4 inside), NAT64, 6to4, Teredo, documentation, discard-only and
 * multicast. Anything that does not parse as an address is refused too.
 */

export function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const [a = 0, b = 0, c = 0] = parts.map(Number);
  if (parts.map(Number).some((octet) => octet > 255)) return false;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 192 && b === 0 && c === 0) return true;
  if (a === 192 && b === 0 && c === 2) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a >= 224) return true;
  return false;
}

/** The eight 16-bit groups of an IPv6 address, or undefined when it does not parse. */
export function ipv6Groups(address: string): number[] | undefined {
  const bare = (address.replace(/^\[|\]$/g, '').split('%')[0] ?? '').toLowerCase();
  if (!bare.includes(':') || !/^[0-9a-f:.]+$/.test(bare)) return undefined;
  const halves = bare.split('::');
  if (halves.length > 2) return undefined;
  const part = (text: string): number[] | undefined => {
    if (text === '') return [];
    const out: number[] = [];
    const pieces = text.split(':');
    for (let index = 0; index < pieces.length; index += 1) {
      const piece = pieces[index] as string;
      if (piece.includes('.')) {
        if (index !== pieces.length - 1) return undefined;
        const octets = piece
          .split('.')
          .map((value) => (/^\d{1,3}$/.test(value) ? Number(value) : Number.NaN));
        if (
          octets.length !== 4 ||
          octets.some((value) => !Number.isInteger(value) || value > 255)
        ) {
          return undefined;
        }
        const [o0 = 0, o1 = 0, o2 = 0, o3 = 0] = octets;
        out.push((o0 << 8) | o1, (o2 << 8) | o3);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(piece)) return undefined;
      out.push(Number.parseInt(piece, 16));
    }
    return out;
  };
  const head = part(halves[0] ?? '');
  const tail = halves.length === 2 ? part(halves[1] ?? '') : [];
  if (!head || !tail) return undefined;
  if (halves.length === 1) return head.length === 8 ? head : undefined;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return undefined;
  return [...head, ...Array<number>(missing).fill(0), ...tail];
}

const v4Of = (high: number, low: number): string =>
  [(high >>> 8) & 255, high & 255, (low >>> 8) & 255, low & 255].join('.');

export function isPrivateIpv6(address: string): boolean {
  const groups = ipv6Groups(address);
  if (!groups) return true;
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = groups;
  const zeroPrefix = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0;
  if (zeroPrefix && g5 === 0xffff) return isPrivateIpv4(v4Of(g6, g7)); // ::ffff:0:0/96, IPv4-mapped
  if (zeroPrefix && g5 === 0) return true; // ::/96: unspecified, loopback, IPv4-compatible
  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g0 & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local
  if (g0 === 0x64 && g1 === 0xff9b) return true; // NAT64
  if (g0 === 0x2002) return true; // 6to4
  if (g0 === 0x2001 && g1 === 0) return true; // Teredo
  if (g0 === 0x2001 && g1 === 0xdb8) return true; // documentation
  if (g0 === 0x100 && g1 === 0 && g2 === 0 && g3 === 0) return true; // discard-only
  if (g0 >= 0xff00) return true; // multicast
  return false;
}

/** True for any address a remote read must not connect to. */
export function isPrivateAddress(address: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(address)) {
    return isPrivateIpv4(address) || address.split('.').some((octet) => Number(octet) > 255);
  }
  return isPrivateIpv6(address);
}
