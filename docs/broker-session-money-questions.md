# أسئلة المال للوسيط — قائمة تُضاف إليها
# Money questions for the broker — a running list

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
