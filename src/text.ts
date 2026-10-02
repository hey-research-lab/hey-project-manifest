/**
 * Text that came from a document is untrusted: it may carry terminal escape
 * sequences, bidirectional overrides or simply be very long. These helpers
 * make it safe to put in a message or print.
 */

// C0 and C1 controls (except tab and newline), zero-width characters, bidi overrides and isolates, BOM.
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\x00-\x08\x0b-\x1f\x7f-\x9f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;

/** Remove control, zero-width and bidi-override characters. */
export const stripUnsafe = (text: string): string => text.replace(UNSAFE, '');

/** A short, quoted, escape-free rendering of any value for an issue message. */
export function describe(value: unknown, max = 60): string {
  let rendered: string;
  try {
    rendered = JSON.stringify(value) ?? String(value);
  } catch {
    rendered = String(value);
  }
  // JSON.stringify escapes C0 controls; also escape everything outside printable ASCII.
  rendered = rendered.replace(
    /[^\x20-\x7e]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
  return rendered.length > max ? `${rendered.slice(0, max - 1)}…` : rendered;
}
