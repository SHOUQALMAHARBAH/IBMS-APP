-- MODULE 1 — «تبليغ خطي»: THE FIRST OF ART. 22/s's FOUR APPROVED MEANS GETS A CHANNEL AT LAST.
--
-- OWNER DECISION 133 §3, ruling 2: «يُضاف إلى وسائل التواصل في النظام خيار «تبليغ خطي»، ويُحسَب
-- الوسيلة الأولى من المادة (٢٢/س). قبله، رسالة العميل الورقية كانت ستُسجَّل «أخرى»، وهي أضعف خانة.»
--
-- ## WHY IT MATTERS, MEASURED
--
-- Art. 22/s lists FOUR approved means of notification. Measured 2026-11-12 against
-- `InteractionChannel`'s twelve members:
--
--   means 1  «التبليغ الخطي»                      NO MEMBER AT ALL
--   means 2  «البريد الالكتروني والقنوات ...»     EMAIL, and PORTAL (ratified, decision 133 §3/1)
--   means 3  «الرسائل النصية ...»                 SMS
--   means 4  «اي وسيلة يتم الاتفاق عليها خطياً»   OTHER, and only with a written agreement
--
-- 🔴 So written notice — the most traditional means the article names — could only have been
-- recorded as `OTHER`, which means 4 makes CONDITIONAL on a written agreement. **The strongest
-- means would have been filed as the weakest.** That was reported in
-- `docs/module-1-strings-for-ratification.md` §6 rather than fixed, on the ground that adding a
-- member to a 12-member enum read at 20 call sites is a decision and not a tidy-up. She took it.
--
-- ## APPENDED, NOT INSERTED, AND THAT IS DELIBERATE
--
-- `ADD VALUE` without `BEFORE`/`AFTER` appends. Nothing in this product orders by this enum —
-- `INTERACTION_CHANNELS` in the web declares its own display order, and `ENUM_LABEL` is a map —
-- so a position would be a decision with no consequence, and inserting mid-enum rewrites the
-- sort order of every existing row for no gain.
--
-- NO BACK-FILL. Not one existing `OTHER` row is rewritten. A row recorded as `OTHER` was recorded
-- that way by somebody, and re-reading it as written notice afterwards would be the system
-- deciding what a person meant — the same refusal `20261218100000` makes about inventing an
-- exemption nobody chose. The assertion below pins that at zero.

ALTER TYPE "InteractionChannel" ADD VALUE 'WRITTEN_NOTICE';

DO $$
DECLARE
  n INT;
BEGIN
  -- Thirteen members, and the new one is present. `pg_enum` is readable inside the same
  -- transaction that added the value; what Postgres forbids is USING it on a table here, which
  -- is why there is no back-fill below even in principle.
  SELECT count(*) INTO n FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
   WHERE t.typname = 'InteractionChannel';
  IF n <> 13 THEN
    RAISE EXCEPTION 'written notice: InteractionChannel holds % members, expected 13', n;
  END IF;

  SELECT count(*) INTO n FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
   WHERE t.typname = 'InteractionChannel' AND e.enumlabel = 'WRITTEN_NOTICE';
  IF n <> 1 THEN
    RAISE EXCEPTION 'written notice: WRITTEN_NOTICE is not a member of InteractionChannel';
  END IF;

  -- AND THE FOUR MEANS NOW ALL HAVE A MEMBER, asserted by name rather than by count: a count of
  -- five would be satisfied by any five, including a set missing the one this migration is for.
  SELECT count(*) INTO n FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
   WHERE t.typname = 'InteractionChannel'
     AND e.enumlabel IN ('WRITTEN_NOTICE', 'EMAIL', 'PORTAL', 'SMS', 'OTHER');
  IF n <> 5 THEN
    RAISE EXCEPTION 'written notice: the five members that carry art. 22/s''s four means are not all present (% of 5)', n;
  END IF;
END $$;
