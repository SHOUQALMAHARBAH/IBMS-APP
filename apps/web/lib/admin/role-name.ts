/**
 * The machine name of a role is GENERATED, never typed.
 *
 * Owner decision, 2026-09-24: an office administrator is a broker, not a programmer, and this field
 * is immutable and appears in every audit row that mentions the role. Asking her to invent it makes
 * a permanent identifier out of a guess. Measured before the decision: the API accepts any string of
 * 1–100 characters, and a role was created whose machine name was `"دور جديد 1790245740959"` — an
 * identifier nobody reading the audit log could tie back to a role.
 *
 * So it is derived from the English name (now required, precisely because it is the source), and it
 * must stay READABLE: `CLAIMS_TRIAGE_DESK`, not a token and not a uuid.
 */

/** The longest the API accepts (`@Length(1, 100)` on `CreateRoleDto.name`). */
const MAX_LENGTH = 100;

/**
 * At least two Latin letters, or the form refuses.
 *
 * The threshold is two rather than one because a single letter is not a name anybody can read back
 * to a role, and it is letters rather than characters because the failures that matter all produce
 * digits or nothing: an Arabic English-name field folds to the empty string, `"2024"` keeps its
 * digits and says nothing, `"!!!"` collapses to nothing at all. `"HR"` is two letters and is
 * genuinely readable, so it passes.
 */
const MIN_LETTERS = 2;

/**
 * Fold the English name into a machine name.
 *
 * NFKD first so accented Latin survives as Latin (`Café` → `CAFE`) rather than being discarded;
 * everything outside `A–Z0–9` becomes a single underscore; leading and trailing underscores are
 * trimmed so punctuation at either end does not leave a dangling one.
 *
 * Returns the fold even when it is unusable — deciding that is `machineNameProblem`'s job, so the
 * screen can show what WOULD be stored while the name is still being typed.
 */
export function toMachineName(englishName: string): string {
  return englishName
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, MAX_LENGTH)
    .replace(/_+$/, '');
}

/** Why this English name cannot produce a machine name, or `null` when it can. */
export type MachineNameProblem = 'empty' | 'unreadable';

/**
 * The refusal. An immutable string in the audit log that no human can read back to a role is worse
 * than an error message, so the form refuses to save rather than storing one.
 */
export function machineNameProblem(englishName: string): MachineNameProblem | null {
  if (englishName.trim().length === 0) return 'empty';
  const letters = (toMachineName(englishName).match(/[A-Z]/g) ?? []).length;
  return letters < MIN_LETTERS ? 'unreadable' : null;
}
