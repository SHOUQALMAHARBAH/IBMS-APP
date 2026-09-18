-- Office-scoped custom RBAC, PHASE 2 workstream G — revoke the grant the
-- `incident.classify` split takes away.
--
-- WHY A MIGRATION AND NOT JUST THE SEED
-- ------------------------------------
-- `seed.ts` UPSERTS permissions and their role links. It adds what the grid
-- says and never deletes what the grid no longer says, so an existing database
-- keeps every grant it was ever given. `incident.classify` was granted to
-- [DPO, EXECUTIVE_MANAGEMENT] and is now the DPO's alone — reseeding would
-- leave Executive Management holding it, and the classify route would still
-- accept them. Caught by `incident.e2e-spec.ts`, which expected a 403 from an
-- Executive and got a 201.
--
-- That is not only a test failing. Two Executives could then have worked both
-- halves of a control that exists to have two different functions in it.
-- (`assertDifferentActors` still stops one person doing both, and is untouched.)
--
-- WHY THE SEED IS NOT MADE TO PRUNE INSTEAD
-- -----------------------------------------
-- A seed that deleted any grant not in its own grid would be a far more general
-- fix and a much worse one: under office-scoped custom roles an office's own
-- grants are exactly the rows that are NOT in the grid, and the next seed run
-- would wipe them. Removals have to be deliberate and scoped, which is what a
-- migration is for.
--
-- SCOPED TO THE LEGACY ROLE NAME, DELIBERATELY
-- --------------------------------------------
-- Only the grant the old seed itself made is withdrawn — the one held by a role
-- still named EXECUTIVE_MANAGEMENT. An office that has deliberately granted
-- `incident.classify` to a role of its own keeps it; this migration has no
-- business overruling that decision, and after Phase 3 there will be such
-- offices.
--
-- The two NEW codes (`incident.classification.co-sign`,
-- `incident.senior-management.notify`) arrive through the seed like every other
-- permission. Only the removal needs to be stated here.

DELETE FROM "RolePermission" rp
USING "Permission" p, "Role" r
WHERE rp."permissionId" = p.id
  AND rp."roleId" = r.id
  AND p."code" = 'incident.classify'
  AND r."name" = 'EXECUTIVE_MANAGEMENT';
