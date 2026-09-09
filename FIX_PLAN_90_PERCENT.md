# 90% Completeness Fix Campaign

**Objective:** Fix critical gaps to achieve a production-ready system.

## Priority 1: Commission Reconciliation (3.1 P0)

**Issue:** Two sources of truth for commission
- `Invoice.commissionDeducted` from placed quotation's rate
- `CommissionLedgerEntry.amount` from governed `CommissionAgreement`
- These can diverge → inconsistent reporting

**Strategy:**
1. `CommissionLedgerEntry` becomes source of truth (already used by `buildCommissionRollup`)
2. Refactor `InvoiceService.create()` to populate `commissionDeducted` from the policy's eventual governed commission
3. Create `calculateEffectiveCommission()` helper to derive amount from either:
   - If `Policy` has a `CommissionAgreement`: use governed rate
   - Otherwise: use quotation rate (fallback)
4. Add validation: commission from both sources must match or warn in audit

**Files to modify:**
- `apps/api/src/modules/finance/finance.config.ts` - add helper
- `apps/api/src/modules/finance/invoice.service.ts` - use governed commission
- `apps/api/src/repositories/commission.repository.ts` - query effective rates
- `apps/api/src/modules/finance/financial-report.repository.ts` - ensure consistency

---

## Priority 2: Refund Lifecycle Completion (3.2 P1)

**Issue:** No standalone refund raise, no disbursement path

**Build:**
1. `POST /refunds` - standalone raise endpoint
   - `refund.raise` permission required
   - Create `Refund` row with status `RAISED`
   - Optional: link to `Invoice` (overpayment) or `Endorsement` (cancellation credit)
   - Audit: CREATE with customer/amount/reason

2. `POST /refunds/:id/approve` - maker/checker gate
   - `refund.approve` permission
   - Validate maker ≠ raiser
   - Status: `RAISED` → `APPROVED`

3. `POST /refunds/:id/disburse` - payment execution
   - `refund.disburse` permission
   - Stamp `paidAt: now()`
   - Book `ClientFundsLedgerEntry` OUT movement
   - Status: `APPROVED` → `DISBURSED`
   - Integrate with `PaymentChannel` for customer account

**Files to create:**
- `apps/api/src/modules/finance/refund.controller.ts`
- `apps/api/src/modules/finance/refund.service.ts`

**Files to modify:**
- `packages/db/prisma/schema.prisma` - add refund endpoints
- `apps/api/src/repositories/refund.repository.ts` - add query helpers

---

## Priority 3: Partial Payments (3.4 P1)

**Issue:** Only full invoice payment supported; no installment tracking

**Build:**
1. Relax `Receipt.invoiceId @unique` to allow multiple receipts per invoice
2. Add index for efficient querying: `@@index([invoiceId, receivedAt])`
3. Update invoice status logic:
   - `OUTSTANDING` if `sum(receipts) < totalAmount`
   - `FULLY_COLLECTED` if `sum(receipts) >= totalAmount`
   - `OVERPAID` if `sum(receipts) > totalAmount` → auto-create `Refund`

4. Update reporting readers:
   - `ReceivablesAgeingReport` - use `sum(receipts)`, not existence check
   - `buildReceivablesAgeing()` - sum by invoice instead of binary collected/not

**Files to modify:**
- `packages/db/prisma/schema.prisma` - remove Receipt.invoiceId @unique
- `apps/api/src/modules/finance/collection.service.ts` - allow multiple receipts
- `apps/api/src/modules/finance/finance.config.ts` - update ageing calculation
- `apps/api/src/repositories/financial-report.repository.ts` - sum receipts

---

## Priority 4: Missing P2002 Handlers (10.2 P2)

**Issue:** Double-create on unique constraints surface as 500, not 409

**Fix:** Add Prisma P2002 (unique constraint) handling to:
- `ProspectRepository.create()` - catch lead double-conversion
- `CustomerRepository.create()` - catch prospect double-conversion

**Files to modify:**
- `apps/api/src/repositories/prospect.repository.ts`
- `apps/api/src/repositories/customer.repository.ts`

---

## Priority 5: CI Test Isolation (1.1 P0)

**Issue:** Shared cumulative test DB → timeouts, flakes

**Strategy:** Per-file DB isolation via template
- Create template DB once
- Each spec: `CREATE DATABASE db-test-file-1 TEMPLATE template_db`
- Teardown: `DROP DATABASE`

**Files to modify:**
- `apps/api/test/vitest-e2e.config.ts` - setup/teardown hooks
- `apps/api/test/utils/create-test-app.ts` - use per-file DB

---

## Implementation Order

1. **Commission fix** (3.1) - highest correctness impact, no schema change
2. **Refund lifecycle** (3.2) - enables real financial flows
3. **Partial payments** (3.4) - updates reporting accuracy
4. **P2002 handlers** (10.2) - improves error clarity
5. **Test isolation** (1.1) - improves test reliability

---

## Verification Gates Per Fix

- All existing tests pass
- New unit tests for new logic
- E2E tests for integration points
- No regression in reporting/dashboards
- Audit trails complete

---
