---
description: Capture a brain gap — something an agent needed to know that the brain did not say — and write it into meta/.
---

# /brain-gap

Use this the moment an agent asks a question the brain should have answered, or makes an assumption the brain should have prevented. **Do not batch these for later** — the specificity is gone within the hour, and vague gaps produce vague files.

## What to do

1. **Ask what the gap was**, if it isn't already clear from the conversation. Get the exact question the agent asked or the exact wrong assumption it made.

2. **Classify it:**
   - Needed to know *how something works* → `meta/context/`
   - Needed to know *what is allowed* → `meta/lex/`
   - Needed to know *why it is like this* → `meta/designs/`

3. **Check for an existing file** on that area first. Extending a file beats creating a sibling — two half-files on one topic is how a brain becomes unnavigable.

4. **Write it** using the matching `_TEMPLATE.md`. For `context/`, use exact identifiers: model names, field names, enum values, file paths. The test is that an agent could act on it without a follow-up question.

5. **If it is a lex**, do not write it without an enforcement mechanism. If there isn't one, it goes in `meta/guides/` instead and say so plainly.

6. **Check the workspace-updates rule.** If the change is developer-facing, stage `CLAUDE.md` and `README.md` too — the hook will block the commit otherwise.

7. **Commit** with a message naming the gap: `brain: <what an agent could not answer>`.

## What not to do

- Don't write speculative neighbours. One gap, one file. The temptation to "also document the adjacent thing while I'm here" is how documentation sprints start.
- Don't write a file that restates a lex. Cite it.
- Don't create a new folder for a single file.
