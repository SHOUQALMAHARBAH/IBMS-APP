# -*- coding: utf-8 -*-
"""
Her three Group 1 screens are a sample; measure the class.

Two shapes, kept apart because the fix differs:

  (A) NO PENDING STATE - a control is gated on a busy flag and the file renders
      no pending text at all. /watchlist-sync is the extreme: its fetch is
      120s x 3 attempts per source, so the silence can last ~6 minutes.

  (B) NO STATED OUTCOME - an action wrapper reports on catch and says nothing
      on success. Split into three tiers, because two of them are not defects:
        B1 nothing at all happens on screen        <- the real defect
        B2 a reload or a parent callback fires     <- a cell changes; her
                                                      kyc-queue case, visible
                                                      in principle only
        B3 navigates away                          <- a real outcome, not a
                                                      finding
"""
import io
import os
import re

ROOTS = ["apps/web/app", "apps/web/components"]

BUSY_GATE = re.compile(
    r"disabled=\{(?:!?\s*)?(busy|isBusy|saving|submitting|isSaving|isSubmitting|working|pending)\b"
)
PENDING_TEXT = re.compile(
    r"t\(\s*[\"'](commonWorking|commonSaving|\w*(?:Working|Saving)Button|\w*Working|\w*Saving)[\"']"
)
SETS_ERROR = re.compile(r"set(?:Action)?Error(?:s)?\(")
SETS_SUCCESS = re.compile(
    r"setMessage\(|setNotice\(|setOutcome\(|setResult\(|setSummary\(|setOk\(|setConfirmation\("
)
# The login redirect sits in an auth effect on nearly every page and is NOT a
# success navigation. Counting it made 35 files read as "navigates away, not a
# finding" when most of them are the defect.
NAVIGATES = re.compile(
    r"router\.(?:push|replace)\(\s*(?![\"']/login[\"'])|window\.location"
)
# A callback into the parent, or a re-read: the change reaches the screen, but
# nothing states it.
PROPAGATES = re.compile(r"\bon[A-Z]\w*\(\)|\bon[A-Z]\w*\(\s*\w|await load\w*\(|void load\w*\(")

files = []
for root in ROOTS:
    for dirpath, _dirs, names in os.walk(root):
        for n in names:
            if n.endswith(".tsx"):
                files.append(os.path.join(dirpath, n))

gated, no_pending = [], []
b1, b2, b3 = [], [], []
for path in sorted(files):
    src = io.open(path, encoding="utf-8").read()
    if not BUSY_GATE.search(src):
        continue
    rel = path.replace(os.sep, "/")
    gated.append(rel)
    if not PENDING_TEXT.search(src):
        no_pending.append(rel)
    if SETS_ERROR.search(src) and not SETS_SUCCESS.search(src):
        if NAVIGATES.search(src):
            b3.append(rel)
        elif PROPAGATES.search(src):
            b2.append(rel)
        else:
            b1.append(rel)

print("files gating a control on a busy flag: %d" % len(gated))
print()
print("(A) NO PENDING STATE AT ALL: %d of %d" % (len(no_pending), len(gated)))
for p in no_pending:
    print("    " + p)
print()
print("(B1) acts that leave the screen UNCHANGED: %d" % len(b1))
for p in b1:
    print("    " + p)
print()
print("(B2) acts whose only outcome is a reload or a parent callback: %d" % len(b2))
for p in b2:
    print("    " + p)
print()
print("(B3) acts that navigate away - NOT a finding: %d" % len(b3))
for p in b3:
    print("    " + p)
