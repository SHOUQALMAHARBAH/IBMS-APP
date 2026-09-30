/**
 * The mapping between a permission CODE and its dictionary KEY, in one place and in both directions.
 *
 * A permission code carries dots and hyphens and is not a valid identifier, so it is prefixed and used
 * VERBATIM as a quoted dictionary key rather than transformed:
 *
 *     'customer.360-view.read'  ->  'perm:customer.360-view.read'
 *
 * ## Why verbatim, and not camel-cased
 *
 * The coverage guard has to walk from a catalogue code to its key and back, so the mapping must be
 * mechanical in both directions. Every transformation that produces a nicer-looking key is lossy:
 * stripping separators makes `customer.360-view.read` and `customer.360.view.read` the same key, and a
 * guard walking catalogue → key would then pair a code with the wrong sentence. Verbatim cannot collide.
 *
 * ## And it fails in the right direction on a rename
 *
 * Rename a code and its key changes with it: the old line becomes an orphan and the new code becomes
 * missing, and the coverage guard names both. A guard matching on a PATTERN — a last segment, a prefix, a
 * fuzzy compare — would keep pairing the renamed code with the stale sentence and report nothing, which is
 * exactly the quiet failure this shape is chosen to prevent.
 */
export const PERMISSION_KEY_PREFIX = 'perm:';

/** Code -> dictionary key. */
export function permissionDescriptionKey(code: string): string {
  return `${PERMISSION_KEY_PREFIX}${code}`;
}

/** Dictionary key -> code, or `null` if the key is not a permission description. */
export function codeFromPermissionKey(key: string): string | null {
  return key.startsWith(PERMISSION_KEY_PREFIX)
    ? key.slice(PERMISSION_KEY_PREFIX.length)
    : null;
}
