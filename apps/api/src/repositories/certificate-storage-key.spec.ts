import { describe, expect, it, vi } from 'vitest';
import { DocumentRepository } from './document.repository';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * 🔴 OWNER DECISION 149 §٥ — WHAT DECIDES THAT A CERTIFICATE IS A SECOND DOCUMENT, AND WHAT
 * DECIDES ITS STAMP. Criteria 1-4, as properties of `storeIssuedCertificate` itself.
 *
 * ## WHY THESE ARE HERE AND NOT ONLY IN THE e2e
 *
 * `policy.e2e-spec.ts` proves all four over real HTTP, which is the proof that matters. Two of
 * them, though, cannot FAIL there under the plant that would break them in production:
 *
 *   * **Criterion 4** — «كل نسخة تحمل ختمها بحسب وقت صدورها». The e2e's licence is not under
 *     study, so both rows' stamps are NULL and a plant that copied the PREVIOUS row's stamp onto
 *     the new one would be invisible: NULL inherited from NULL is still NULL. Stamping a real
 *     licence mid-test is not available either — `BrokerLicense` is a db-test-wide SINGLETON and
 *     that file's last test is the one that owns moving it. Here the previous row's stamp is a
 *     value the test chooses, so inheritance is observable.
 *
 *   * **Criterion 3's mechanism** — the existing row is RETURNED, not updated. The e2e proves the
 *     row did not change; this proves no write was even attempted, which is the difference
 *     between «nothing changed» and «nothing was asked to change».
 *
 * ⚠️ These are UNIT assertions over a stubbed client, so they prove the query this repository
 * BUILDS and not what Postgres does with it. That is deliberate and is the half the e2e cannot
 * see; neither file is sufficient alone.
 */

type Built = {
  repository: DocumentRepository;
  findFirst: ReturnType<typeof vi.fn>;
  documentCreate: ReturnType<typeof vi.fn>;
  documentUpdate: ReturnType<typeof vi.fn>;
  contentCreate: ReturnType<typeof vi.fn>;
};

/**
 * The first argument a mock was called with, as a typed record.
 *
 * `vi.fn().mock.calls` is `any[][]`, and reading `.where` / `.data` straight off it is member
 * access on `any` — which this project's eslint refuses, rightly: an `any` here would let a
 * renamed field pass as `undefined` and every assertion below would quietly test nothing.
 */
function firstArg<K extends string>(
  fn: ReturnType<typeof vi.fn>,
  key: K,
): Record<string, unknown> {
  const calls = fn.mock.calls as unknown as Record<string, unknown>[][];
  expect(calls.length, 'the mock was never called').toBeGreaterThan(0);
  const arg = calls[0][0];
  const value = arg[key];
  expect(value, `the call carried no ${key}`).toBeDefined();
  return value as Record<string, unknown>;
}

/**
 * `findFirst` answers the IDENTITY lookup first and the «latest copy» lookup second, in the order
 * the repository asks them. A queue rather than one value, so a test can say «no match, but there
 * IS a previous copy» — which is the whole subject below.
 */
function built(findFirstResults: unknown[]): Built {
  const queue = [...findFirstResults];
  const findFirst = vi.fn().mockImplementation(() => {
    return Promise.resolve(queue.length ? queue.shift() : null);
  });
  const documentCreate = vi
    .fn()
    .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'new-doc', ...data }),
    );
  const documentUpdate = vi.fn().mockResolvedValue({
    id: 'new-doc',
    storageRef: 'db:documentContent/new-doc',
  });
  const contentCreate = vi.fn().mockResolvedValue({});

  const tx = {
    document: { create: documentCreate, update: documentUpdate },
    documentContent: { create: contentCreate },
  };
  const prisma = {
    client: {
      document: { findFirst },
      $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  } as unknown as PrismaService;

  return {
    repository: new DocumentRepository(prisma),
    findFirst,
    documentCreate,
    documentUpdate,
    contentCreate,
  };
}

const INPUT = {
  policyId: 'policy-1',
  fileName: 'certificate-of-insurance-policy-1-AR.pdf',
  uploadedByUserId: 'user-1',
  bytes: Buffer.from('%PDF-1.4 pretend'),
  contentType: 'application/pdf',
  sha256: 'a'.repeat(64),
  issuedFactsSha256: 'b'.repeat(64),
  issuedUnderStudyLicenseId: null as string | null,
};

