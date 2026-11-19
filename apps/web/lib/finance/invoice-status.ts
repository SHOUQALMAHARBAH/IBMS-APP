import type { TranslationKey } from '../i18n/translations';
import type { InvoiceStatus } from './invoice-api';

/**
 * The six invoice states, each with its label key. ONE map, because two screens now render it.
 *
 * It lived privately inside `components/policy/FinanceSection.tsx`, whose own comment records
 * why it was written: *the invoice status rendered as the raw enum token (`INVOICED`)*. **The
 * KPI dashboard does exactly that today** — `/kpi-dashboard`'s finance card prints
 * `invoicesByStatus`, and the words to fix it already shipped one directory away. Decision 153
 * §M1 is that sighting, and it is this repository's own recurring finding: the labels exist and
 * the screens do not use them.
 *
 * ⛔ PROMOTED, NEVER COPIED, for the reason `lib/opportunity/opportunity-status.ts` states.
 *
 * A TOTAL `Record`: a seventh member without a label is a compile error rather than a token on
 * screen.
 */
export const INVOICE_STATUS_LABEL_KEY: Record<InvoiceStatus, TranslationKey> = {
  INVOICED: 'financeInvoiceStatusInvoiced',
  COLLECTED: 'financeInvoiceStatusCollected',
  RECONCILED: 'financeInvoiceStatusReconciled',
  REMITTED: 'financeInvoiceStatusRemitted',
  EXCEPTION_RAISED: 'financeInvoiceStatusExceptionRaised',
  EXCEPTION_RESOLVED: 'financeInvoiceStatusExceptionResolved',
};
