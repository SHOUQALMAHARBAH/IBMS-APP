"""EVERY ROUTE HANDLER THAT IS NEITHER PERMISSION-GUARDED NOR `@Public()` — a ratchet at 14.

## WHY THIS EXISTS

`docs/module-1-design-reports.md` § 6.3 measured the api's 531 route handlers and found **14 that
carry neither `@RequirePermissions` nor `@Public()`**. Every one of the fourteen is by decision, on
one principle: **it acts on `@CurrentUser()`'s OWN row** — your own password, your own trusted
devices, your own TOTP enrolment, your own notifications, your own conflict-of-interest disclosure,
your own company's registry record. A permission answers *may you act on the OFFICE's data*, and
none of these touch it; gating them would let a role be configured to hide a person's own alerts
from them, or to lock them out of enrolling MFA.

That report closed with the sentence this script exists to answer:

    "The number to watch is the 14, not the individual routes: a fifteenth unguarded route that is
     NOT self-service is the defect, and nothing counts them today."

Nothing counted them. So a new handler written with no decorator at all — the easiest mistake in a
NestJS controller, because it compiles, serves and looks finished — joined the fourteen in silence.

## IT FAILS IN BOTH DIRECTIONS, AND THE SECOND ONE IS THE POINT

  * an UNDECLARED unguarded route fails, named, with the remedy;
  * a DECLARED route that has since been guarded (or deleted, or made `@Public()`) ALSO fails,
    demanding the declaration be removed — otherwise this list rots into a permanent amnesty and
    the next unguarded route hides behind a stale entry.

A bare count would pass the day someone guards one of the fourteen and adds a new unguarded one, so
the declaration pins the SET by name, not the number. `legal-numbers.py`'s `DECLARED_FIGURES` is the
same reasoning one level down.

## WHAT "GUARDED" MEANS HERE, MEASURED RATHER THAN ASSUMED

A handler is guarded when `@RequirePermissions` sits on the handler OR on its controller class —
Nest applies a class decorator to every route in the class, so reading only the handler would report
every route of a class-guarded controller as unguarded. Same for `@Public()`.

`@RequireStepUp` is deliberately NOT counted as a guard. `StepUpGuard` asks *did this person
re-authenticate*, never *may this person act* — the two refuse with the same 403 and are not the
same control, which is the recorded 2026-11-07 finding about guard ORDER. A route carrying step-up
and no permission is still unguarded for this script's purpose.

## THE UNIT IS A HANDLER, NOT A PATH

One method = one row. A `@Get()` and a `@Get(':id')` in one controller are two handlers and two
rows, because they are two things a reader can forget to guard.

Usage:
    python scripts/measurements/unguarded-routes.py              # the gate
    python scripts/measurements/unguarded-routes.py --self-test  # the gate's own tests
"""

import io
import os
import re
import sys

sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
API_SRC = os.path.join(ROOT, "apps", "api", "src")

ROUTE_DECORATOR = re.compile(r"^\s*@(Get|Post|Put|Patch|Delete|Head|Options|All)\s*\(")
PERMISSION_DECORATOR = re.compile(r"^\s*@RequirePermissions\s*\(")
PUBLIC_DECORATOR = re.compile(r"^\s*@Public\s*\(")
CLASS_DECL = re.compile(r"^\s*(?:export\s+)?(?:abstract\s+)?class\s+(\w+)")
# A class member that is not a decorator and not a field: `name(`, `async name(`, `private name(`.
MEMBER = re.compile(
    r"^\s{2,}(?:public\s+|private\s+|protected\s+)?(?:async\s+)?(\w+)\s*(?:<[^>]*>)?\s*\("
)
QUOTED = re.compile(r"'(?:[^'\\]|\\.)*'|\"(?:[^\"\\]|\\.)*\"|`(?:[^`\\]|\\.)*`")


def code_of(line: str) -> str:
    """The line with string CONTENTS blanked and a trailing `//` comment removed.

    Blanking the contents rather than the whole literal keeps the quotes, so a decorator spanning a
    string that contains `//` (a URL) or `@Get(` cannot be misread. Same tokeniser reasoning as
    `legal-numbers.py`'s `code_of` and the brain's `code_text.py`.
    """
    blanked = QUOTED.sub(lambda m: m.group(0)[0] * 2, line)
    return blanked.split("//", 1)[0]