describe('OWNER DECISION 149 — the key that decides whether a certificate is a second document', () => {
  it('criterion 1 — the identity lookup is keyed on the FACTS digest, never on the PDF digest', async () => {
    const b = built([]);
    await b.repository.storeIssuedCertificate(INPUT);

    const where = firstArg(b.findFirst, 'where');
    expect(where.policyId).toBe('policy-1');
    expect(where.category).toBe('CERTIFICATE_OF_INSURANCE');
    expect(where.fileName).toBe(INPUT.fileName);
    expect(
      where.content,
      'the identity lookup does not consult the facts digest — a changed certificate would be ' +
        'mistaken for the old one and never stored (decision 149 §٥ criterion 2)',
    ).toEqual({ is: { issuedFactsSha256: INPUT.issuedFactsSha256 } });

    /*
     * ⛔ AND NOT THE BYTES. Decision 149 §٤ rules the PDF digest out by name, because the render
     * is not byte-stable — keying on it produced two rows for two downloads of one certificate,
     * which is the defect message 44 shipped and its e2e caught.
     */
    expect(
      JSON.stringify(where),
      'the identity lookup consults the PDF digest, which identifies the RENDER and not the document',
    ).not.toContain(INPUT.sha256);
  });

  it('criterion 3 — an existing copy is RETURNED, and nothing is written at all', async () => {
    const existing = { id: 'first-copy', fileName: INPUT.fileName };
    const b = built([existing]);

    const got = await b.repository.storeIssuedCertificate(INPUT);

    expect(got).toBe(existing);
    expect(
      b.documentCreate,
      'a second row was created for a certificate that had not changed — criterion 1',
    ).not.toHaveBeenCalled();
    expect(
      b.documentUpdate,
      'the FIRST copy was written to — «النسخة الأولى لا تُعدَّل» (criterion 3)',
    ).not.toHaveBeenCalled();
    expect(
      b.contentCreate,
      'the first copy’s bytes were rewritten — criterion 3',
    ).not.toHaveBeenCalled();
  });

  it('criterion 2 — a changed certificate is chained BESIDE the previous copy, not over it', async () => {
    // No identity match, but a previous copy exists: the decision's own case.
    const b = built([null, { id: 'first-copy', versionNumber: 1 }]);

    await b.repository.storeIssuedCertificate(INPUT);

    const data = firstArg(b.documentCreate, 'data');
    expect(
      data.versionNumber,
      'the second copy did not advance the version',
    ).toBe(2);
    expect(
      data.previousVersionId,
      '«بجانب القديمة» is not recorded — the two copies are unrelated rows a reader must order by date',
    ).toBe('first-copy');
    expect(data.deletionLocked).toBe(true);
  });

  it('criterion 2 — the FIRST copy of a policy opens the chain rather than pointing at nothing', async () => {
    const b = built([null, null]);

    await b.repository.storeIssuedCertificate(INPUT);

    const data = firstArg(b.documentCreate, 'data');
    expect(data.versionNumber).toBe(1);
    expect(data.previousVersionId).toBeNull();
  });

  it('🔴 criterion 4 — each copy carries the stamp of ITS OWN issuance, never the previous copy’s', async () => {
    /*
     * The previous copy was issued while the renewal WAS under study and carries a stamp. This
     * issuance is not: `assertMayPractise` answered NULL, and that is what must be written.
     *
     * A certificate that inherited the stamp beside it would tell an inspector the office was
     * under study on a day it was not — and the e2e cannot catch it, because there both values
     * are NULL and inheritance is invisible.
     */
    const b = built([
      null,
      {
        id: 'first-copy',
        versionNumber: 1,
        issuedUnderStudyLicenseId: 'lic-under-study',
      },
    ]);

    await b.repository.storeIssuedCertificate({
      ...INPUT,
      issuedUnderStudyLicenseId: null,
    });

    const data = firstArg(b.documentCreate, 'data');
    expect(
      data.issuedUnderStudyLicenseId,
      'the new certificate INHERITED the previous copy’s renewal stamp — decision 149 §٥ ' +
        'criterion 4, and decision 124’s «stamped at creation, never derived»',
    ).toBeNull();
  });

  it('🔴 criterion 4, the other direction — a stamp earned at THIS issuance is written', async () => {
    // Non-vacuity: the test above passes trivially if the column is never written at all.
    const b = built([
      null,
      { id: 'first-copy', versionNumber: 1, issuedUnderStudyLicenseId: null },
    ]);

    await b.repository.storeIssuedCertificate({
      ...INPUT,
      issuedUnderStudyLicenseId: 'lic-under-study-now',
    });

    const data = firstArg(b.documentCreate, 'data');
    expect(
      data.issuedUnderStudyLicenseId,
      'a certificate issued while the renewal was under study was stored WITHOUT its stamp',
    ).toBe('lic-under-study-now');
  });

  it('the facts digest is stored beside the bytes, so a later issuance has something to compare', async () => {
    const b = built([null, null]);

    await b.repository.storeIssuedCertificate(INPUT);

    const data = firstArg(b.contentCreate, 'data');
    expect(data.issuedFactsSha256).toBe(INPUT.issuedFactsSha256);
    expect(data.sha256).toBe(INPUT.sha256);
    expect(
      data.issuedFactsSha256,
      'the two digests are the same value — they answer different questions and conflating them ' +
        'is exactly the defect decision 149 §٤ rules out',
    ).not.toBe(data.sha256);
  });
});
