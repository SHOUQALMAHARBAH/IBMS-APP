import { describe, expect, it } from 'vitest';
import {
  deriveIncidentReportView,
  incidentReportAuditSnapshot,
  isContainmentOverdue,
  requiresContainmentSla,
  INCIDENT_SEVERITIES,
  INCIDENT_REGULATORS,
  type IncidentReportRow,
} from './incident.config';

const NOW = new Date('2026-09-06T12:00:00.000Z');

/* Decision 48's resolved names. A Map that deliberately does NOT hold every id these
 * cases pass: a double answering for everything could not tell a resolved name from the
 * `?? uuid` fallback the view forbids. */
const ACTOR_NAMES = new Map([['u-responder', 'Ahmad Al-Test']]);

function row(overrides: Partial<IncidentReportRow> = {}): IncidentReportRow {
  return {
    id: 'incident-1',
    title: 'Phishing email reached staff mailboxes',
    description: 'Three staff clicked a malicious link.',
    severity: 'critical',
    status: 'REPORTED',
    reportedAt: new Date('2026-09-06T09:00:00.000Z'),
    containedAt: null,
    impactAssessedAt: null,
    classification: 'NOT_YET_CLASSIFIED',
    classifiedByDpoUserId: null,
    seniorManagementCoSignUserId: null,
    seniorManagementNotifiedAt: null,
    notifiedRegulators: [],
    notifiedAt: null,
    affectedDataSubjectsNotifiedAt: null,
    rootCauseAnalysis: null,
    recoveredAt: null,
    closedAt: null,
    classificationCombinedDutyAct: null,
    // Owner decision 56. SPELLED OUT rather than defaulted: this fixture uses the full
    // row type precisely so a new column cannot arrive without a decision being made
    // here, and an empty log is the correct state for a REPORTED incident nobody has
    // contained — which is the state most of these cases are about.
    containmentActions: [],
    touchesPersonalData: null,
    dataCategoriesAffected: null,
    subjectsAffectedEstimate: null,
    occurredAt: null,
    reportedByUserId: null,
    ...overrides,
  };
}

/*
 * OWNER'S DECISION, 2026-10-28 — `IncidentReport.severity` KEEPS FOUR VALUES, and the
 * divergence from `PRIV-SRS-02` is DECLARED rather than resolved. The record is
 * `docs/pcms-dictionary-divergences.md` § 1.
 *
 * The dictionary types the field `Enum | Required | Low / Medium / High` and
 * `PRIV-FRM-06` § IV offers three boxes — «☐ منخفض ☐ متوسط ☐ مرتفع». We carry four.
 *
 * THIS BLOCK IS THE REASON, IN THE ONE FORM THAT CAN FAIL. `critical` is the only value
 * that carries a containment deadline, so narrowing the vocabulary to three would retire
 * the only containment target in the module as a side effect of a type change. Written as
 * prose that is a sentence somebody deletes; written here it is a red build.
 *
 * It asserts the narrow thing and not a general one: not that four values exist — the
 * suite already pins that — but that the FOURTH one is load-bearing.
 */
describe('المهلة الأربع ساعات معلّقة على `critical` وحدها — the four-hour target hangs on `critical` alone', () => {
  it('`critical` carries a containment target and NONE of the other three does', () => {
    expect(requiresContainmentSla('critical')).toBe(true);
    // BY NAME, not by iteration: a loop over `INCIDENT_SEVERITIES.filter(s => s !== 'critical')`
    // would keep passing if a value were REMOVED from that list, which is the exact
    // change this test exists to refuse.
    expect(requiresContainmentSla('low')).toBe(false);
    expect(requiresContainmentSla('medium')).toBe(false);
    expect(requiresContainmentSla('high')).toBe(false);
  });

  it('no member of INCIDENT_SEVERITIES other than `critical` carries a target', () => {
    const withTarget = INCIDENT_SEVERITIES.filter((s) =>
      requiresContainmentSla(s),
    );
    /* The complement of the test above, and it is what catches a FIFTH value arriving with
     * a target nobody decided — the direction a by-name test cannot see. */
    expect(withTarget).toEqual(['critical']);
  });

  it('removing `critical` would leave the module with NO containment target at all', () => {
    /* THE CONSEQUENCE, asserted rather than described. This is the sentence in the
     * divergence record — «narrowing the vocabulary to three would retire the only
     * containment deadline in the module» — and a reader who narrows the list to the
     * dictionary's three sees it fail here with the reason attached.
     *
     * Deliberately NOT a check that the list has four members: that would fail on a
     * harmless rename and pass on a change that moved the target onto `high`. What matters
     * is that SOMETHING carries the target and that it is in the shipped vocabulary. */
    const dictionaryThree = ['low', 'medium', 'high'];
    expect(dictionaryThree.some((s) => requiresContainmentSla(s))).toBe(false);
    expect(INCIDENT_SEVERITIES.some((s) => requiresContainmentSla(s))).toBe(
      true,
    );
  });
});

