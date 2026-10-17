/**
 * The Arabic description of the value a person has just CHOSEN, rendered under the select.
 *
 * ## WHY THIS EXISTS — a measurement, not a preference
 *
 * Module 0-ب's eight reference tables carry forty-four `descriptionAr` lines the owner wrote herself,
 * and until this component they were MEASURED to reach no screen at all: the api view sent them, the
 * web client typed them, and the only occurrences of the field anywhere in `apps/web` were Playwright
 * fixtures and the type declaration. That is the exact shape the owner refused when she chose
 * description TABLES over i18n keys for the eleven enum members — "keys nothing renders is the shape
 * the enforcement inventory exists to reject." It was already true of the forty-four.
 *
 * ## WHY UNDER THE SELECT, AND ONLY FOR THE SELECTED ROW
 *
 * Her stated reason for the descriptions is the one that decides the placement: "a person who believes
 * his choice changes the system's behaviour, and later finds it does not, stops trusting every list
 * after it." The moment that belief forms is the moment a value is picked, so the description belongs
 * at that moment and about THAT value. Rendering all of a list's descriptions at once would put eight
 * paragraphs on a registration form and be read by nobody, which fails the same way silence does.
 *
 * ## IT IS NEVER A REFUSAL AND NEVER A WARNING
 *
 * `role` is deliberately absent — this is explanatory prose, not a `status` or an `alert`. Three of the
 * eight lists carry a line saying plainly that NOTHING follows from the choice (the «لا يترتّب»
 * disclaimer `reference-tables.spec.ts` enforces), and announcing that through an alert region would
 * make a reassurance read as a problem.
 *
 * ## ARABIC ONLY, STATED RATHER THAN HIDDEN
 *
 * There is one column and it is `descriptionAr`. An English reader sees nothing rather than a
 * transliteration or an untranslated Arabic paragraph under an English label — the same call
 * `legalNameAr` already makes. If an English description is ever wanted it is a column and a migration,
 * not a fallback invented here.
 */
export function SelectedValueDescription({
  rows,
  selectedId,
  field,
}: {
  rows: readonly { id: string; descriptionAr: string | null }[];
  /** The select's current value. Empty string while nothing is chosen. */
  selectedId: string;
  /** The field key, so a test can address this one description among several on a form. */
  field: string;
}) {
  if (selectedId === '') return null;
  const description = rows.find((row) => row.id === selectedId)?.descriptionAr;
  /*
   * NOTHING is rendered when the row carries no description, rather than an em dash or a "no
   * description" line. Every row of all eight lists carries one as of migration
   * `20261130100000_value_descriptions`, which added a `*_description_required` CHECK to each — so an
   * empty line here means a row predating that or a view that stopped sending the field, and inventing
   * placeholder text for it would describe a value nobody has described.
   */
  if (!description) return null;
  return (
    <span
      data-value-description={field}
      lang="ar"
      dir="rtl"
      style={{
        display: 'block',
        fontSize: '0.85rem',
        color: 'var(--ink-muted)',
        marginTop: '0.25rem',
      }}
    >
      {description}
    </span>
  );
}
