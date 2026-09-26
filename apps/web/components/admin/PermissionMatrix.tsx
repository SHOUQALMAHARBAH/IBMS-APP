'use client';

import { useMemo, useState } from 'react';
import {
  buildMatrix,
  codesOfRow,
  grantedInModule,
  type MatrixRow,
} from '../../lib/admin/permission-matrix';
import type { PermissionCatalogueEntry } from '../../lib/admin/role-admin-api';
import { useLanguage } from '../../lib/i18n/language-context';
import { describePermission } from '../../lib/admin/permission-descriptions';
import {
  matrixCountStyle,
  matrixModuleStyle,
  matrixRowStyle,
  matrixSearchStyle,
  matrixSummaryStyle,
  matrixVerbStyle,
  matrixDescriptionStyle,
  matrixSectionAllStyle,
} from './admin.styles';

/**
 * The permission matrix, shared by role CREATION and role editing.
 *
 * One component because choosing what a role may do is the same act whether the role exists yet or
 * not — and because the collapsed view, the search, and the five-state rows are the parts most
 * likely to drift if written twice.
 *
 * ## What a person sees first
 *
 * 186 permissions do not fit on a screen and nobody reads 159 lines to answer "what can this role
 * do?". So the matrix opens COLLAPSED to the 12 modules, each showing how many of its permissions
 * this role holds (`الالتزام والمخاطر — 3 / 21`), above a permanent total. A module expands to its
 * rows; search filters across every module at once and expands what matches, so finding one
 * permission never requires knowing which module owns it.
 *
 * ## Five states, and only where they mean something
 *
 * The shape comes from `buildMatrix`, which derives it from the catalogue at render time — the rule
 * is two-or-more CRUD verbs in a family, and `permission-matrix.test.ts` pins the resulting shape
 * against the live 186 codes so adding a permission fails a test instead of silently changing this
 * screen. A family that has read/create/update and no delete shows three states, not five with one
 * that grants a code the catalogue does not contain.
 */
