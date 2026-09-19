-- Office-scoped custom RBAC, PHASE 3 workstream E — `employee.manage` becomes
-- four codes, and the national-ID reveal stops riding on the record-management
-- permission.
--
-- WHAT WAS TOO WIDE
-- -----------------
-- `employee.manage` gated four routes: create, list, get — and reveal an
-- employee's unmasked national ID. Part 10.2 classifies that field Highly
-- Confidential. It is encrypted at rest, every reveal already requires a
-- >=10-character written justification, and every reveal already writes an
-- audited READ flagged `isSensitiveDataAccess`. The gate was the one part that
-- did not distinguish "correct this person's hire date" from "read their
-- national identity number".
--
-- WHY A RENAME IN PLACE
-- ---------------------
-- Migration 20261004120000 established the rule: `seed.ts` upserts grants and
-- never REMOVES one, so a deleted code survives a reseed forever, and deleting
-- this row would cascade its `RolePermission` grants away and open a window where
-- nobody in the office can read an employee at all.
--
-- Renaming keeps the row id, so both existing grants (the administrator and the
-- Branch/Department Manager) follow it and neither loses the ability to READ an
-- employee. `employee.create` and `employee.update` are then created by the seed
-- and granted to the same two roles, preserving their reach exactly.
--
-- WHAT IS DELIBERATELY NOT PRESERVED
-- ----------------------------------
-- `employee.national-id.reveal` is granted to the COMPLIANCE OFFICER and to
-- nobody else. The administrator and the Manager both hold `employee.manage`
-- today and therefore hold the reveal; after this neither does. That is the point
-- of the split, not an oversight — an administrator provisions accounts, and the
-- `OFFICE_ADMINISTRATOR` role the next migration seeds deliberately does not
-- carry this code either.
--
-- The customer counterpart (`customer.national-id.reveal`) needs no migration: it
-- is a NEW code enforced per field inside `CustomerService.revealField`, and
-- `customer.360-view.read` keeps governing the route and the contact fields. That
-- asymmetry is deliberate — the employee route can only reveal a national ID, so
-- its route gate is its field gate, while the customer route also reveals a phone
-- number a Sales Officer needs for ordinary work on their own customer.

UPDATE "Permission"
SET "code" = 'employee.read',
    "description" = 'View employee records and their licensing/training history'
WHERE "code" = 'employee.manage';