def strip_block_comments(lines: list[str]) -> list[str]:
    """Blank every line inside a `/* ... */` block, keeping the line COUNT so numbers stay true.

    A doc comment quoting `@Get('/x')` or `@RequirePermissions('a')` — which this repository's
    comments do constantly, because they explain the gating — would otherwise be read as a
    decorator. That is the comment-quotes-the-pattern blindness this repo has paid for five times.
    """
    out: list[str] = []
    in_block = False
    for raw in lines:
        line = raw
        if in_block:
            if "*/" in line:
                in_block = False
                line = line.split("*/", 1)[1]
            else:
                out.append("")
                continue
        # `/*` outside a string literal opens a block.
        probe = QUOTED.sub(lambda m: m.group(0)[0] * 2, line)
        if "/*" in probe:
            before = line[: probe.index("/*")]
            rest = probe[probe.index("/*") :]
            if "*/" in rest:
                after_at = probe.index("/*") + rest.index("*/") + 2
                line = before + line[after_at:]
            else:
                in_block = True
                line = before
        out.append(line)
    return out


class Handler:
    def __init__(self, path: str, cls: str, method: str, line: int):
        self.path = path
        self.cls = cls
        self.method = method
        self.line = line
        self.guarded = False
        self.public = False

    @property
    def key(self) -> str:
        return f"{self.path}:{self.method}"


def analyse_source(rel: str, text: str) -> list[Handler]:
    """Every route handler in one controller file, with its guard state."""
    lines = strip_block_comments(text.splitlines())

    # Class-level decorators: everything above the FIRST class declaration that carries one.
    class_name = ""
    class_decl_index = None
    for i, raw in enumerate(lines):
        if CLASS_DECL.match(code_of(raw)):
            class_name = CLASS_DECL.match(code_of(raw)).group(1)
            class_decl_index = i
            break
    class_guarded = False
    class_public = False
    if class_decl_index is not None:
        for raw in lines[:class_decl_index]:
            code = code_of(raw)
            if PERMISSION_DECORATOR.match(code):
                class_guarded = True
            if PUBLIC_DECORATOR.match(code):
                class_public = True

    handlers: list[Handler] = []
    pending_route_line: int | None = None
    pending_guarded = False
    pending_public = False
    depth = 0  # bracket depth across a multi-line decorator argument list

    for i, raw in enumerate(lines):
        code = code_of(raw)
        if depth > 0:
            depth += code.count("(") - code.count(")")
            continue
        if ROUTE_DECORATOR.match(code):
            pending_route_line = i + 1
            depth = code.count("(") - code.count(")")
            continue
        if PERMISSION_DECORATOR.match(code):
            pending_guarded = True
            depth = code.count("(") - code.count(")")
            continue
        if PUBLIC_DECORATOR.match(code):
            pending_public = True
            depth = code.count("(") - code.count(")")
            continue
        if code.lstrip().startswith("@"):
            # Any other decorator (`@RequireStepUp`, `@Body`, `@AuditLog`, ...). Consume its
            # argument list so a multi-line one cannot be mistaken for a member.
            depth = code.count("(") - code.count(")")
            continue
        member = MEMBER.match(code)
        if member and pending_route_line is not None:
            h = Handler(rel, class_name, member.group(1), pending_route_line)
            h.guarded = pending_guarded or class_guarded
            h.public = pending_public or class_public
            handlers.append(h)
            pending_route_line = None
            pending_guarded = False
            pending_public = False
            continue
        if member:
            # A member with no route decorator ends any stray decorator state.
            pending_guarded = False
            pending_public = False
    return handlers


