import type { MeResponse } from './auth-api';

/**
 * Part IV §10.4 — the single source every conditional render reads.
 *
 * §10.4 asks for two independent layers: the frontend renders only what the
 * caller may actually do, and the backend re-validates regardless. Hiding a
 * control is a UX improvement, never a security boundary — the API guard is
 * the boundary, and it does not care what the UI showed.
 *
 * What this replaces is the reason the rule exists. The app previously
 * branched on ROLE names (`user.roles.includes('FINANCE_COLLECTIONS_OFFICER')`
 * and similar, in 67 places across 47 files), which is a second copy of the
 * role-to-permission grid — written by hand, in the frontend, with nothing
 * keeping it in step with the seed. Granting an existing permission to one
 * more role updated the API and left every one of those checks stale, and the
 * failure is silent in the worst direction: the button stays hidden from
 * someone who is now allowed to press it, and nobody gets an error to chase.
 *
 * Permission codes are the same strings `@RequirePermissions` uses, so a UI
 * check and its endpoint's guard read the same word.
 */
export function hasPermission(
  user: Pick<MeResponse, 'permissions'> | null | undefined,
  code: string,
): boolean {
  return !!user && user.permissions.includes(code);
}

/** True when the user holds AT LEAST ONE of these — for a control that several
 * different permissions can legitimately reach (a queue a manager and an
 * officer both work, say). Prefer naming one code where one will do. */
export function hasAnyPermission(
  user: Pick<MeResponse, 'permissions'> | null | undefined,
  codes: readonly string[],
): boolean {
  return !!user && codes.some((code) => user.permissions.includes(code));
}
