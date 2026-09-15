import { describe, expect, it } from 'vitest';
import { effectiveDepartmentId } from './department.util';

describe('effectiveDepartmentId', () => {
  it('uses the account value when there is no linked Employee', () => {
    expect(effectiveDepartmentId({ departmentId: 'dept-a' })).toBe('dept-a');
    expect(
      effectiveDepartmentId({ departmentId: 'dept-a', employee: null }),
    ).toBe('dept-a');
  });

  it('lets the Employee record overrule the provisioning value', () => {
    expect(
      effectiveDepartmentId({
        departmentId: 'dept-a',
        employee: { departmentId: 'dept-b' },
      }),
    ).toBe('dept-b');
  });

  it('falls through to the account when the Employee states no department', () => {
    // The half a bare `||`/truthiness check would get right by accident and a
    // reversed precedence would get wrong: an Employee row exists, but it has
    // not stated a department, so it does not overrule anything.
    expect(
      effectiveDepartmentId({
        departmentId: 'dept-a',
        employee: { departmentId: null },
      }),
    ).toBe('dept-a');
  });

  it('is null only when neither states one', () => {
    expect(
      effectiveDepartmentId({
        departmentId: null,
        employee: { departmentId: null },
      }),
    ).toBeNull();
    expect(effectiveDepartmentId({ departmentId: null })).toBeNull();
  });

  it('returns the Employee value when the account has none', () => {
    expect(
      effectiveDepartmentId({
        departmentId: null,
        employee: { departmentId: 'dept-b' },
      }),
    ).toBe('dept-b');
  });
});
