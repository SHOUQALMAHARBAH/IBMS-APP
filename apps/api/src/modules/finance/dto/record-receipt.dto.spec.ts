import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { RecordReceiptDto } from './record-receipt.dto';

function validate(payload: Record<string, unknown>): string[] {
  const dto = plainToInstance(RecordReceiptDto, payload);
  return validateSync(dto).flatMap((e) => Object.values(e.constraints ?? {}));
}

/**
 * `reference` is the idempotency key for the collection endpoint, and it is
 * MANDATORY. That is a deliberate reversal of its original optionality, and
 * this file is the guard on it — the failure it prevents is a client-money
 * double-count, not a validation nicety:
 *
 * `Receipt.invoiceId @unique` was dropped so an invoice can carry instalments.
 * The replacement invariants are a row lock on the parent Invoice and a
 * partial UNIQUE on `(invoiceId, reference) WHERE reference IS NOT NULL`. The
 * lock SERIALISES concurrent writes but does not DEDUPLICATE them, and the
 * partial UNIQUE does not constrain NULLs — so while `reference` was optional,
 * a retried or double-clicked cash instalment wrote a second Receipt AND a
 * second `in` ClientFundsLedgerEntry, overstating client funds, with no
 * exception raised.
 */
describe('RecordReceiptDto.reference is mandatory (client-money duplicate guard)', () => {
  it('rejects a receipt with no reference at all', () => {
    const errors = validate({ amount: '400.000' });
    expect(errors.join(' ')).toMatch(/reference is required/);
  });

  it('rejects an empty or whitespace-only reference', () => {
    for (const reference of ['', '   ']) {
      const errors = validate({ amount: '400.000', reference });
      expect(errors.join(' ')).toMatch(/reference is required/);
    }
  });

  it('accepts a real payment/voucher reference', () => {
    expect(validate({ amount: '400.000', reference: 'TT-99213' })).toEqual([]);
  });

  it('accepts a cash collection — it carries a voucher number like any other', () => {
    // The old justification for optionality was "a cash collection may have
    // none". A broker issues a numbered receipt for cash; that number is the
    // reference, and requiring it is what closes the duplicate hole.
    expect(
      validate({
        amount: '400.000',
        method: 'cash',
        reference: 'CASH-BOOK-00412',
      }),
    ).toEqual([]);
  });

  it('still caps the reference length', () => {
    const errors = validate({ amount: '400.000', reference: 'x'.repeat(121) });
    expect(errors.join(' ')).toMatch(/reference is required|121|120/);
  });
});
