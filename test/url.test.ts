import { describe, expect, it } from 'vitest';

import { checkAuthoredUrl, checkRepositoryUrl, checkXProfileUrl } from '../src/index.js';

const code = (url: string) => {
  const result = checkAuthoredUrl(url);
  return result.ok ? 'ok' : result.code;
};

describe('checkAuthoredUrl', () => {
  it.each([
    ['https://example.com', 'https://example.com/'],
    ['HTTPS://EXAMPLE.com/Path?q=1#frag', 'https://example.com/Path?q=1'],
    ['https://example.com:443/a', 'https://example.com/a'],
    ['https://example.com:8443/a', 'https://example.com:8443/a'],
    ['https://example.com./a', 'https://example.com/a'],
    ['https://docs.example.co.uk/x/y', 'https://docs.example.co.uk/x/y'],
  ])('accepts %s as %s', (input, normalised) => {
    const result = checkAuthoredUrl(input);
    expect(result).toEqual(expect.objectContaining({ ok: true, url: normalised }));
  });

  it.each([
    ['http://example.com', 'unsafe_url_scheme'],
    ['javascript:alert(1)', 'unsafe_url_scheme'],
    ['JaVaScRiPt:alert(1)', 'unsafe_url_scheme'],
    ['data:text/html,hi', 'unsafe_url_scheme'],
    ['file:///etc/passwd', 'unsafe_url_scheme'],
    ['blob:https://example.com/x', 'unsafe_url_scheme'],
    ['ws://example.com', 'unsafe_url_scheme'],
    ['https:example.com', 'invalid_url'],
    ['//example.com', 'invalid_url'],
    ['example.com', 'invalid_url'],
    ['https://exa mple.com', 'invalid_url'],
    ['https://example.com/\u0007', 'invalid_url'],
    ['https://example.com\\@evil.example', 'invalid_url'],
    ['https://example.com/café', 'invalid_url'],
    ['https://user@example.com', 'url_credentials'],
    ['https://:pw@example.com', 'url_credentials'],
    ['https://127.0.0.1', 'url_ip_literal'],
    ['https://127.1', 'url_ip_literal'],
    ['https://0x7f000001', 'url_ip_literal'],
    ['https://2130706433', 'url_ip_literal'],
    ['https://[::1]', 'url_ip_literal'],
    ['https://[::ffff:127.0.0.1]', 'url_ip_literal'],
    ['https://localhost', 'url_local_host'],
    ['https://LOCALHOST', 'url_local_host'],
    ['https://%6c%6fcalhost', 'url_local_host'],
    ['https://api.localhost', 'url_local_host'],
    ['https://nas.local', 'url_local_host'],
    ['https://svc.internal', 'url_local_host'],
    ['https://router.home.arpa', 'url_local_host'],
    ['https://intranet', 'url_local_host'],
    ['https://xn--80ak6aa92e.com', 'url_idn_host'],
    ['https://аpple.com', 'url_idn_host'],
    [`https://example.com/${'a'.repeat(500)}`, 'url_too_long'],
  ])('refuses %s with %s', (input, expected) => {
    expect(code(input)).toBe(expected);
  });
});

describe('checkRepositoryUrl', () => {
  it.each([
    ['https://github.com/Example/Protocol', 'https://github.com/example/protocol'],
    ['https://github.com/example/protocol.git', 'https://github.com/example/protocol'],
    ['https://github.com/example/protocol/', 'https://github.com/example/protocol'],
    ['https://www.github.com/example/protocol', 'https://github.com/example/protocol'],
    ['https://github.com/example/protocol#readme', 'https://github.com/example/protocol'],
    ['https://gitlab.com/group/sub/project.git/', 'https://gitlab.com/group/sub/project'],
  ])('canonicalises %s', (input, canonical) => {
    expect(checkRepositoryUrl(input)).toEqual(
      expect.objectContaining({ ok: true, url: canonical }),
    );
  });

  it.each([
    'https://github.com/',
    'https://github.com/example',
    'https://github.com/example/protocol/tree/main',
    'https://github.com/example/protocol?tab=readme',
    'https://github.com/-bad/protocol',
    'https://gitlab.com/',
  ])('refuses %s', (input) => {
    expect(checkRepositoryUrl(input)).toEqual(
      expect.objectContaining({ ok: false, code: 'invalid_repository_url' }),
    );
  });

  it('applies the general URL rules first', () => {
    expect(checkRepositoryUrl('http://github.com/a/b')).toEqual(
      expect.objectContaining({ ok: false, code: 'unsafe_url_scheme' }),
    );
  });

  it('gives a case-insensitive duplicate key for other hosts while keeping their case', () => {
    const result = checkRepositoryUrl('https://codeberg.org/Example/Repo');
    expect(result).toEqual({
      ok: true,
      url: 'https://codeberg.org/Example/Repo',
      key: 'https://codeberg.org/example/repo',
    });
  });
});

describe('checkXProfileUrl', () => {
  it.each([
    ['https://x.com/HeyResearch', 'https://x.com/HeyResearch'],
    ['https://twitter.com/example', 'https://x.com/example'],
    ['https://www.x.com/example/', 'https://x.com/example'],
    ['https://mobile.twitter.com/example?s=21', 'https://x.com/example'],
  ])('canonicalises %s', (input, canonical) => {
    expect(checkXProfileUrl(input)).toEqual(expect.objectContaining({ ok: true, url: canonical }));
  });

  it.each([
    'https://x.com/',
    'https://x.com/home',
    'https://x.com/i/lists/1',
    'https://x.com/example/status/1',
    'https://x.com/has-dash',
    'https://example.com/example',
    'https://x.com.evil.example/example',
  ])('refuses %s', (input) => {
    expect(checkXProfileUrl(input)).toEqual(
      expect.objectContaining({ ok: false, code: 'invalid_x_url' }),
    );
  });
});
