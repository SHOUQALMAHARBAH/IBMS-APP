# أسئلة جلسة الوسيط — قائمة تُضاف إليها
# Broker-session questions — a running list

**بنيتها**: قسم المال أولاً — وهو مُدخَل العمل المؤجَّل — يليه ما ليس عن المال. ملف واحد
لجلسة واحدة: من يدخل الغرفة يحمل قائمة واحدة، لا اثنتين.

**Structure**: the money section first — it is the input to the deferred money work —
then the questions that are not about money. One file for one session: whoever walks into
that room carries one list, not two.

**الحالة: قائمة عاملة، لا قرار ولا تصميم.** أُنشئت بقرار المالكة في 2026-09-28 بتأجيل كل
عمل المال وكل عمل مكافحة غسل الأموال إلى ما بعد جلسة الوسيط. إجاباته هي مُدخَل هذا العمل،
لا تخميناتنا.

**Status: a working list, not a decision and not a design.** Created by the owner's
decision of 2026-09-28 deferring all money work and all AML work until after the broker
session. **His answers are the input to that work. Our guesses are not.**

**كيف تُستخدم / How to use it.** One question per thing we cannot answer. Each carries
**what it decides** — because a question with no consequence attached gets a polite
answer and changes nothing. Add to it whenever deferred work touches something
unanswerable; do not tidy it.

---

## الأسئلة الأساسية — من المالكة / The owner's own six

### ١. كيف يستلم القسط فعلياً؟ / How does he actually receive a premium?

نقداً؟ حوالة بنكية؟ شيك؟ CliQ؟ وهل يختلف ذلك باختلاف حجم العميل أو نوع التأمين؟

Cash, bank transfer, cheque, CliQ — and does it differ by client size or by line?

**ما الذي يقرره / What it decides.** The payment-channel list is currently a table an
office fills in with no guidance on what belongs in it. His actual channels are that
list. It also decides whether "a receipt" is one thing or several with different
evidence attached to each.

### ٢. هل يحوّل لشركة التأمين المبلغ كاملاً أم صافياً بعد العمولة؟ / Does he remit gross or net of commission?

وهل يختلف ذلك من شركة لأخرى؟

And does it differ from insurer to insurer?

**ما الذي يقرره / What it decides.** This is the single largest unknown in the finance
model. Gross-then-invoice and net-at-source produce different ledgers, different
reconciliation, and a different answer to "what does the insurer owe us". The code
currently carries both a `commissionDeducted` and a `netRemittance` concept without a
statement of which is the real practice.

### ٣. كيف تصل مطالبة مدفوعة إلى العميل؟ / How does a claim payment reach the customer?

هل تمرّ عبر حساب الوسيط أم تدفع شركة التأمين للعميل مباشرة؟ ومن يُبلغ العميل؟

Through the broker's account, or does the insurer pay the customer directly? And who
tells the customer?

**ما الذي يقرره / What it decides.** Whether the broker's client-funds ledger is on the
claims path at all. If the insurer pays directly, the broker's record is a notification
and not a movement — a materially smaller and different build.

### ٤. كيف يعالج استرداداً صغيراً مقابل القسط التالي؟ / How does he handle a small refund against a next premium?

هل يُخصم من التجديد بدل أن يُدفع؟ ومن يقرر ذلك؟

Offset against the renewal rather than paid out? And who decides?

**ما الذي يقرره / What it decides.** Offset is the feature most likely to be assumed
into existence. Today a refund is either paid or not paid; there is no offset concept,
and inventing one before hearing how he does it is how a finance module acquires a
workflow nobody uses.

### ٥. كيف يعالج شيكات الأقساط المؤجلة؟ / How does he handle post-dated instalment cheques?

متى يُسجَّل الشيك — عند الاستلام أم عند التحصيل؟ وماذا يحدث عند ارتداده؟

Recorded when received or when cleared? And what happens when one bounces?

**ما الذي يقرره / What it decides.** Whether a cheque needs a state machine
(received → deposited → cleared → bounced) or is just a payment method label. A bounced
cheque after a policy is in force is a commercial situation with a procedure, and that
procedure is his, not ours.

### ٦. من في مكتبه يرى نسب العمولة؟ / Who in his office sees commission rates?

الجميع؟ المالية فقط؟ هل يراها موظف المبيعات الذي أبرم الصفقة؟

