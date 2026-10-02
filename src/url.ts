import { LIMITS } from './constants.js';
import type { ManifestIssueCode } from './issues.js';

/**
 * URL rules for authored files (a manifest is authored by the project).
 *
 * `https:` only. Refused: every other scheme (`http:`, `javascript:`,
 * `data:`, `file:`, `blob:` …), credentials in the URL, IP-literal hosts,
 * local names (`localhost`, `.local`, `.internal`, single-label hosts),
 * internationalised hosts (`xn--` or non-ASCII), whitespace and control
 * characters, and anything longer than 500 characters.
 *
 * Normalised form: lowercase host without a trailing dot, no default port,
 * no fragment.
 */
export type UrlCheck =
  | { ok: true; url: string; hostname: string }
  | { ok: false; code: ManifestIssueCode; message: string };

const SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;
const LOCAL_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa', '.lan', '.intranet'];
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

const fail = (code: ManifestIssueCode, message: string): UrlCheck => ({ ok: false, code, message });

export function checkAuthoredUrl(raw: string): UrlCheck {
  if (raw.length > LIMITS.maxUrlLength) {
    return fail('url_too_long', `URLs may be at most ${LIMITS.maxUrlLength} characters.`);
  }
  const scheme = SCHEME_RE.exec(raw)?.[1]?.toLowerCase();
  if (scheme === undefined) {
    return fail('invalid_url', 'Expected an absolute https:// URL.');
  }
  if (scheme !== 'https') {
    return fail('unsafe_url_scheme', `Only https: URLs are allowed; "${scheme}:" is not.`);
  }
  if (!/^https:\/\//i.test(raw)) {
    return fail('invalid_url', 'Expected an absolute https:// URL.');
  }
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x20\x7f\\]/.test(raw)) {
    return fail('invalid_url', 'URLs may not contain spaces, control characters or backslashes.');
  }
  const authority = raw.slice('https://'.length).split(/[/?#]/, 1)[0] ?? '';
  if (/[^\x21-\x7e]/.test(authority)) {
    return fail(
      'url_idn_host',
      'Internationalised host names are not accepted; use the ASCII host name.',
    );
  }
  if (/[^\x21-\x7e]/.test(raw)) {
    return fail('invalid_url', 'Non-ASCII characters in a URL must be percent-encoded.');
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return fail('invalid_url', 'Not a valid URL.');
  }
  if (url.username !== '' || url.password !== '') {
    return fail('url_credentials', 'URLs may not carry a username or password.');
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (hostname === '') return fail('invalid_url', 'The URL has no host.');
  if (hostname.startsWith('[') || IPV4_RE.test(hostname)) {
    return fail('url_ip_literal', 'URLs must name a host, not an IP address.');
  }
  if (
    hostname === 'localhost' ||
    !hostname.includes('.') ||
    LOCAL_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  ) {
    return fail('url_local_host', `"${hostname}" is not a public host name.`);
  }
  if (hostname.split('.').some((label) => label.startsWith('xn--'))) {
    return fail(
      'url_idn_host',
      'Internationalised (punycode) host names are not accepted in a manifest.',
    );
  }
  url.hash = '';
  url.hostname = hostname;
  return { ok: true, url: url.href, hostname };
}

// ------------------------------------------------------------ repositories

const GITHUB_HOSTS = new Set(['github.com', 'www.github.com']);
const GITHUB_OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const GITHUB_REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;

export type RepositoryCheck =
  { ok: true; url: string; key: string } | { ok: false; code: ManifestIssueCode; message: string };

/**
 * A repository URL. GitHub repositories canonicalise to
 * `https://github.com/<owner>/<repo>` (lowercase, no `.git`, no trailing
 * slash) and must name exactly one repository. Other hosts keep their path
 * without a trailing slash or `.git`. `key` is the duplicate-detection form.
 */
export function checkRepositoryUrl(raw: string): RepositoryCheck {
  const base = checkAuthoredUrl(raw);
  if (!base.ok) return base;
  const url = new URL(base.url);
  const segments = url.pathname.split('/').filter((segment) => segment !== '');
  const last = segments.length - 1;
  if (last >= 0) segments[last] = (segments[last] as string).replace(/\.git$/i, '');

  if (GITHUB_HOSTS.has(base.hostname)) {
    const [owner, repo] = segments;
    if (
      segments.length !== 2 ||
      owner === undefined ||
      repo === undefined ||
      !GITHUB_OWNER_RE.test(owner) ||
      !GITHUB_REPO_RE.test(repo) ||
      repo === '.' ||
      repo === '..' ||
      url.search !== ''
    ) {
      return {
        ok: false,
        code: 'invalid_repository_url',
        message: 'A GitHub repository URL must be https://github.com/<owner>/<repo>.',
      };
    }
    const canonical = `https://github.com/${owner.toLowerCase()}/${repo.toLowerCase()}`;
    return { ok: true, url: canonical, key: canonical };
  }

  if (segments.length === 0) {
    return {
      ok: false,
      code: 'invalid_repository_url',
      message: 'A repository URL must name a repository, not only a host.',
    };
  }
  url.pathname = `/${segments.join('/')}`;
  const normalised = url.href;
  return { ok: true, url: normalised, key: normalised.toLowerCase() };
}

// ---------------------------------------------------------------- X profile

const X_HOSTS = new Set([
  'x.com',
  'www.x.com',
  'twitter.com',
  'www.twitter.com',
  'mobile.twitter.com',
]);
const X_HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
const X_RESERVED = new Set([
  'home',
  'i',
  'intent',
  'search',
  'explore',
  'settings',
  'share',
  'messages',
  'notifications',
  'login',
  'signup',
  'tos',
  'privacy',
]);

/** An X profile: `https://x.com/<handle>` (twitter.com accepted), canonicalised to x.com. */
export function checkXProfileUrl(raw: string): UrlCheck {
  const base = checkAuthoredUrl(raw);
  if (!base.ok) return base;
  const url = new URL(base.url);
  const segments = url.pathname.split('/').filter((segment) => segment !== '');
  const handle = segments[0];
  if (
    !X_HOSTS.has(base.hostname) ||
    segments.length !== 1 ||
    handle === undefined ||
    !X_HANDLE_RE.test(handle) ||
    X_RESERVED.has(handle.toLowerCase())
  ) {
    return {
      ok: false,
      code: 'invalid_x_url',
      message: 'officialX must be a profile URL: https://x.com/<handle>.',
    };
  }
  return { ok: true, url: `https://x.com/${handle}`, hostname: 'x.com' };
}

/** The host a manifest's `website` names, without a leading `www.`, for comparison. */
export const comparableHost = (hostname: string): string =>
  hostname
    .toLowerCase()
    .replace(/\.$/, '')
    .replace(/^www\./, '');
