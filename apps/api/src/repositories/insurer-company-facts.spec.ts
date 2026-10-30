import { describe, expect, it } from 'vitest';
import {
  officeMayEditCompanyFacts,
  resolveInsurerCompanyFacts,
  type InsurerCompanyFactSources,
} from './insurer-identity';

/**
 * MODULE 0-ب ITEM (e), DECISION 63 — THE COMPANY-FACT RESOLVER.
 *
 * A pure spec, for the reason the licence-standing one gives: db-test holds 618 `Insurer` rows and
 * ZERO of them are linked to a registered company, because linking is an act a person performs and
 * no migration guesses at it. An e2e over that database cannot reach the branch the whole decision is
 * about.
 */

function sources(
  over: Partial<InsurerCompanyFactSources> = {},
): InsurerCompanyFactSources {
  return {
    insurerMaster: null,
    insuranceCompany: null,
    legalName: 'Office Typed Insurance Co.',
    legalNameAr: 'شركة تأمين كتبها المكتب',
    companyPhone: '+962-6-111-1111',
    companyEmail: 'office-typed@example.test',
    companyWebsite: 'https://office-typed.test',
    companyCorrespondenceAddress: 'An address the office typed',
    ...over,
  };
}

const MASTER = { legalName: 'AIG Jordan', legalNameAr: 'إي آي جي الأردن' };

const COMPANY = {
  legalName: 'Registered Insurance Company',
  legalNameAr: 'شركة التأمين المسجّلة',
  phone: '+962-6-999-9999',
  email: 'info@registered.test',
  website: 'https://registered.test',
  address: 'The address the company published',
};

describe('the precedence', () => {
  it('OFFICE_LOCAL answers when there is neither a catalogue row nor a registered company', () => {
    /*
     * The MAJORITY case, and the reason the local columns could not simply move. Measured when
     * decision 63 was written: 4 of dev's 19 `Insurer` rows and 6 of db-test's 534 were local-only,
     * and for those rows there is no organization to hold a phone number.
     */
    const r = resolveInsurerCompanyFacts(sources());
    expect(r.source).toBe('OFFICE_LOCAL');
    expect(r.name).toBe('Office Typed Insurance Co.');
    expect(r.phone).toBe('+962-6-111-1111');
  });

  it('GLOBAL_CATALOGUE names it, and the office row still supplies the contact facts', () => {
    // The catalogue has no phone, email, website or address columns AT ALL, so this is not a
    // per-field coalesce: there is no second source for those facts to drift from.
    const r = resolveInsurerCompanyFacts(sources({ insurerMaster: MASTER }));
    expect(r.source).toBe('GLOBAL_CATALOGUE');
    expect(r.name).toBe('AIG Jordan');
    expect(r.phone).toBe('+962-6-111-1111');
  });

  it('THE REGISTERED COMPANY OUTRANKS BOTH — every field, name included', () => {
    /*
     * The whole of decision 63 in one assertion. The name matters as much as the contact facts:
     * `insurerIdentity` only knows master-over-local, so if the view had kept reading IT for the name
     * while reading the resolver for the phone, one insurer would have carried the catalogue's name
     * beside the company's own address — two precedences for one entity, which is what this removes.
     */
    const r = resolveInsurerCompanyFacts(
      sources({ insurerMaster: MASTER, insuranceCompany: COMPANY }),
    );
    expect(r.source).toBe('REGISTERED_COMPANY');
    expect(r.name).toBe('Registered Insurance Company');
    expect(r.nameAr).toBe('شركة التأمين المسجّلة');
    expect(r.phone).toBe('+962-6-999-9999');
    expect(r.email).toBe('info@registered.test');
    expect(r.website).toBe('https://registered.test');
    expect(r.correspondenceAddress).toBe('The address the company published');
  });
});

describe('the source is chosen ONCE, then every field is read from it', () => {
  it('a registered company with no Arabic name does NOT fall through to the office’s', () => {
    /*
     * THE BUG A UNIT TEST CAUGHT ON `insurerIdentity`, re-armed one level up. Per-field `??` looks
     * equivalent and is not: it would render "Registered Insurance Company" — the company's own Latin
     * name — beside «شركة تأمين كتبها المكتب», a name the OFFICE typed. One entity, two sources, and
     * a reader with no way to tell.
     *
     * Null here means "this source does not publish that fact", never "ask the next source".
     */
    const r = resolveInsurerCompanyFacts(
      sources({
        insurerMaster: MASTER,
        insuranceCompany: { ...COMPANY, legalNameAr: '' },
      }),
    );
    expect(r.source).toBe('REGISTERED_COMPANY');
    expect(r.nameAr).toBe('');
    expect(r.nameAr).not.toBe('شركة تأمين كتبها المكتب');
  });

  it('a registered company with no phone does NOT fall through to the office’s', () => {
    const r = resolveInsurerCompanyFacts(
      sources({ insuranceCompany: { ...COMPANY, phone: null } }),
    );
    expect(r.phone).toBeNull();
    expect(r.phone).not.toBe('+962-6-111-1111');
  });
});

describe('what the office may still edit', () => {
  it('may edit its own columns while the record is UNLINKED', () => {
    expect(officeMayEditCompanyFacts({ insuranceCompanyId: null })).toBe(true);
  });

  it('may NOT once linked — the company answers, and a second writer is a second truth', () => {
    expect(officeMayEditCompanyFacts({ insuranceCompanyId: 'org-1' })).toBe(
      false,
    );
  });
});