describe('INCIDENT_SEVERITIES / INCIDENT_REGULATORS (Process 55)', () => {
  it('has exactly the four severities', () => {
    expect([...INCIDENT_SEVERITIES]).toEqual([
      'low',
      'medium',
      'high',
      'critical',
    ]);
  });
  it('has exactly the three named regulators', () => {
    expect([...INCIDENT_REGULATORS]).toEqual([
      'CBJ',
      'NCSC',
      'Personal_Data_Protection_Council',
    ]);
  });
});

describe('requiresContainmentSla (Process 55)', () => {
  it('is true only for critical severity', () => {
    expect(requiresContainmentSla('critical')).toBe(true);
    expect(requiresContainmentSla('high')).toBe(false);
    expect(requiresContainmentSla('medium')).toBe(false);
    expect(requiresContainmentSla('low')).toBe(false);
  });
});

describe('isContainmentOverdue (Process 55)', () => {
  it('is false for a non-critical severity regardless of elapsed time', () => {
    expect(
      isContainmentOverdue(
        row({
          severity: 'high',
          reportedAt: new Date('2026-09-01T00:00:00.000Z'),
        }),
        NOW,
      ),
    ).toBe(false);
  });

  it('is false once containedAt is set, even for critical severity past 4h', () => {
    expect(
      isContainmentOverdue(
        row({
          severity: 'critical',
          reportedAt: new Date('2026-09-01T00:00:00.000Z'),
          containedAt: new Date('2026-09-01T10:00:00.000Z'),
        }),
        NOW,
      ),
    ).toBe(false);
  });

  it('is false for a critical incident still within the 4-hour window', () => {
    expect(
      isContainmentOverdue(
        row({
          severity: 'critical',
          reportedAt: new Date('2026-09-06T09:00:00.000Z'),
        }),
        new Date('2026-09-06T10:00:00.000Z'),
      ),
    ).toBe(false);
  });

  it('is true for a critical, uncontained incident past 4 hours', () => {
    expect(
      isContainmentOverdue(
        row({
          severity: 'critical',
          reportedAt: new Date('2026-09-06T09:00:00.000Z'),
        }),
        new Date('2026-09-06T13:30:00.000Z'),
      ),
    ).toBe(true);
  });
});

describe('deriveIncidentReportView (Process 55)', () => {
  it('serializes null timestamps as null, not undefined', () => {
    const view = deriveIncidentReportView(row(), NOW, ACTOR_NAMES);
    expect(view.containedAt).toBeNull();
    expect(view.classifiedByDpoUserId).toBeNull();
    expect(view.rootCauseAnalysis).toBeNull();
  });

  it('carries notifiedRegulators through as an array', () => {
    const view = deriveIncidentReportView(
      row({ notifiedRegulators: ['CBJ', 'NCSC'] }),
      NOW,
      ACTOR_NAMES,
    );
    expect(view.notifiedRegulators).toEqual(['CBJ', 'NCSC']);
  });
});

describe('incidentReportAuditSnapshot (Process 55)', () => {
  it('carries ids/status/classification verbatim', () => {
    const snapshot = incidentReportAuditSnapshot(
      row({ status: 'CLASSIFIED', classification: 'MATERIAL' }),
    );
    expect(snapshot.incidentReportId).toBe('incident-1');
    expect(snapshot.status).toBe('CLASSIFIED');
    expect(snapshot.classification).toBe('MATERIAL');
  });
});
