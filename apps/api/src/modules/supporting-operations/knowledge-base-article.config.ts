/**
 * Process 74 (backlog Part C #74, Domain H — the LAST Domain H item) —
 * Knowledge Management. One checkbox: "a bilingual knowledge base: product
 * knowledge, insurer appetite, rate guides, regulatory updates."
 * `KnowledgeBaseArticle` (schema's own doc comment: "Process 74 — product
 * knowledge, insurer appetite, rate guides, regulatory updates for staff")
 * pre-exists with zero prior application code — the same "dormant model,
 * first real writer" shape #58-73 repeatedly found, closing out Domain H.
 *
 * "Bilingual" here is OPTIONAL-per-article, not mandatory-both like the
 * sibling `DocumentTemplate` model (Part 11.2, `nameEn`/`nameAr`/`bodyEn`/
 * `bodyAr` all NOT NULL — regulator-facing formal documents that must exist
 * in both languages before use). `KnowledgeBaseArticle.title` is the only
 * mandatory text field; `titleAr`/`bodyEn`/`bodyAr` are all nullable — an
 * article may exist in English only, Arabic only (via `titleAr` with no
 * English `bodyEn`), or both. This is a deliberate reading of the schema's
 * own nullability, not an oversight to "fix" by making the Arabic fields
 * mandatory.
 *
 * `publishedAt` defaults to `now()` at the DB level with no nullable
 * "draft" state — creation IS publishing, matching the pre-seeded
 * permission's own verb (`kb.publish`, not `kb.manage`/`kb.create`). There
 * is no separate draft/review/publish workflow to build.
 *
 * `kb.publish` (`[COMPLIANCE_OFFICER, BRANCH_DEPARTMENT_MANAGER,
 * PLACEMENT_TECHNICAL_OFFICER]`) gates the WHOLE surface (create/list/get/
 * update), the #67/#69/#71 "one pre-seeded permission gates the whole CRUD"
 * precedent — even though only that permission's own role list can even
 * READ the knowledge base via this API. No second, broader read permission
 * was pre-seeded for this process; a genuinely useful knowledge base would
 * likely want much wider read access company-wide, but this is a real,
 * documented scope limit of the backlog's own permission grid, not solved
 * here by inventing a permission the seed data doesn't define.
 *
 * No new permission, no migration.
 */

export const KB_CATEGORIES = [
  'product_knowledge',
  'insurer_appetite',
  'rate_guide',
  'regulatory_update',
] as const;

export type KbCategory = (typeof KB_CATEGORIES)[number];
