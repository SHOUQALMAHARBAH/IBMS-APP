# ماذا تكشف كل لوحة فعلياً
# What each dashboard actually reveals

**لماذا هذا الملف**: مدير المكتب يقرر من يفتح أي لوحة بناءً على ما تكشفه، و«عرض لوحة
المالية» قد تعني رؤية إجمالي إيراد العمولة. هذه هي الأرقام المعروضة على الشاشة — لا
المسارات ولا رموز الصلاحيات.

**Why this exists**: the office manager decides who may open a dashboard based on what it
reveals, and "view the finance dashboard" may mean seeing total commission income. These
are **the numbers on the screen** — not routes, not permission codes.

**كيف قيست**: من مفاتيح النصوص التي تستدعيها كل شاشة بنفسها، مُحوَّلة إلى نصّها. الشاشة
هي المرجع وليس الواجهة البرمجية: قد يعيد المسار رقماً لا تعرضه الشاشة أبداً — وهذا وقع
فعلاً (§ 1.60) — فسؤال الواجهة يبالغ في تقدير ما يراه القارئ.

**How it was measured**: from each screen's own translation keys, resolved to their text.
**The screen is the authority, not the API** — a route can return a figure the screen never
renders, which actually happened (§ 1.60), so asking the API would over-report what a
reader can see. Regenerate with `python scripts/measurements/dashboard-figures.py`.

---

## الخلاصة التي تحتاجينها أولاً / The answer you need first

**ثماني شاشات من أربع عشرة تكشف العمولة — أي دخل الوسيط نفسه.**

**Eight of the fourteen reveal COMMISSION — the broker's own income.** If one sentence
drives the permission descriptions, it is this one.

| الشاشة / Screen | ما تكشفه من العمولة / What it reveals about commission |
|---|---|
| Financial report | **The whole breakdown**: earned gross · VAT · gross incl. VAT · reversed (clawed back) · net earned after clawbacks · paid (reconciled) · outstanding — **and per insurer** |
| Financial dashboard | Commission (JOD) per group · commission income earned / outstanding / paid |
| Profitability analysis | Commission income (JOD) · cost to serve · **net profitability** |
| Executive dashboard | Commission income (JOD) |
| Sales dashboard | Commission income |
| KPI dashboard | Commission this month (JOD) |
| Insurer & employee performance | **Commission earned PER EMPLOYEE** |
| Employee performance | **Commission earned (JOD) per employee**, with history |

**وحالتان منها حساسيتهما مختلفة**: «العمولة المكتسبة لكل موظف» ليست رقماً تجارياً عن
المكتب، بل قياس لإنتاجية شخص بعينه. من يراها يرى أداء زملائه.

**Two of those carry a different kind of sensitivity.** Per-employee commission earned is
not a commercial figure about the office — it is a measure of one named person's
productivity. Whoever can open those two screens can see how their colleagues are
performing, which is a staff-privacy decision rather than a commercial one.

---

## لوحات الجزء E / The seven Part E dashboards

### Claims dashboard — `/dashboards/claims`
Open claims · outstanding claims value · **loss ratio** · claims ageing (0–30 / 31–60 /
61–90 / 90+ days) · per-group claims (JOD), premium (JOD) and ratio · grouped by client, by
line, by insurer.
**يكشف / Reveals**: loss ratio by client and by insurer — how badly each client and each
insurer performs. No commission.

### Compliance dashboard — `/dashboards/compliance`
KYC status · complaints by status and by category · compliance exceptions · **open AML/CFT
alerts** and alerts by pattern type · regulatory filing status (submitted / pending /
overdue) · open DSRs by status · breach-register status · DPIA backlog by outcome.
**يكشف / Reveals**: the office's own compliance failures and open AML alerts. No money.

### Executive dashboard — `/dashboards/executive`
New leads · conversion rate · **commission income (JOD)** · active policies · expiring soon
· open claims · outstanding claims value (JOD) · receivables outstanding (JOD) · payables
to insurers (JOD) · open data-subject requests · open compliance exceptions.
**يكشف / Reveals**: everything, in summary — it is the five dashboards rolled up. Every
figure is lifted verbatim from the dashboard that produced it, so it can never disagree
with what it summarises.

