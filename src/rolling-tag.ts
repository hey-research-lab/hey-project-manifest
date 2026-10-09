/**
 * HEY's rolling-tag rule: a tag that names a moving build, or one cut by
 * automation on a clock, is never a release HEY counts as a ship.
 *
 * Case-folded: `latest*`, `nightly*`, `*-debug`, exactly `edge`, `canary`,
 * `dev` or `snapshot`; a data word straight before a date
 * (`data-2026-10-01`, `backup-2026.10.01`); or a build stamp, a date with an
 * optional time followed by a commit hash (`backend-202610010354-6802318`);
 * or, since HEY's rule of 2026-10-08, a CI build stamp: a stem of words, a
 * run number of two digits or more and an attempt (`server-image-1234-1`,
 * `docker_412_2`), or `build`/`ci` straight before a number (`build-123`,
 * `ci-456`, `server-build-77`). A version such as `v1.2.0-dev.3`,
 * `docs-latest`, a calendar version (`v2026.10.01`), `release-12-1`,
 * `release-2024-10` or `app-1-4` is not one.
 *
 * Here it only raises a warning: a manifest may name any release, but a
 * rolling one does not pin the declared contracts to a build anyone can find
 * again.
 */
const PREFIXES = ['latest', 'nightly'] as const;
const SUFFIXES = ['-debug'] as const;
const EXACT = ['edge', 'canary', 'dev', 'snapshot'] as const;

const DATE = '(19|20)[0-9]{2}[-_.]?(0[1-9]|1[0-2])[-_.]?(0[1-9]|[12][0-9]|3[01])';
const DATA_WORDS = [
  'data',
  'dataset',
  'datasets',
  'snapshot',
  'snapshots',
  'backup',
  'backups',
  'dump',
  'dumps',
  'export',
  'exports',
  'db',
  'stats',
  'report',
  'reports',
  'docs',
  'daily',
  'auto',
  'automated',
] as const;
const DATA_DATE = new RegExp(`(^|[-_./])(${DATA_WORDS.join('|')})[-_.]?${DATE}`);
const BUILD_STAMP = new RegExp(
  '(19|20)[0-9]{2}(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])([0-2][0-9][0-5][0-9]([0-5][0-9])?)?[-_.][0-9a-f]{7,40}$',
);

/*
 * CI build stamps. A run-and-attempt tag is not one when the stem's last word names a version
 * (`release-12-1`, `rc-10-2`) or when the two numbers are a year and a month (`release-2024-10`):
 * those are a team's releases. A stem with a digit in a word (`server-v2-3-0`) is never a CI stem.
 */
const VERSION_WORDS = [
  'v',
  'ver',
  'version',
  'release',
  'releases',
  'rel',
  'rc',
  'alpha',
  'beta',
  'preview',
  'pre',
  'patch',
  'hotfix',
  'stable',
  'lts',
  'mainnet',
  'testnet',
  'sprint',
  'milestone',
  'phase',
  'update',
] as const;
const CI_RUN = /^[a-z]+([-_][a-z]+)*[-_][0-9]{2,12}[-_][0-9]{1,4}$/;
const CI_RUN_VERSION = new RegExp(`(^|[-_])(${VERSION_WORDS.join('|')})[-_][0-9]+[-_][0-9]+$`);
const CI_RUN_CALENDAR = /[-_](19|20)[0-9]{2}[-_](0?[1-9]|1[0-2])$/;
const CI_BUILD = /^([a-z]+[-_])*(build|ci)[-_.]?[0-9]+([-_][0-9]+)?$/;

function isCiBuildStamp(value: string): boolean {
  return (
    (CI_RUN.test(value) && !CI_RUN_VERSION.test(value) && !CI_RUN_CALENDAR.test(value)) ||
    CI_BUILD.test(value)
  );
}

export function isRollingTag(tag: string | null | undefined): boolean {
  const value = tag?.trim().toLowerCase();
  if (!value) return false;
  return (
    PREFIXES.some((prefix) => value.startsWith(prefix)) ||
    SUFFIXES.some((suffix) => value.endsWith(suffix)) ||
    (EXACT as readonly string[]).includes(value) ||
    DATA_DATE.test(value) ||
    BUILD_STAMP.test(value) ||
    isCiBuildStamp(value)
  );
}
