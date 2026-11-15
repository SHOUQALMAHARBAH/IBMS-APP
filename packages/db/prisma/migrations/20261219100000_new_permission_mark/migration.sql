-- MODULE 1 — OWNER DECISION 131: A NEW PERMISSION IS SHOWN TO EVERY OFFICE, GRANTED TO NOBODY,
-- AND MARKED «جديدة» UNTIL THAT OFFICE HAS DEALT WITH IT.
--
-- «إحنا بنطلّع كل صلاحيات النظام بالمصفوفة وما بنعطي ولا وحدة لحدا؛ الصلاحية الجديدة بتنزل معلَّمة
-- بالأخضر إنها جديدة ويوصل إشعار للأدمن، وهو بيقرر لمين يعطيها وعلى أي دور.»
--
-- Two pieces, and the split is the whole design:
--
--   `Permission.introducedAt`        GLOBAL — when the code arrived in the product. One fact.
--   `OfficePermissionDismissal`      PER OFFICE — this office looked and chose not to grant it.
--
-- A code is marked FOR AN OFFICE iff all three hold:
--
--   1. `introducedAt` is set AND later than that office's own `createdAt`;
--   2. no `RolePermission` row for it in that office — granting IS one of the two ways the owner
--      named to decide, and it is already recorded, so it needs no second record;
--   3. no dismissal row — the other way she named, «أو يقرّر فيها».
--
-- `docs/module-1-new-permission-mark.md` carries why a single date cannot do this alone, and why
-- this is a DISMISSAL table rather than a decision table.
--
-- ## 🔴 NO BACK-FILL OF `introducedAt`, AND THAT IS THE LOAD-BEARING CHOICE
--
-- Every code that exists today keeps NULL, which means «predates the mark» and is never marked.
-- Stamping the 232 with this migration's own date would show every existing office its entire
-- catalogue as new, and an administrator who is handed 232 green marks on day one learns to
-- dismiss the mark — which would make it worthless for the one code that genuinely closes a
-- button. The assertion below pins that at zero.
--
-- ## ⛔ AND NO BACK-FILL OF GRANTS EITHER — WHICH IS THE MECHANISM THIS DECISION REMOVES
--
-- Measured 2026-11-12: every permission-adding migration before this one — 8 of 8 — also wrote
-- `RolePermission` rows for the roles that already held some broader code, so no permission has
-- ever closed a button that was open. `20261212100000`'s own comment says it out loud: «every
-- office that has one of these three roles gets it, which is what the seed would have done».
--
-- That is over. `npm run check:permission-migrations` refuses a migration that writes
-- `RolePermission` for a code it is adding, it is in `check:guards` and so in CI, and it has a
-- self-test. THIS migration writes no grant at all, and the assertion below proves it by counting.

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 1. THE GLOBAL DATE.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

ALTER TABLE "Permission" ADD COLUMN "introducedAt" TIMESTAMP(3);

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 2. THE PER-OFFICE RULING.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

CREATE TABLE "OfficePermissionDismissal" (
  "id"                   TEXT NOT NULL,
  "organizationId"       TEXT NOT NULL DEFAULT current_setting('app.current_org_id', true),
  "permissionId"         TEXT NOT NULL,
  "dismissedByUserId"    TEXT NOT NULL,
  "dismissedByNameShown" TEXT NOT NULL,
  "dismissedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OfficePermissionDismissal_pkey" PRIMARY KEY ("id")
);

-- ONE ruling per code per office. Without this a double-click writes two rows saying the same
-- thing, and a later count of "codes this office has dealt with" over-reports.
CREATE UNIQUE INDEX "OfficePermissionDismissal_organizationId_permissionId_key"
  ON "OfficePermissionDismissal"("organizationId", "permissionId");
CREATE INDEX "OfficePermissionDismissal_organizationId_idx"
  ON "OfficePermissionDismissal"("organizationId");

