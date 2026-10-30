"""Put every file back to the line endings its own blob uses.

WHY THIS EXISTS. `pathlib.Path.write_text` on Windows translates `\\n` to `os.linesep`, so a
Python edit of an LF file silently rewrites it as CRLF — and git then reports the WHOLE FILE as
changed. The first version of one commit here was **23,052 insertions over 22,811 deletions across
56 files** when the real change was a fraction of that.

A whole-file diff is an unreviewable diff, and worse, it is read as the size of the work. Nothing
in the build catches it: every gate passes, every test passes, the bytes are semantically
identical. Only `git diff --stat` says anything, and only to somebody who looks at the number and
asks whether it is plausible.

IT DECIDES PER FILE, FROM THE FILE'S OWN BLOB, rather than imposing LF on the tree: a file whose
committed form is CRLF is left CRLF. That matters because `.gitattributes` does not exist here and
`core.autocrlf` is `false`, so the stored form IS the convention and it is per file.

A file with no blob (newly added) is left alone — there is nothing to compare it against, and
guessing would be the same mistake in the other direction.

Run it on the staged set before committing, or on an explicit list:

    python scripts/measurements/normalise-line-endings.py            # the staged set
    python scripts/measurements/normalise-line-endings.py a.ts b.md  # just these
"""

from __future__ import annotations

import pathlib
import subprocess
import sys


def staged() -> list[str]:
    r = subprocess.run(
        ["git", "diff", "--cached", "--name-only"], capture_output=True, text=True, check=True
    )
    return [line for line in r.stdout.splitlines() if line.strip()]


def blob_at(rev: str, rel: str) -> bytes | None:
    r = subprocess.run(["git", "cat-file", "-p", f"{rev}:{rel}"], capture_output=True)
    return r.stdout if r.returncode == 0 else None


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    files = args or staged()
    if not files:
        print("nothing staged and no files given — nothing to do")
        return 0

    to_lf, to_crlf, untouched, no_blob, missing = [], [], [], [], []
    for rel in files:
        path = pathlib.Path(rel)
        if not path.is_file():
            missing.append(rel)
            continue
        # HEAD, not HEAD~1: the question is what the file's COMMITTED form is, and on an amend
        # HEAD is this commit's own parent content only for files it did not already touch.
        blob = blob_at("HEAD", rel)
        if blob is None:
            blob = blob_at("HEAD~1", rel)
        if blob is None:
            no_blob.append(rel)
            continue

        disk = path.read_bytes()
        b_crlf = blob.count(b"\r\n")
        b_lf = blob.count(b"\n") - b_crlf
        d_crlf = disk.count(b"\r\n")
        d_lf = disk.count(b"\n") - d_crlf

        if b_crlf == 0 and b_lf > 0 and d_crlf > 0:
            path.write_bytes(disk.replace(b"\r\n", b"\n"))
            to_lf.append(rel)
        elif b_lf == 0 and b_crlf > 0 and d_lf > 0:
            path.write_bytes(disk.replace(b"\r\n", b"\n").replace(b"\n", b"\r\n"))
            to_crlf.append(rel)
        else:
            untouched.append(rel)

    print(f"-> LF   : {len(to_lf)}")
    for rel in to_lf:
        print(f"          {rel}")
    print(f"-> CRLF : {len(to_crlf)}")
    for rel in to_crlf:
        print(f"          {rel}")
    print(f"already right : {len(untouched)}")
    if no_blob:
        print(f"NEW, left alone (no blob to compare): {len(no_blob)}")
        for rel in no_blob:
            print(f"          {rel}")
    if missing:
        print(f"not on disk (deleted/renamed): {len(missing)}")
    if to_lf or to_crlf:
        print("\nRe-stage: the files on disk changed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
