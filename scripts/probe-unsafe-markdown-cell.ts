/**
 * THROWAWAY PROBE. Reintroduces the exact defect CodeQL flagged as alert 3 (high) so that making the
 * `CodeQL` check required on main can be proven to BLOCK a merge, rather than only proven not to block a
 * clean one. Delete this branch once the measurement is recorded — it must never reach main.
 *
 * The defect: escaping `|` for a markdown table cell without escaping `\` first, so a backslash
 * immediately before a pipe becomes an escaped backslash followed by a live pipe and the cell ends early.
 */
export function markdownCellUnsafe(text: string): string {
  return text.replace(/\|/g, '\\|');
}
