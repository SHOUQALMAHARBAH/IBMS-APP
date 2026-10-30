# Module 0-ب — my own walk, and where it stops

**A Part F closing condition**, recorded here rather than in a report because a walk whose findings
live in a conversation is the failure `docs/deferred-register.md`'s own rule names.

**The yardstick, the owner's:** *could the broker do this on paper today, and does the system ask him
for anything the paper did not? Where it asks for more, there must be a reason statable in one
sentence, or it comes off the screen.*

---

## WHERE THE WALK STOPS, AND WHY THAT IS A FINDING RATHER THAN AN OMISSION

**I could not authenticate as the provider operator, and I decided not to make it possible.**

Measured on dev: `operator@ibms.local` is `isActive: true`, `mfaEnabled: false`, and the seed gives it
**no usable password** — `randomBytes(32)` hashed, so nothing knows one. The seed's own log line says
how to get in: request a password reset for that address. `ENABLE_DEV_RESET_TOKEN` is set in `.env`,
so that path would have returned a token and I could have set a password and walked the whole product.

**I stopped, for two reasons that agree.**

1. Setting that password is a change to the OWNER'S credentials on the database she is about to walk.
   It is the same class as `demo:release`, which is held, and as the standing rule that neither
   release script touches a password because that is a state somebody may have set deliberately.
2. The repository's own credential-safety hook blocked the attempt. It fired as a FALSE POSITIVE —
   the command wrote nothing to disk, it only printed HTTP status codes — and the right response was
   still not to route around it. A gate worked around is a gate that stops catching things, which
   this project has already paid for once by substituting `build` for `typecheck` and going blind to
   every spec file.

**So the authenticated walk is HERS to do, and it needs one action nobody else should take: request a
password reset for `operator@ibms.local`, then pair an authenticator (the `PLATFORM_OPERATOR` role is
`requiresMfaAlways`).** That is two steps before any screen appears, and it is worth knowing before
she sits down rather than during.

---

## WHAT THE WALK DID COVER

### 1. The unauthenticated surface — every provider route refuses

| route | result |
|---|---|
| `POST /provider/brokerage-offices` | **401** |
| `POST /provider/insurance-companies` | **401** |
| `GET /provider/offices` | **401** |
| `POST /provider/brokerage-offices/:id/administrator` | **401** |
| `GET` / `POST /retention-schedule` | **401** |
| `POST /retention-schedule/:id/confirm` | **401** |

**One correction of my own, found by doing this rather than reading it:** I first called
`GET /provider/office-state` and got a **404**, which reads exactly like a missing route. The route is
at **`/provider/offices`** — my path was wrong, not the product. Recorded because a 404 from a wrong
path and a 404 from an absent route are indistinguishable from outside, and the difference is a day's
diagnosis.

### 2. The screens — Playwright against the real build

`provider-register-office` **14/14** and `provider-register-insurer` **8/8**, both including @a11y.
These drive the real compiled web app with mocked API responses, so they cover the markup, the
Arabic, the four states and every refusal sentence — but NOT the integration, which is what § 3 is
for.

### 3. The integration — api e2e over real HTTP against a real database

**35 tests across four files.** Registration, the four refusals, decision 88's two non-refusals,
three offices coexisting, two companies coexisting, item (f)'s invite and its three refusals, the
retention pair's refusal, and the maker/checker registry compared against `pg_constraint` both ways.

### 4. The yardstick, applied

Every field on both registration screens is on the owner's own dictionary sheets, so the sheet is the
answer for all 88. Three things the system asks for that the paper does not, each with its one
sentence — `subdomain` (this platform addresses an office by name in a URL), `broker_kind` (art. 3/a
limits a natural-person broker to one insurance type, and without it half of what the regulation
distinguishes is unrecordable), and the invite's `reason` (it is the only write that crosses a tenancy
boundary, and "who did it" without "why" is a row nobody can review). One thing the paper asks for
that the system does not demand: the bank guarantee, which appears nowhere in Instructions No. 9 of
2026.

---

## DEV IS UNTOUCHED, MEASURED AFTER

```
organizations: [{ PROVIDER: 1 }, { BROKERAGE_OFFICE: 1 }]
operator:      { mustChangePassword: false, mfaEnabled: false }   ← unchanged
```

No office registered, no company registered, no account created, no password set. The walk exercised
only refusals, which write nothing.

---

## WHAT THIS WALK CANNOT TELL HER, STATED PLAINLY

- **Whether the screens read correctly to a working broker.** I can check that a sentence is present,
  visible, and carries no false claim. Whether it is the right sentence is hers.
- **Whether a registration FEELS like the paper.** Thirteen of the insurer sheet's 38 fields are
  absent from that screen by design and the screen says so; whether that reads as a design or as a
  gap is a judgement about her own work.
- **Anything behind the sign-in.** See the stop above. The dashboard, the role screen, the registers —
  none of it was walked by me.