# ------------------------------------------------------------------------------------------------
# THE DECLARATION. Fourteen handlers, each acting on `@CurrentUser()`'s OWN row.
#
# `docs/module-1-design-reports.md` § 6.3 carries the measurement and the principle. Adding a row
# here is a DECISION that a new route touches nothing but the caller's own data; it is not a way to
# make this script quiet.
# ------------------------------------------------------------------------------------------------
DECLARED_SELF_SERVICE: dict[str, str] = {
    # ELEVEN IN `auth.controller.ts`. Every one reads or writes the authenticated caller's own
    # credential, session or preference; none can be asked about another person, because none takes
    # a user id at all.
    "modules/auth/auth.controller.ts:changePassword": "changes the caller's OWN password",
    "modules/auth/auth.controller.ts:listTrustedDevices": "lists the caller's OWN trusted devices",
    "modules/auth/auth.controller.ts:revokeTrustedDevice": "revokes one of the caller's OWN trusted devices",
    "modules/auth/auth.controller.ts:logout": "ends the caller's OWN session",
    "modules/auth/auth.controller.ts:enrollTotp": "enrols the caller's OWN TOTP credential — and `/settings/security` being ungated is already a recorded requirement, because gating it loses MFA enrolment for 10 of 11 roles",
    "modules/auth/auth.controller.ts:verifyTotpEnrollment": "verifies the caller's OWN TOTP enrolment",
    "modules/auth/auth.controller.ts:disableTotp": "disables the caller's OWN TOTP credential",
    "modules/auth/auth.controller.ts:stepUp": "re-authenticates the CALLER — a step-up asks *did this person re-authenticate*, never *may this person act*",
    "modules/auth/auth.controller.ts:me": "reads the caller's OWN profile",
    "modules/auth/auth.controller.ts:updateLanguagePreference": "sets the caller's OWN language preference",
    "modules/auth/auth.controller.ts:heartbeat": "touches the caller's OWN session",
    # AND THREE OUTSIDE IT, each with its reason already written at its own site.
    "modules/company/company-record.controller.ts:ownRecord": "reads the caller's OWN organization's registry record — the controller's own comment records that there is no `:id`, so the route cannot be asked about another company at all",
    "modules/compliance-risk/conflict-of-interest.controller.ts:declare": "files the caller's OWN conflict-of-interest disclosure — OWNER DECISION 80, cited at `conflict-of-interest.controller.ts`: a code here would be a checkbox an office could uncheck, leaving the person who HAS the conflict as the one person unable to say so. The GET beside it IS gated",
    "modules/notification/notification.controller.ts:list": "lists the caller's OWN notifications — and the filtering is per SOURCE inside `notification.service.ts`, on the permission guarding each source's own screen, so every signed-in user gets an answer and what is in it depends on what they may already open",
}


def controller_files() -> list[str]:
    out: list[str] = []
    for dirpath, _dirnames, filenames in os.walk(API_SRC):
        for name in filenames:
            if not name.endswith(".controller.ts"):
                continue
            if ".spec." in name or name.endswith(".e2e-spec.ts"):
                continue
            full = os.path.join(dirpath, name)
            out.append(os.path.relpath(full, API_SRC).replace(os.sep, "/"))
    return sorted(out)


def run_gate() -> int:
    handlers: list[Handler] = []
    for rel in controller_files():
        with io.open(os.path.join(API_SRC, rel), encoding="utf-8") as fh:
            handlers.extend(analyse_source(rel, fh.read()))

    guarded = [h for h in handlers if h.guarded]
    public = [h for h in handlers if h.public and not h.guarded]
    neither = [h for h in handlers if not h.guarded and not h.public]

    print(f"route handlers scanned : {len(handlers)}")
    print(f"  permission-guarded   : {len(guarded)}")
    print(f"  @Public() only       : {len(public)}")
    print(f"  NEITHER              : {len(neither)}")

    errors: list[str] = []

    # NON-VACUITY. A parse that found nothing would otherwise report a clean sweep.
    if len(handlers) < 400:
        errors.append(
            f"only {len(handlers)} route handlers were found, which is far below the measured 531 — "
            f"the decorator parse has broken, and a gate that sees no routes cannot see an "
            f"unguarded one."
        )

    found_keys = {h.key for h in neither}
    for h in sorted(neither, key=lambda x: x.key):
        if h.key not in DECLARED_SELF_SERVICE:
            errors.append(
                f"{h.path}:{h.line} — `{h.method}` carries NEITHER @RequirePermissions nor "
                f"@Public(). Add the permission the act needs, or — if it genuinely acts only on "
                f"`@CurrentUser()`'s own row — declare it in DECLARED_SELF_SERVICE with that reason."
            )
    for key, reason in sorted(DECLARED_SELF_SERVICE.items()):
        if key not in found_keys:
            errors.append(
                f"{key} is declared self-service ({reason}) but is NOT unguarded any more — it is "
                f"now guarded, public, or gone. DELETE its line from DECLARED_SELF_SERVICE: a stale "
                f"amnesty is where the next unguarded route hides."
            )

    print(f"  declared self-service: {len(DECLARED_SELF_SERVICE)}")
    if errors:
        print()
        for e in errors:
            print(f"FAIL  {e}")
        return 1
    print("\nok — every unguarded route handler is declared, and every declaration is still live.")
    return 0