Everyone, Finance only, or the sales officer who placed the business?

**ما الذي يقرره / What it decides.** A visibility rule, and visibility rules are cheap
to build and expensive to retrofit — the rate reaches several screens and at least one
document. It is also a question with a real answer in his office already.

---

## أضيفت من القياس / Added from measurement

*Each of these is something the deferred work touched and we could not answer.*

### ٧. ماذا يجب تسجيله عند دفع استرداد؟ / What must be recorded when a refund is paid?

**القياس، 2026-09-28**: مسار صرف الاسترداد **لا يسجّل طريقة دفع ولا مرجعاً خارجياً**.
`POST /refunds/:id/disburse` لا يأخذ أي محتوى في الطلب: يختم وقت الدفع، ويكتب قيداً في
دفتر أموال العملاء بمرجع مُولَّد داخلياً (`refund:<id>`)، ويحفظ هويّتي الطرفين.

**Measured 2026-09-28: the refund disbursement records no payment method and no
external reference.** The route takes **no request body at all** — it stamps `paidAt`,
writes a client-funds ledger entry with a system-derived reference, and keeps the
maker/checker ids.

**ما الذي يقرره / What it decides.** Whether a paid refund can be reconciled against a
bank statement at all. Today it cannot: nothing records which account it left from or
what reference the bank will show. **Flagged because the owner believed this route
already captured a method from the channel list and a mandatory reference — it does
not.** Left exactly as it is, per the deferral; the question is what he needs on it.

### ٨. في أي لحظات ينتقل المال فعلياً؟ / At which moments does money actually move?

**ما الذي يقرره / What it decides.** The AMLU requires screening *"before processing any
transaction"* and no path in this system consults screening (§ 1.58, obligation 2, and
now in README § Known gaps). Before that can be built, somebody has to say which events
in his office ARE transactions — receipt, remittance, claim payment, refund, commission
settlement — and which of them a screening result should be able to stop. **The
compliance half is a sourcing question; this half is a question about his day**, and it
is the one that makes the other answerable.

### ٩. كم أمامه من وقت ليحوّل لشركة التأمين؟ / How long does he have to remit to the insurer?

وهل تختلف المهلة من شركة لأخرى، وماذا يحدث إن تأخّر؟

Does the window differ by insurer, and what happens if he is late?

**ما الذي يقرره / What it decides.** Insurer credit terms are in the deferred set and
currently have no representation. This is also the only money question that produces a
DEADLINE, which means it lands on the SLA machinery rather than the ledger — a different
part of the system from the rest of this list.

### ١٠. عند تغيّر نسبة العمولة، أي نسبة تحكم بوليصة قائمة؟ / When a commission rate changes, which rate governs a live policy?

**ما الذي يقرره / What it decides.** `CommissionAgreement.effectiveFrom` already decides
this — the agreement in force on a date governs — but nobody has confirmed that matches
his practice. If a renegotiated rate is meant to apply to business already placed, the
current model gives the wrong answer silently and every commission figure drifts.

---

# ما ليس عن المال / Not about money

*Same rule: each question carries what it DECIDES.*

### ١١. بنماذج كم شركة تأمين يعمل فعلاً، وكيف يملؤها اليوم؟ / How many insurers' forms does he actually use, and how does he fill them today?

وهل إعادة إدخال البيانات نفسها في نموذج كل شركة كلفة حقيقية في يومه، أم أمر هامشي؟

And is re-keying the same data into each insurer's form a real cost in his day, or a
marginal one?

**ما الذي يقرره / What it decides.** § 1.67 — the largest remaining item, and the only one
on the unreachable-routes list that is a FEATURE rather than a missing button. The system
can hold a map of each insurer's proposal form so an office fills the fields once; a map
runs to **300 fields**, each with an Arabic name, an English name, a type, an order,
whether it is required and its options. That is a bilingual form builder.

