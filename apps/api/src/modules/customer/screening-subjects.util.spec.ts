import { describe, expect, it } from 'vitest';
import { buildScreeningSubjects } from './screening-subjects.util';
import { subjectFingerprint } from './provider-screening.service';

const individual = {
  id: 'c1',
  legalName: 'Sami Khalid Al-Rashid',
  customerType: 'INDIVIDUAL',
  dateOfBirth: new Date('1985-03-17T00:00:00.000Z'),
  nationality: 'JO',
};

describe('Part B §11 — the discriminators finally have a producer', () => {
  it('carries date of birth and nationality onto the subject', () => {
    const [subject] = buildScreeningSubjects(individual, []);
    expect(subject.dateOfBirth).toBe('1985-03-17');
    expect(subject.nationality).toBe('JO');
    expect(subject.entityType).toBe('individual');
  });

  it('reports an unknown attribute as null, never as a guess', () => {
    // Absent is "we do not know", which a reviewer must weigh differently
    // from "it does not match".
    const [subject] = buildScreeningSubjects(
      { ...individual, dateOfBirth: null, nationality: null },
      [],
    );
    expect(subject.dateOfBirth).toBeNull();
    expect(subject.nationality).toBeNull();
  });

  it('formats the date as YYYY-MM-DD with no time component', () => {
    const [subject] = buildScreeningSubjects(individual, []);
    expect(subject.dateOfBirth).toMatch(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/);
  });

  it('a CORPORATE customer carries none of its own — its UBOs do', () => {
    const subjects = buildScreeningSubjects(
      {
        id: 'c2',
        legalName: 'Rashid Trading LLC',
        customerType: 'CORPORATE',
        dateOfBirth: null,
        nationality: null,
      },
      [
        {
          id: 'u1',
          fullName: 'Sami Khalid Al-Rashid',
          dateOfBirth: new Date('1985-03-17T00:00:00.000Z'),
          nationality: 'JO',
        },
      ],
    );
    expect(subjects[0].entityType).toBe('organization');
    expect(subjects[0].dateOfBirth).toBeNull();
    expect(subjects[1].entityType).toBe('individual');
    expect(subjects[1].dateOfBirth).toBe('1985-03-17');
  });
});

describe('Part B §12 — the subject fingerprint', () => {
  it('changes when a UBO is added — the hole this exists to close', () => {
    const before = subjectFingerprint(buildScreeningSubjects(individual, []));
    const after = subjectFingerprint(
      buildScreeningSubjects(individual, [
        {
          id: 'u1',
          fullName: 'Layla Omar Haddad',
          dateOfBirth: null,
          nationality: null,
        },
      ]),
    );
    expect(after).not.toBe(before);
  });

  it('changes when a date of birth is corrected', () => {
    const before = subjectFingerprint(buildScreeningSubjects(individual, []));
    const after = subjectFingerprint(
      buildScreeningSubjects(
        { ...individual, dateOfBirth: new Date('1985-03-18T00:00:00.000Z') },
        [],
      ),
    );
    expect(after).not.toBe(before);
  });

  it('changes when nationality is corrected', () => {
    const before = subjectFingerprint(buildScreeningSubjects(individual, []));
    const after = subjectFingerprint(
      buildScreeningSubjects({ ...individual, nationality: 'SY' }, []),
    );
    expect(after).not.toBe(before);
  });

  it('is STABLE across subject order — the same people are the same screening', () => {
    const ubos = [
      {
        id: 'u1',
        fullName: 'Layla Omar Haddad',
        dateOfBirth: null,
        nationality: null,
      },
      {
        id: 'u2',
        fullName: 'Nour Yousef Masri',
        dateOfBirth: null,
        nationality: null,
      },
    ];
    expect(subjectFingerprint(buildScreeningSubjects(individual, ubos))).toBe(
      subjectFingerprint(
        buildScreeningSubjects(individual, [...ubos].reverse()),
      ),
    );
  });

  it('is stable across case and surrounding whitespace in a name', () => {
    expect(
      subjectFingerprint(
        buildScreeningSubjects(
          { ...individual, legalName: '  SAMI KHALID AL-RASHID ' },
          [],
        ),
      ),
    ).toBe(subjectFingerprint(buildScreeningSubjects(individual, [])));
  });

  it('does NOT change when only the subject id changes', () => {
    // A re-created UBO row for the same person is the same screening.
    const a = subjectFingerprint(
      buildScreeningSubjects(individual, [
        {
          id: 'u1',
          fullName: 'Layla Omar Haddad',
          dateOfBirth: null,
          nationality: null,
        },
      ]),
    );
    const b = subjectFingerprint(
      buildScreeningSubjects(individual, [
        {
          id: 'u-different',
          fullName: 'Layla Omar Haddad',
          dateOfBirth: null,
          nationality: null,
        },
      ]),
    );
    expect(b).toBe(a);
  });

  it('is a hash, not a readable list of the people screened', () => {
    const fingerprint = subjectFingerprint(
      buildScreeningSubjects(individual, []),
    );
    expect(fingerprint).toMatch(/^[0-9a-f]{32}$/);
    expect(fingerprint.toLowerCase()).not.toContain('sami');
  });
});