export function PermissionMatrix({
  catalogue,
  selected,
  onChange,
  disabled = false,
}: {
  catalogue: readonly PermissionCatalogueEntry[];
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  disabled?: boolean;
}) {
  const { t, language } = useLanguage();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  const modules = useMemo(() => buildMatrix(catalogue), [catalogue]);
  const normalisedQuery = query.trim().toLowerCase();

  const visible = useMemo(() => {
    if (!normalisedQuery) return modules;
    return modules
      .map((m) => ({
        ...m,
        rows: m.rows.filter((row) =>
          codesOfRow(row).some((code) => code.toLowerCase().includes(normalisedQuery)),
        ),
      }))
      .filter((m) => m.rows.length > 0);
  }, [modules, normalisedQuery]);

  const totalGranted = catalogue.reduce((n, p) => (selected.has(p.code) ? n + 1 : n), 0);

  /** Stored description per code, so the explanation line can be looked up without rescanning. */
  const stored = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of catalogue) map.set(entry.code, entry.description);
    return map;
  }, [catalogue]);

  /** The line under a checkbox. `null` when there is nothing honest to show yet. */
  const explain = (code: string) => describePermission(code, language, stored.get(code));

  function apply(codes: string[], on: boolean) {
    const next = new Set(selected);
    for (const code of codes) {
      if (on) next.add(code);
      else next.delete(code);
    }
    onChange(next);
  }

  function renderRow(row: MatrixRow) {
    if (row.kind === 'toggle') {
      const line = explain(row.code);
      return (
        <label key={row.code} style={matrixRowStyle}>
          <input
            type="checkbox"
            data-code={row.code}
            checked={selected.has(row.code)}
            disabled={disabled}
            onChange={(e) => apply([row.code], e.target.checked)}
          />
          <span>
            <code>{row.code}</code>
            {/* One short line BENEATH the name, not appended to it: the owner's finding is that a
                code is not an explanation, and a description crammed onto the same line after an
                em-dash reads as part of the identifier. */}
            {line ? (
              <span style={matrixDescriptionStyle} data-describes={row.code}>
                {line}
              </span>
            ) : null}
          </span>
        </label>
      );
    }

    const all = codesOfRow(row);
    const every = all.every((c) => selected.has(c));
    return (
      <div key={row.family} style={matrixRowStyle} data-crud-family={row.family}>
        <code>{row.family}</code>
        <span style={matrixVerbStyle}>
          {/* Full is a convenience over the same codes, never a separate grant — so a role can never
              hold "full" while missing one of the codes it is supposed to mean. */}
          <label>
            <input
              type="checkbox"
              data-verb="full"
              checked={every}
              disabled={disabled}
              onChange={(e) => apply(all, e.target.checked)}
            />
            {t('roleVerbFull')}
          </label>
          {Object.entries(row.codes).map(([verb, code]) => (
            <label key={code} title={explain(code) ?? undefined}>
              <input
                type="checkbox"
                data-code={code}
                data-verb={verb}
                checked={selected.has(code)}
                disabled={disabled}
                onChange={(e) => apply([code], e.target.checked)}
              />
              {t(VERB_LABEL[verb] ?? 'roleVerbOther')}
            </label>
          ))}
        </span>
        {/* Each state of a CRUD family means something different to a person, so each gets its own
            line rather than one line for the family. Rendered only where a description exists, so a
            missing line is visibly missing instead of silently absent. */}
        {Object.values(row.codes).some((code) => explain(code)) ? (
          <span style={{ flexBasis: '100%' }}>
            {Object.entries(row.codes).map(([verb, code]) => {
              const line = explain(code);
              return line ? (
                <span key={code} style={matrixDescriptionStyle} data-describes={code}>
                  {t(VERB_LABEL[verb] ?? 'roleVerbOther')}: {line}
                </span>
              ) : null;
            })}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div data-permission-matrix>
      <p style={matrixSummaryStyle} data-matrix-summary>
        {t('roleMatrixSummary', { granted: totalGranted, total: catalogue.length })}
      </p>

      <label style={{ display: 'block' }}>
        <span>{t('roleMatrixSearchLabel')}</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={matrixSearchStyle}
          data-matrix-search
        />
      </label>

      {visible.length === 0 ? <p role="status">{t('roleMatrixNoMatch')}</p> : null}

      {visible.map((moduleEntry) => {
        // A search result opens what it matched: making someone expand a module to see the row they
        // just searched for is the same as not finding it.
        const isOpen = normalisedQuery.length > 0 || open.has(moduleEntry.module);
        return (
          <details
            key={moduleEntry.module}
            open={isOpen}
            style={matrixModuleStyle}
            data-module={moduleEntry.module}
            onToggle={(e) => {
              if (normalisedQuery) return;
              const next = new Set(open);
              if ((e.currentTarget as HTMLDetailsElement).open) next.add(moduleEntry.module);
              else next.delete(moduleEntry.module);
              setOpen(next);
            }}
          >
            <summary>
              {t(MODULE_LABEL[moduleEntry.module] ?? 'roleModuleOther')}
              <span style={matrixCountStyle} data-module-count={moduleEntry.module}>
                {grantedInModule(moduleEntry, selected)} / {moduleEntry.codes.length}
              </span>
            </summary>
            {/* SECTION-level select-all, which the owner expected the row-level "الكل" to be. It
                covers every permission in the section, five-state families included.
                INSIDE the section rather than in its `summary`: `summary` is itself an interactive
                disclosure control, so a checkbox within it nests interactive controls — axe flagged
                76 nodes for exactly that, and it also made the disclosure's own click target depend
                on where the label happened to end. */}
            <label style={matrixSectionAllStyle} data-select-all-label={moduleEntry.module}>
              <input
                type="checkbox"
                data-select-all={moduleEntry.module}
                checked={grantedInModule(moduleEntry, selected) === moduleEntry.codes.length}
                disabled={disabled}
                ref={(el) => {
                  if (!el) return;
                  // Partly granted reads as neither on nor off, which is the truth and stops the box
                  // from claiming the section is empty when it is half full.
                  const granted = grantedInModule(moduleEntry, selected);
                  el.indeterminate = granted > 0 && granted < moduleEntry.codes.length;
                }}
                onChange={(e) => apply(moduleEntry.codes, e.target.checked)}
              />
              {t('roleSelectAllInSection')}
            </label>
            {moduleEntry.rows.map(renderRow)}
          </details>
        );
      })}
    </div>
  );
}

/** Verb -> label key. A verb with no entry falls back to a generic label rather than rendering the
 *  raw English word on an Arabic page. */
const VERB_LABEL: Record<string, 'roleVerbView' | 'roleVerbCreate' | 'roleVerbEdit' | 'roleVerbDelete' | 'roleVerbDeactivate' | 'roleVerbManage'> = {
  read: 'roleVerbView',
  view: 'roleVerbView',
  create: 'roleVerbCreate',
  update: 'roleVerbEdit',
  delete: 'roleVerbDelete',
  // Named for what it does to the record, not for the word in the code.
  deactivate: 'roleVerbDeactivate',
  manage: 'roleVerbManage',
};

/** The 12 `Permission.module` values, named in both languages. Keyed by the stored value so a new
 *  module shows a generic heading rather than crashing. */
const MODULE_LABEL: Record<string, 'roleModuleAdmin' | 'roleModuleClaims' | 'roleModuleCommercial' | 'roleModuleCompliance' | 'roleModuleCustomer' | 'roleModuleCustomerService' | 'roleModuleFinance' | 'roleModuleInsuranceOps' | 'roleModuleReporting' | 'roleModulePdpl' | 'roleModuleSla' | 'roleModuleSupporting'> = {
  admin: 'roleModuleAdmin',
  claims: 'roleModuleClaims',
  'commercial-front-office': 'roleModuleCommercial',
  'compliance-risk': 'roleModuleCompliance',
  customer: 'roleModuleCustomer',
  'customer-service': 'roleModuleCustomerService',
  finance: 'roleModuleFinance',
  'insurance-operations': 'roleModuleInsuranceOps',
  'management-reporting': 'roleModuleReporting',
  pdpl: 'roleModulePdpl',
  sla: 'roleModuleSla',
  'supporting-operations': 'roleModuleSupporting',
};
