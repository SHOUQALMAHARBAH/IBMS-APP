# -*- coding: utf-8 -*-
"""A SECOND pass over IMPROVEMENTS § 1.44, closing the blind spot the first one declares.

`unreachable-routes.py` is verb-agnostic and says so in its own docstring: it answers "does any web
code address this path at all". That makes its count a LOWER BOUND, because a route whose path is
called with a different method reads as reachable. `POST /insurance-lines` is the case that exposed
it — the web calls `GET /insurance-lines` for a picker, so the POST looked covered while nothing
can add a line of business.

This pass pairs the helper with the method:

    apiGet -> GET        apiPost -> POST      apiPatch -> PATCH
    apiPut -> PUT        apiDelete -> DELETE  apiFetchBlob -> GET

WHAT IT DELIBERATELY DOES NOT DECIDE
------------------------------------
`apiFetch`, `authFetch` and `request` take the method as an option, so a path reached only through
one of those is reported as METHOD-UNKNOWN rather than as unreachable. Guessing would libel working
code, which is the mistake the first pass had to be corrected for four times. A METHOD-UNKNOWN row
is a question for a person, not a finding.

Run from the repo root. A measurement, never a gate — the same reasoning as its sibling.
"""
import io
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib.util

spec = importlib.util.spec_from_file_location(
    'unreachable_routes',
    os.path.join(os.path.dirname(os.path.abspath(__file__)), 'unreachable-routes.py'),
)
base = importlib.util.module_from_spec(spec)

# The sibling has no `if __name__ == '__main__'` guard: importing it runs its whole
# report and then reads `sys.argv[1]`. Rather than edit a script whose output is the
# established record, borrow its functions with its own main body neutralised — argv
# faked so its final write has a target, and stdout swallowed so its report does not
# interleave with this one. Its FUNCTIONS are the contract being reused; its printing
# is not.
_argv, _stdout = sys.argv, sys.stdout
sys.argv = [spec.origin, os.devnull]
sys.stdout = io.StringIO()
try:
    spec.loader.exec_module(base)
finally:
    sys.argv, sys.stdout = _argv, _stdout

HELPER_METHOD = {
    'apiGet': 'GET',
    'apiPost': 'POST',
    # The multipart upload helper. Without this row the first multipart caller in the app reads as
    # no caller at all — `apiPost` matches its prefix and then fails on the required '('.
    'apiPostFormData': 'POST',
    'apiPatch': 'PATCH',
    'apiPut': 'PUT',
    'apiDelete': 'DELETE',
    'apiFetchBlob': 'GET',
}
OPAQUE = {'apiFetch', 'authFetch', 'request'}

# ---------------------------------------------------------------------------- the ratchet
#
# Decision 34's fault (3), the half the by-path pass is structurally blind to. Gated SEPARATELY from
# its sibling's 20 rather than summed, because the two are found by different matchers: one total
# would let this matcher break (reporting 0) while the other rose by the same amount, and the gate
# would stay green across a real regression.
#
# Measured 2026-10-22: 530 api routes against 388 verb-aware web paths, 9 addressed by path but not
# by method, 0 reached only through an opaque helper. Matched the screen-pass measurement document.
MISSING_METHOD_BUDGET = 9

# Blank is not zero, on both sides — see the sibling's floors for the argument, which applies
# identically here and for the same two failure shapes.
MINIMUM_API_ROUTES = 400
MINIMUM_VERB_AWARE_PATHS = 300


