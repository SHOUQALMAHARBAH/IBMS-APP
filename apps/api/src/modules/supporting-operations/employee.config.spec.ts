import { describe, expect, it } from 'vitest';
import type { AccessDeprovisioningChecklist, Employee } from '@ibms/db';
import {
  isDeprovisioningChecklistFullyDone,
  toEmployeeListRow,
  toMaskedEmployee,
} from './employee.config';

function employee(over: Partial<Employee> = {}): Employee {
  return {
    id: 'emp-1',
    fullName: 'Jane Doe',
    givenName: 'Jane',
    fatherName: null,
    grandfatherName: null,
    familyName: 'Doe',
    nationalIdEnc: 'encrypted-value',
    position: 'Placement Officer',
    hireDate: new Date('2024-01-15T00:00:00.000Z'),
    terminationDate: null,
    licensedRole: 'CBJ-licensed Broker Representative',
    confidentialityAgreementSignedAt: new Date('2024-01-15T00:00:00.000Z'),
    backgroundCheckCompletedAt: new Date('2024-01-10T00:00:00.000Z'),
    createdAt: new Date('2024-01-15T09:00:00.000Z'),
    updatedAt: new Date('2024-01-15T09:00:00.000Z'),
    ...over,
  };
}

function checklist(
  over: Partial<AccessDeprovisioningChecklist> = {},
): AccessDeprovisioningChecklist {
  return {
    id: 'chk-1',
    employeeId: 'emp-1',
    triggeredAt: new Date('2026-09-16T09:00:00.000Z'),
    systemAccessRevokedAt: null,
    physicalAccessRevokedAt: null,
    deviceReturnedAt: null,
    knowledgeTransferDoneAt: null,
    completedAt: null,
    ...over,
  };
}

describe('toEmployeeListRow', () => {
  it('strips the encrypted field entirely — never decrypted for a list view', () => {
    const row = toEmployeeListRow(employee());
    expect(row).toEqual({
      id: 'emp-1',
      fullName: 'Jane Doe',
      givenName: 'Jane',
      fatherName: null,
      grandfatherName: null,
      familyName: 'Doe',
      position: 'Placement Officer',
      hireDate: '2024-01-15T00:00:00.000Z',
      terminationDate: null,
      licensedRole: 'CBJ-licensed Broker Representative',
    });
    expect(row).not.toHaveProperty('nationalIdEnc');
  });
});

describe('toMaskedEmployee', () => {
  it('builds the masked view from an already-decrypted national id', () => {
    const view = toMaskedEmployee(employee(), '****1234');
    expect(view.nationalId).toBe('****1234');
    expect(view.fullName).toBe('Jane Doe');
    expect(view.terminationDate).toBeNull();
  });

  it('never carries the raw nationalIdEnc field', () => {
    const view = toMaskedEmployee(employee(), '****1234');
    expect(view).not.toHaveProperty('nationalIdEnc');
  });
});

describe('isDeprovisioningChecklistFullyDone', () => {
  it('is false when any sub-item is still open', () => {
    expect(
      isDeprovisioningChecklistFullyDone(
        checklist({ systemAccessRevokedAt: new Date() }),
      ),
    ).toBe(false);
  });

  it('is true only once every sub-item is recorded', () => {
    const now = new Date();
    expect(
      isDeprovisioningChecklistFullyDone(
        checklist({
          systemAccessRevokedAt: now,
          physicalAccessRevokedAt: now,
          deviceReturnedAt: now,
          knowledgeTransferDoneAt: now,
        }),
      ),
    ).toBe(true);
  });

  it('is false for a freshly-triggered checklist', () => {
    expect(isDeprovisioningChecklistFullyDone(checklist())).toBe(false);
  });
});