### Financial dashboard — `/dashboards/financial`
Per group: premium (JOD) · claims (JOD) · **commission (JOD)** · net position (JOD).
Receivables (ageing) · payables to insurers · **commission income: earned / outstanding /
paid** · profitability by line and by client segment.
**يكشف / Reveals**: the office's commercial position, including what it earns and what it
owes each insurer.

### Insurer & employee performance — `/dashboards/insurer-employee-performance`
Insurer scores on four axes (quote response · claims service · price · service quality).
Employee KPI achievement: new clients · premium written · **commission earned** · renewal
rate · cross-sell rate.
**يكشف / Reveals**: per-employee commission and productivity, and a ranking of insurers.

### Policy dashboard — `/dashboards/policy`
Active policies · expiring policies (within the renewal window) · new policies issued ·
per-policy line and reason.
**يكشف / Reveals**: book volume. No money figures, no commission.

### Sales dashboard — `/dashboards/sales`
New leads · converted to prospect · conversion rate · premium written (new business /
renewal / total, JOD) · **commission income** · cross-sell conversion (opportunities,
converted) · up-sell conversion (recommendations).
**يكشف / Reveals**: pipeline plus commission income.

---

## تقارير المجال G / The six Domain G reports

### KPI dashboard — `/kpi-dashboard`
By area: customers · leads · prospects · opportunities · **total issued premium (JOD)** ·
claims · **outstanding invoiced (JOD)** · **commission this month (JOD)** · open service
requests · open risk register items · open incidents · open internal audit findings.
**يكشف / Reveals**: one number per area of the business, including this month's commission.

### Sales performance — `/sales-performance`
Per employee or per team: target new prospects · actual new prospects · actual new leads ·
achievement, for a chosen period, with history.
**يكشف / Reveals**: whether a named person hit their target. **No money.**

### Insurer performance — `/insurer-performance`
One insurer's four scores (quote response · claims service · price · service quality), most
recent period and history.
**يكشف / Reveals**: a judgement of one insurer. No money.

### Employee performance — `/employee-performance`
One employee: new clients · **premium written (JOD)** · **commission earned (JOD)** ·
renewal rate · cross-sell rate, with history.
**يكشف / Reveals**: one named person's production and the commission it earned.

### Portfolio analysis — `/portfolio-analysis`
Policies and **total issued premium (JOD)**, grouped by line, by insurer, by client segment,
by geography (branch).
**يكشف / Reveals**: where the book sits. Premium, not commission.

### Profitability analysis — `/profitability-analysis`
Per line and per client segment: **commission income (JOD)** · **cost to serve (JOD)** ·
**net profitability (JOD)** · policies · claims.
**يكشف / Reveals**: which lines and which client segments actually make money. The most
commercially revealing screen after the finance report.

---

## تقرير المالية / The finance report — `/financial-report`

الأكثر كشفاً، وبفارق واضح. / **The most revealing screen in the system, by a clear margin.**

**Client receivables** — outstanding total · current · 1–30 · 31–60 · 61–90 · 90+ days,
with the invoice and customer counts.

**Insurer payables** — outstanding (collected, not remitted) · remitted to date, across
insurers.

**Commission income** — earned (gross) · **VAT** · gross (incl. VAT) · **reversed (clawed
back)** · **net earned (after clawbacks)** · paid (reconciled) · outstanding (still to
collect) — **and the same breakdown per insurer** (earned · paid · outstanding · reversed).

**Book result** — by line and by client segment: premium written · claims paid ·
commission · net position · policies.

**يكشف / Reveals**: what the brokerage earns, from whom, what it has not yet collected,
what it owes each insurer, and what it has had clawed back. If one screen deserves the
narrowest grant, it is this one.

---

## شاشتان تشغيليتان، للاكتمال / Two operational screens, for completeness

هما ليستا من الثلاث عشرة، لكنهما تعرضان أرقاماً فلا تُغفلا.

Not among the thirteen, but they display figures, so they should not be overlooked.

### Claims analytics — `/claims-analytics`
**Loss ratio** · claims paid · written premium · claims and policies per group.

### SLA dashboard — `/sla-dashboard`
Timer counts by state (on track · due soon · breached · escalated · **paused** · resolved
on time · resolved late) · **breach rate** · oldest overdue days · per-workflow and
per-entity-type breakdowns · the per-timer drill-down with each deadline, whether it is
**regulatory**, and the stated basis of any pause.
**يكشف / Reveals**: the office's own lateness against statutory and internal deadlines —
which is compliance evidence about the brokerage itself.
