# A decision for the owner: what happens when there is nobody else to check your access

**One question, three answers. It needs deciding before we build this part.**

---

## The situation

Every so often the system runs an **access review**: someone goes down the list of people and confirms that
each one still needs the access they have. The rule is that you cannot be the person who checks your own.

In an office with one person, there is nobody else. Today that means the review **cannot be started at all** —
not "she does it and we note it", but the button does not work. You have already decided this should change:
she should be able to do it, and it should be visible afterwards rather than impossible.

## What we found while building it

The system decides **who reviews whom when the review round is opened**, not when each person is actually
reviewed. So in a one-person office, the moment where "she is checking herself" happens is the moment she
**opens the round** — before she has reviewed anything.

That matters because of the condition you set: *a person's review of their own access appears at the top of
the self-approval report, flagged*. As things are built, the first natural place to ask her why is the
opening of the round, not the review itself. So the report would show the day she opened the round, not the
day she did the review.

That is a drafting mismatch, not a problem with the work — but it is yours to settle, because the three ways
out differ in what she sees and what the report says.

---

## Option 1 — ask once, when she opens the round

**In one sentence:** when she opens a review round and there is nobody else to check her own access, she says
why once, at that moment, and the round opens.

**What she sees:** opening the round asks for a reason — one box, once. The review itself then works exactly
as it does for any office: she goes through each person, including herself, and confirms or changes.

**What the report says:**

> **1 March** — Owner was set to review her own access. *"I am the only person in this office."*

**The cost:** the report is dated to the day the round was opened and says she was *set to* review her own
access. If she opens the round on the 1st and does the review on the 14th, the report says the 1st, and it
never records that the review itself happened. An auditor reading it learns the arrangement, not the act.

---

## Option 2 — ask again when she signs off her own access

**In one sentence:** the same as Option 1, plus a second reason at the moment she actually confirms her own
access.

Worth being clear: the first question is unavoidable in every option except the third. Option 2 is Option 1
**plus** a second one. The question you are really deciding is whether the report should also record the
review itself.

**What she sees:** a reason when she opens the round, and a second reason box on her own row when she
confirms it. Everyone else's rows are untouched.

**What the report says — two lines for one arrangement:**

> **14 March** — ⚑ Owner reviewed her own access, and confirmed it. *"Still the only person here."*
> **1 March** — Owner was set to review her own access. *"I am the only person in this office."*

**The cost:** two entries where one thing happened, so anybody reading the report has to understand that the
pair belongs together. And she types a reason twice per round — which, in practice, is how "as above" gets
typed into the second box. The upside is that the flagged top line is dated to the day she actually reviewed
her own access and says what she did, which is what your condition asks for.

To be concrete about volume: a one-person office produces one review round at a time, so this is two lines
per round — a handful a year, not a wall of them.

---

## Option 3 — decide who reviews whom later

**In one sentence:** stop deciding who reviews whom when the round opens, and decide it at the moment each
review is done — so the only question she is ever asked is on her own row, at the time she reviews it.

**What she sees:** the cleanest of the three. The round opens with no questions at all. Only her own row asks
why, at the moment she confirms it.

**What the report says:** exactly one line, dated to the review, saying what she did.

> **14 March** — ⚑ Owner reviewed her own access, and confirmed it. *"I am the only person in this office."*

**The cost, and it is the largest:** this changes how review rounds work **for every office**, not just
one-person ones. Today a round opens as a work list — "these five people are yours to review" — and that is
what makes it something a manager can be given and chased on. Taking the names out of the opening means the
round no longer tells anyone what they have to do until they do it, and we would be rebuilding the part that
decides who gets whom. That part has already had one defect fixed in it, where which reviewer a person got
was effectively arbitrary; reopening it risks the same thing.

So: the best-looking result, the biggest change, and it touches offices that do not have this problem.

---

## What I would choose, and why

**Option 2.**

The condition exists so that whoever reads the report sees, at the top, that somebody checked their own
access — **and when**. Option 1 gives them the wrong date and the weaker verb: "was set to review" is an
arrangement, not an act, and it is silent about whether the review ever happened. Option 3 gives exactly the
right answer but rebuilds a working part of the system for every office in order to serve one.

Option 2's cost is one extra line in a report that will be short, and the two lines are honestly two
different facts: *she was set to review herself* and *she did review herself*. We can print them as a pair so
they read as one story rather than two events, and flag only the second.

The one thing I would not do is Option 1. It satisfies the letter of "record it" while quietly dropping the
part your condition was actually about.

---

*Written in English for relaying. If this goes to her directly, say so and I will mirror it in Arabic first —
this product's own rule is Arabic first for anything she reads.*