**Measured 2026-09-28: zero maps and zero fields exist on either database**, against 19
and 480 insurers — so nothing is lost by waiting, there is no accumulation and no
migration. **No option has been chosen deliberately**: his answer may remove both of them
(transcribe each form once, or extract from the insurer's file), because if he works with
three insurers and fills their forms in minutes, the builder is a solution to a problem he
does not have. If it IS needed, the plan is one insurer and one line first, to learn the
true cost before committing.

### ١٢. إن وقعت عطلة رسمية يوم جمعة أو سبت، هل يُعوَّض يوم عمل بديل؟ / If an official holiday falls on a Friday or Saturday, does the office get a substitute working day?

**ما الذي يقرره / What it decides.** Every SLA deadline in the system is counted in
WORKING days, so a substitute day that the calendar does not carry makes the deadline land
one day early — the same direction of error as the empty calendar, against the brokerage.
It is recoverable, because holiday entry is manual and an office can add the day; **but the
office has to know to.** If substitution is the practice, the per-year screen should ask
for it alongside the occasion rather than leaving somebody to remember.

Not a build item — an input. Raised by the owner 2026-09-28.

### ١٣. أين يعمل موظف المالية فعليًا؟ ما الشاشة التي يفتحها ليقبض ويدفع ويصدر فاتورة؟ / Where does the Finance officer actually work — which screen does he open to take a payment, pay a refund, and raise an invoice?

**ما الذي يقرره / What it decides.** **SIX Finance capabilities are unreachable by the only
role that holds them**, measured 2026-09-29 by
`scripts/measurements/permission-reachability.py`: `receipt.record`, `invoice.create`,
`commission.calculate`, `refund.approve`, `refund.disburse` and
`claim.settle.second-approve`. One cause — every one of those controls sits on
`/opportunities/[id]`, and FINANCE_COLLECTIONS_OFFICER does not hold `opportunity.read`.
So money cannot be taken in or paid out from anywhere a Finance officer can navigate to.

**The fix direction is already settled and is not his to decide**: the control moves to
where Finance works, rather than widening Finance's view of the sales pipeline for the sake
of a button. **The only missing input is which screen that is** — and that is his knowledge.
An opportunity is a SALES artifact; a Finance officer does not think in opportunities, he
thinks in a customer, a policy, an invoice, or a day's receipts. Which of those does he
actually open?

**Why it is a question and not a design task.** Guessing produces a Finance screen nobody
uses, and the six controls would stay effectively unreachable while appearing fixed — the
same failure one level up. Ask what he opens first each morning and what he has in his hand
when he takes a payment.

Raised from measurement 2026-09-29, deferred with the money work by the owner.

### ١٤. هل تُصدَر وثيقة بقسط صفر أحيانًا؟ / Does a policy ever get issued with a ZERO premium?

**ما الذي يقرره / What it decides.** **Two sibling writes on one concept disagree, and which one is
wrong is a domain fact neither of us has.** Measured 2026-09-29 (item 5 batch 1):

    quotation   `normalizeQuotationTerms` REFUSES a zero premium —
                "premium must be greater than zero — a quotation with no premium is not a quote"
    issuance    `recordIssuance` refuses only a NEGATIVE `issuedPremium`. Zero is accepted.

And the zero does not merely sit there: `LossRatio.periodPremium` is
`issuedPremium ?? requestedPremium`, so a zero ISSUED premium **wins** through `??` rather than falling
back to the requested one — and `computeLossRatio` would then store `ratio = 0` standing in for "there is
no ratio".

**His answer decides which side changes.** Is a zero-premium issuance a real thing —
a courtesy, an endorsement carrying no premium of its own, a temporary cover note issued while pricing is
still being settled?

  * **If YES** — the ISSUANCE path is right and the QUOTATION path is wrong: it must permit a zero premium,
    and the loss-ratio computation needs to say "no ratio" rather than zero for that case.
  * **If NO** — the issuance path is wrong and must refuse zero exactly as the quotation does, with the
    same sentence, so the two stop disagreeing.

**NOTHING IS BROKEN TODAY, and that is why this is a question rather than a defect.** Counted rather than
inspected: **0 of 3 `LossRatio` rows on db-test and 0 on dev have `periodPremium = 0`**, and none is in
the substituted state (premium 0 AND ratio 0). So this is a contradiction to close, **not data to repair**.
`LossRatio` also stores `periodClaims` and `periodPremium` on the same row as `ratio`, so even if one
appeared, a reader of the stored data could still tell 0/0 from a real zero.

Raised from measurement 2026-09-29, deferred with the money work by the owner. Do not build either side
before his answer — one of the two paths is wrong and guessing which changes a premium rule.
