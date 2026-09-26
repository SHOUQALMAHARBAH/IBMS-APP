import type { PermissionCatalogueEntry } from './role-admin-api';

/**
 * The shape of the permission matrix, DERIVED from the catalogue rather than hard-coded.
 *
 * The owner's requirement: five states (Full / View / Edit / Create / Delete) only where a permission
 * is genuinely CRUD-shaped, a plain on/off toggle everywhere else, grouped by module.
 *
 * THE RULE, stated so it can be checked rather than trusted:
 *
 *   A permission's FAMILY is its code minus the final segment — `customer.360-view.read` belongs to
 *   family `customer.360-view`. A family earns the five-state control when TWO OR MORE of its codes
 *   end in a CRUD verb from {read, create, update, delete, view, manage}. Everything else is a
 *   toggle.
 *
 * Measured on the live catalogue: 211 codes, 12 modules, 19 qualifying families covering 51 codes,
 * 160 toggles — up from 186 / 13 / 27 / 159, mostly because four-action Phase 1 split four umbrellas
 * into sets that then QUALIFIED as families. Those numbers are asserted by a test against the real
 * catalogue, so ADDING A PERMISSION FAILS THE TEST rather than silently drifting the screen — which
 * is the point of deriving this at render time. The owner's notes said ~58 of 167; the proportions
 * changed with the catalogue and the rule did not.
 */
/**
 * `deactivate` counts as the DELETE action, because the owner's rule is that delete MEANS
 * deactivate — a record retires rather than disappearing wherever something points at it. Leaving it
 * out put the fourth action of the department/branch pilot in a separate toggle beside its own row,
 * which is the four-action scheme rendered as three-plus-one.
 */
const CRUD_VERBS = new Set([
  'read',
  'create',
  'update',
  'delete',
  'deactivate',
  'view',
  'manage',
]);

/** The minimum number of CRUD-verb codes that makes a family genuinely CRUD-shaped. One verb is a
 *  single action with a verb-like name, not a family with sub-states. */
const MIN_CRUD_CODES = 2;

export function familyOf(code: string): string {
  const parts = code.split('.');
  return parts.length > 1 ? parts.slice(0, -1).join('.') : code;
}

export function verbOf(code: string): string {
  return code.split('.').slice(-1)[0] ?? code;
}

export interface CrudRow {
  kind: 'crud';
  family: string;
  /** Verb -> code, for the verbs this family actually has. A family with read/create/update but no
   *  delete shows four states, not five with one that grants nothing. */
  codes: Record<string, string>;
}

export interface ToggleRow {
  kind: 'toggle';
  code: string;
  description: string;
}

export type MatrixRow = CrudRow | ToggleRow;

export interface MatrixModule {
  module: string;
  rows: MatrixRow[];
  /** Every code in this module, for the "N of M" counts the collapsed view shows. */
  codes: string[];
}

/**
 * Group the catalogue into modules, and within each module into five-state families and toggles.
 *
 * Order is stable and derived: modules alphabetically, CRUD families before toggles (they are the
 * dense rows and belong at the top of a module), then by family/code. Nothing here depends on a
 * hand-maintained list, so a new permission appears in the right place without an edit.
 */
export function buildMatrix(catalogue: readonly PermissionCatalogueEntry[]): MatrixModule[] {
  const byModule = new Map<string, PermissionCatalogueEntry[]>();
  for (const entry of catalogue) {
    const list = byModule.get(entry.module) ?? [];
    list.push(entry);
    byModule.set(entry.module, list);
  }

  const modules: MatrixModule[] = [];
  // `moduleName`, not `module`: Next forbids assigning to `module` (it shadows the CommonJS global)
  // and the rule is an error, not a warning.
  for (const [moduleName, entries] of [...byModule.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const families = new Map<string, PermissionCatalogueEntry[]>();
    for (const entry of entries) {
      const family = familyOf(entry.code);
      const list = families.get(family) ?? [];
      list.push(entry);
      families.set(family, list);
    }

    const crud: CrudRow[] = [];
    const toggles: ToggleRow[] = [];
    for (const [family, members] of families) {
      const crudMembers = members.filter((m) => CRUD_VERBS.has(verbOf(m.code)));
      if (crudMembers.length >= MIN_CRUD_CODES) {
        crud.push({
          kind: 'crud',
          family,
          codes: Object.fromEntries(crudMembers.map((m) => [verbOf(m.code), m.code])),
        });
        // A family can qualify AND still hold non-CRUD codes (`incident.classify` beside
        // `incident.read`/`.create`). Those stay toggles — they are not sub-states of anything.
        for (const m of members.filter((m) => !CRUD_VERBS.has(verbOf(m.code)))) {
          toggles.push({ kind: 'toggle', code: m.code, description: m.description });
        }
      } else {
        for (const m of members) {
          toggles.push({ kind: 'toggle', code: m.code, description: m.description });
        }
      }
    }

    crud.sort((a, b) => a.family.localeCompare(b.family));
    toggles.sort((a, b) => a.code.localeCompare(b.code));
    modules.push({
      module: moduleName,
      rows: [...crud, ...toggles],
      codes: entries.map((e) => e.code).sort(),
    });
  }
  return modules;
}

/** How many of a module's codes this role holds — what the collapsed view shows per module. */
export function grantedInModule(module: MatrixModule, granted: ReadonlySet<string>): number {
  return module.codes.reduce((n, code) => (granted.has(code) ? n + 1 : n), 0);
}

/** Every code a CRUD row covers, so "Full" can be one click. */
export function codesOfRow(row: MatrixRow): string[] {
  return row.kind === 'crud' ? Object.values(row.codes) : [row.code];
}