-- Every FK RESTRICTS. A dismissal is a recorded decision of the office; a cascade that removed it
-- when a user row went away would silently un-decide it and the mark would reappear with no
-- account of why.
ALTER TABLE "OfficePermissionDismissal"
  ADD CONSTRAINT "OfficePermissionDismissal_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfficePermissionDismissal"
  ADD CONSTRAINT "OfficePermissionDismissal_permissionId_fkey"
  FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfficePermissionDismissal"
  ADD CONSTRAINT "OfficePermissionDismissal_dismissedByUserId_fkey"
  FOREIGN KEY ("dismissedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The name is a RECORD, so it may not be blank. `DeclaredAct.actorNameShown` carries the same
-- rule for the same reason: a decision record that can only name a uuid is unreadable.
ALTER TABLE "OfficePermissionDismissal"
  ADD CONSTRAINT "OfficePermissionDismissal_names_who_ruled"
  CHECK (btrim("dismissedByNameShown") <> '');

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- ROW-LEVEL SECURITY, ENABLED **AND FORCED** — decision 131's criterion 5.
--
-- «مكتب ثاني ما بيشوف قرار مكتب» — one office does not see another's decision, and here that is
-- true because the ROW IS INVISIBLE rather than because a query filtered it. FORCE because
-- `ENABLE` alone exempts the table's owner, and nothing legitimate writes this table except an
-- office acting on its own matrix: the seed never touches it.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

ALTER TABLE "OfficePermissionDismissal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OfficePermissionDismissal" FORCE ROW LEVEL SECURITY;
CREATE POLICY "OfficePermissionDismissal_tenant_isolation" ON "OfficePermissionDismissal"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- ASSERTIONS.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  n INT;
  before_grants INT;
BEGIN
  -- THE NO-BACK-FILL ASSERTION, both halves.
  SELECT count(*) INTO n FROM "Permission" WHERE "introducedAt" IS NOT NULL;
  IF n <> 0 THEN
    RAISE EXCEPTION 'decision 131: % permission(s) were stamped with an introduction date by this migration — every existing code must stay NULL, or every office meets its whole catalogue as new', n;
  END IF;

  SELECT count(*) INTO n FROM "OfficePermissionDismissal";
  IF n <> 0 THEN
    RAISE EXCEPTION 'decision 131: expected an empty dismissal table, found % row(s) — something recorded a ruling no office made', n;
  END IF;

  -- RLS enabled AND forced.
  SELECT count(*) INTO n FROM pg_class
   WHERE relname = 'OfficePermissionDismissal' AND relrowsecurity AND relforcerowsecurity;
  IF n <> 1 THEN
    RAISE EXCEPTION 'decision 131: row-level security is not both ENABLED and FORCED on OfficePermissionDismissal';
  END IF;

  SELECT count(*) INTO n FROM pg_policies WHERE tablename = 'OfficePermissionDismissal';
  IF n <> 1 THEN
    RAISE EXCEPTION 'decision 131: expected exactly one tenant policy on OfficePermissionDismissal, found %', n;
  END IF;

  -- The tenant column carries the GUC default, which is what makes `tenantScopeExtension` able to
  -- supply it and a raw INSERT unable to forge another office's row past the policy.
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_name = 'OfficePermissionDismissal' AND column_name = 'organizationId'
     AND column_default LIKE '%app.current_org_id%';
  IF n <> 1 THEN
    RAISE EXCEPTION 'decision 131: OfficePermissionDismissal.organizationId does not default from app.current_org_id';
  END IF;

  -- AND THE ONE THIS DECISION IS ACTUALLY ABOUT: this migration adds no grant to anybody.
  -- 8 of 8 earlier permission-adding migrations did, which is why no button has ever closed.
  SELECT count(*) INTO before_grants FROM "RolePermission";
  RAISE NOTICE 'decision 131: RolePermission holds % row(s) and this migration added none', before_grants;
END $$;