# ------------------------------------------------------------------------------------------------
# SELF-TEST. The gate runs over real source; these run the ANALYSER over sources whose answer is
# known, because a parser that reports a plausible number is the failure mode a gate cannot show.
# ------------------------------------------------------------------------------------------------
CASES: list[tuple[str, str, list[tuple[str, bool, bool]]]] = [
    (
        "a guarded handler",
        """
@Controller('x')
export class XController {
  @RequirePermissions('x.read')
  @Get()
  list() {}
}
""",
        [("list", True, False)],
    ),
    (
        "a @Public() handler",
        """
@Controller('x')
export class XController {
  @Public()
  @Post('signup')
  signup() {}
}
""",
        [("signup", False, True)],
    ),
    (
        "neither",
        """
@Controller('x')
export class XController {
  @Get('me')
  me() {}
}
""",
        [("me", False, False)],
    ),
    (
        "CLASS-level @RequirePermissions guards every handler in the class",
        """
@Controller('x')
@RequirePermissions('x.read')
export class XController {
  @Get()
  list() {}
  @Get(':id')
  get() {}
}
""",
        [("list", True, False), ("get", True, False)],
    ),
    (
        "CLASS-level @Public() covers every handler",
        """
@Controller('x')
@Public()
export class XController {
  @Get()
  list() {}
}
""",
        [("list", False, True)],
    ),
    (
        "a MULTI-LINE @RequirePermissions still guards",
        """
@Controller('x')
export class XController {
  @RequirePermissions(
    'x.read',
    'x.list',
  )
  @Get()
  list() {}
}
""",
        [("list", True, False)],
    ),
    (
        "a MULTI-LINE route decorator still registers",
        """
@Controller('x')
export class XController {
  @Get(
    ':id/things',
  )
  get() {}
}
""",
        [("get", False, False)],
    ),
    (
        "@RequireStepUp is NOT a permission guard",
        """
@Controller('x')
export class XController {
  @RequireStepUp()
  @Post('export')
  exportAll() {}
}
""",
        [("exportAll", False, False)],
    ),
    (
        "a BLOCK COMMENT quoting @RequirePermissions does not guard the handler below it",
        """
@Controller('x')
export class XController {
  /** Reading carries @RequirePermissions('x.read') on its sibling, deliberately. */
  @Get('me')
  me() {}
}
""",
        [("me", False, False)],
    ),
    (
        "a BLOCK COMMENT quoting @Get does not invent a handler",
        """
@Controller('x')
export class XController {
  /*
   * The old shape was @Get('legacy') and it was removed.
   */
  @RequirePermissions('x.read')
  @Get()
  list() {}
}
""",
        [("list", True, False)],
    ),
    (
        "a LINE COMMENT quoting @Public does not make the handler public",
        """
@Controller('x')
export class XController {
  // was @Public() until 2026-10-01
  @Get('me')
  me() {}
}
""",
        [("me", False, False)],
    ),
    (
        "a decorator inside a STRING does not count",
        """
@Controller('x')
export class XController {
  @Get('me')
  me() {
    return '@RequirePermissions("x.read")';
  }
}
""",
        [("me", False, False)],
    ),
    (
        "a non-route method is not a handler",
        """
@Controller('x')
export class XController {
  constructor(private readonly svc: S) {}
  private helper() {}
  @Get()
  list() {}
}
""",
        [("list", False, False)],
    ),
    (
        "parameter decorators between the route and the method do not break the pairing",
        """
@Controller('x')
export class XController {
  @RequirePermissions('x.read')
  @Get(':id')
  @HttpCode(200)
  get(@Param('id') id: string, @CurrentUser() u: AuthenticatedUser) {}
}
""",
        [("get", True, False)],
    ),
    (
        "a guard decorator on one handler does not leak to the next",
        """
@Controller('x')
export class XController {
  @RequirePermissions('x.read')
  @Get()
  list() {}
  @Get('me')
  me() {}
}
""",
        [("list", True, False), ("me", False, False)],
    ),
]


def self_test() -> int:
    passed = 0
    failed = 0
    for name, src, expected in CASES:
        got = [(h.method, h.guarded, h.public) for h in analyse_source("f.controller.ts", src)]
        if got == expected:
            passed += 1
            print(f"  ok   {name}")
        else:
            failed += 1
            print(f"  FAIL {name}\n       expected {expected}\n       got      {got}")
    print(f"\nself-test: {passed}/{passed + failed}")
    return 1 if failed else 0


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        sys.exit(self_test())
    rc = self_test()
    if rc != 0:
        print("\nFAIL  the gate's own self-test failed — its reading of the tree is not trustworthy.")
        sys.exit(rc)
    print()
    sys.exit(run_gate())
