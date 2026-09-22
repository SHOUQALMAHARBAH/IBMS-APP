-- The office-line FK the previous migration left out, and why it is a SECOND constraint.
--
-- `20261019100000` added the COMPOSITE tenant FK `(officeInsuranceLineId, organizationId) ->
-- OfficeInsuranceLine(id, organizationId)` and stopped there. `db:divergence` caught the gap
-- immediately: `schema.prisma` declares an ordinary Prisma relation on `officeInsuranceLineId`,
-- so the next generated migration would have ADDED the simple FK — a schema change nobody
-- reviewed, arriving inside whatever commit next ran `migrate dev`.
--
-- Both constraints is the CORRECT state, not a redundancy, and `InsurerOfferedLine` has had both
-- since it was built — measured before writing this:
--
--     InsurerOfferedLine_officeInsuranceLineId_fkey     <- Prisma's, from the declared relation
--     InsurerOfferedLine_office_line_same_org_fkey      <- the composite, raw SQL
--
-- They do different jobs. The SIMPLE one is what Prisma's generated client and its referential
-- actions are built against, and declaring the relation without it is the divergence above. The
-- COMPOSITE one is the tenancy guarantee: it is what makes a row referencing ANOTHER office's
-- private line fail to insert, which the simple FK alone permits. Dropping either loses something
-- — the first loses the schema's honesty, the second loses tenant isolation.
--
-- Fixed forward rather than by editing `20261019100000`: that file is applied on two databases and
-- editing it would drift its checksum, which is the whole point of `db:checksums`.

ALTER TABLE "InsuranceProgramLine"
  ADD CONSTRAINT "InsuranceProgramLine_officeInsuranceLineId_fkey"
  FOREIGN KEY ("officeInsuranceLineId") REFERENCES "OfficeInsuranceLine"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RFQ"
  ADD CONSTRAINT "RFQ_officeInsuranceLineId_fkey"
  FOREIGN KEY ("officeInsuranceLineId") REFERENCES "OfficeInsuranceLine"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Policy"
  ADD CONSTRAINT "Policy_officeInsuranceLineId_fkey"
  FOREIGN KEY ("officeInsuranceLineId") REFERENCES "OfficeInsuranceLine"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CommissionAgreement"
  ADD CONSTRAINT "CommissionAgreement_officeInsuranceLineId_fkey"
  FOREIGN KEY ("officeInsuranceLineId") REFERENCES "OfficeInsuranceLine"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Verify BOTH survive on all four, because the failure this guards is someone "tidying away the
-- duplicate FK" — which reads as cleanup and removes tenant isolation.
DO $assert$
DECLARE
  t       text;
  n_simple int;
  n_comp   int;
BEGIN
  FOREACH t IN ARRAY ARRAY['InsuranceProgramLine', 'RFQ', 'Policy', 'CommissionAgreement'] LOOP
    SELECT count(*) INTO n_simple FROM pg_constraint
     WHERE conrelid = format('%I', t)::regclass
       AND conname = t || '_officeInsuranceLineId_fkey';
    SELECT count(*) INTO n_comp FROM pg_constraint
     WHERE conrelid = format('%I', t)::regclass
       AND conname = t || '_office_line_same_org_fkey';

    IF n_simple <> 1 THEN
      RAISE EXCEPTION '%: the simple office-line FK is missing. schema.prisma declares the relation, so the next generated migration would add it as an unreviewed change.', t;
    END IF;
    IF n_comp <> 1 THEN
      RAISE EXCEPTION '%: the COMPOSITE office-line FK is missing. Without it a row can reference another office''s private insurance line and the reference is structurally valid — one office''s vocabulary on another office''s business record.', t;
    END IF;
  END LOOP;
END
$assert$;