def web_calls_by_verb():
    """{normalised path -> set of methods}, plus the set of paths reached opaquely."""
    by_path = {}
    opaque_paths = set()
    for root_dir in base.WEB:
        for root, _, files in os.walk(root_dir):
            if 'node_modules' in root or '.next' in root:
                continue
            for f in files:
                if not f.endswith(('.ts', '.tsx')):
                    continue
                src = io.open(
                    os.path.join(root, f), encoding='utf-8', errors='replace'
                ).read()
                for m in base.CALL.finditer(src):
                    helper = m.group(1) or m.group(2)
                    # EVERY path literal in the first argument, not just one anchored at its
                    # start. `base.PATHARG` requires the argument to BEGIN with a quote, which
                    # a ternary does not -- and this pass is where that matters, because it
                    # separates GET from POST: a path POSTed with a bare literal and GET
                    # through a ternary read as "GET unreachable". Two false positives came
                    # from that, one of them recorded as a hand-checked finding. See FAILURE
                    # MODE 5 in unreachable-routes.py.
                    #
                    # AND ONE LEVEL OF HELPER INDIRECTION — `base.resolve_first_arg_paths` rather
                    # than `base.first_arg_paths`, so both passes share ONE resolver. They did not
                    # before: failure mode 5 was fixed here and left in the by-path pass, and
                    # failure mode 7 (a path returned by a same-file helper, `invitePathFor`) was
                    # then fixed there and would have been left here. Two passes with two different
                    # resolvers can disagree about whether a path is addressed at all, which is the
                    # one thing that must not vary between them: their whole division of labour is
                    # that this one separates GET from POST over the SAME set of addressed paths.
                    found, _resolved = base.resolve_first_arg_paths(src, src[m.end():])
                    for raw in found:
                        path = base.norm(raw)
                        if not path:
                            continue
                        if helper in OPAQUE:
                            opaque_paths.add(path)
                            continue
                        method = HELPER_METHOD.get(helper)
                        if method:
                            by_path.setdefault(path, set()).add(method)
    return by_path, opaque_paths


def main():
    routes = base.api_routes()
    by_path, opaque = web_calls_by_verb()

    # The first pass's own answer, so the delta is visible rather than asserted.
    path_only = set(by_path) | opaque

    missing_method = []
    unknown_method = []
    for method, path, controller in routes:
        matched_paths = [w for w in path_only if base.segments_match(w, path)]
        if not matched_paths:
            continue  # the first pass already reports this one
        methods = set()
        opaque_hit = False
        for w in matched_paths:
            methods |= by_path.get(w, set())
            if w in opaque:
                opaque_hit = True
        if method in methods:
            continue
        row = (method, path, controller)
        (unknown_method if opaque_hit else missing_method).append(row)

    print('api routes                :', len(routes))
    print('web paths (verb-aware)    :', len(by_path))
    print('web paths (opaque helper) :', len(opaque))
    print()
    print(
        'ADDRESSED BY PATH BUT NOT BY METHOD: %d routes — these are ADDITIONAL to the'
        % len(missing_method)
    )
    print('first pass, which counts them as reachable.')
    print()
    for method, path, controller in sorted(missing_method, key=lambda r: (r[2], r[1], r[0])):
        print('    %-6s /%s' % (method, path))
        print('           %s' % controller)
    print()
    print(
        'METHOD UNKNOWN (reached only through apiFetch/authFetch/request): %d — a question,'
        % len(unknown_method)
    )
    print('not a finding.')
    for method, path, controller in sorted(unknown_method, key=lambda r: (r[2], r[1], r[0])):
        print('    %-6s /%s   (%s)' % (method, path, controller))

    if '--check' not in sys.argv:
        return 0

    if len(routes) < MINIMUM_API_ROUTES:
        print()
        print('unreachable-routes-by-verb: REFUSED — only %d api route(s) parsed against a floor '
              'of %d. The controller matcher has drifted.' % (len(routes), MINIMUM_API_ROUTES))
        return 1
    if len(by_path) < MINIMUM_VERB_AWARE_PATHS:
        print()
        print('unreachable-routes-by-verb: REFUSED — only %d verb-aware web path(s) against a '
              'floor of %d. With the web side empty every route reads as method-unreachable, which '
              'is a broken parser wearing the costume of a catastrophe.'
              % (len(by_path), MINIMUM_VERB_AWARE_PATHS))
        return 1

    actual = len(missing_method)
    if actual > MISSING_METHOD_BUDGET:
        print()
        print('unreachable-routes-by-verb: FAILED — %d route(s) addressed by path but NOT by '
              'method, against a budget of %d.' % (actual, MISSING_METHOD_BUDGET))
        print('These are INVISIBLE to the by-path pass, which counts them as reachable because a '
              'sibling verb on the same path is called. That is how `PATCH /customers/:id` shipped '
              'with no caller the day after the by-path measurement was taken — and it made a '
              'statutory correction request impossible to close.')
        print('Do NOT raise the budget.')
        return 1
    if actual < MISSING_METHOD_BUDGET:
        print()
        print('unreachable-routes-by-verb: FAILED — only %d remain, so lower '
              'MISSING_METHOD_BUDGET to %d.' % (actual, actual))
        print('This half is what stops the ratchet becoming a ceiling.')
        return 1

    print()
    print('unreachable-routes-by-verb: at its declared budget of %d.' % MISSING_METHOD_BUDGET)
    return 0


if __name__ == '__main__':
    sys.exit(main())
