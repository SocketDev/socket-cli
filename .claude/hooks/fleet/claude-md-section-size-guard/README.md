# claude-md-section-size-guard

PreToolUse hook that caps the body length of individual `### ` sections inside the CLAUDE.md fleet-canonical block.

## What it does

Complements `claude-md-size-guard` (40KB byte cap on the whole block) by enforcing two per-section caps inside the block — both metrics of one concern, "this section is too big". Each `### Section heading` inside the `<!-- <fleet-canonical> -->` … `<!-- </fleet-canonical> -->` markers gets at most:

- **1500 body bytes** (configurable via `CLAUDE_MD_FLEET_SECTION_MAX_BYTES`), and
- **12 body lines** (configurable via `CLAUDE_MD_FLEET_SECTION_MAX_LINES`).

A section is blocked when it exceeds **either** cap. The byte cap exists because the line cap alone misses the real bloat mode: a single 600-char one-liner is one line but a large slice of the 40KB whole-file budget that ships byte-identical to every fleet repo. The byte cap forces dense prose out to a docs page even when it fits on few lines.

Sections that exceed a cap should have a long-form companion at `docs/agents.md/fleet/<topic>.md`, with the inline body shrunk to a terse invariant plus a `Detail:` link (or bullet list of links). The line cap is above the old prose-era 8 so a bullet-list `Detail:` block (one line per linked doc) fits without churn.

Blank lines don't count. Code-fence content does count. A body byte is each counted line's UTF-8 length plus 1 for its newline.

When a section exceeds a cap, the hook prints:

- Which section was too big.
- Which cap(s) it exceeded, and by how much (lines and/or bytes).
- The canonical fix: move the long form to `docs/agents.md/fleet/<topic>.md` and leave a terse invariant + link.

## What's not enforced

- Per-repo CLAUDE.md content (outside the markers) — uncapped.
- Sections at `##` or `#` level — only `### ` sections are checked, because that's where fleet rules live.
- Long lines — readability is a separate concern.

## Why a per-section cap beyond the whole-file byte cap

The failure mode this hook addresses: an operator can grow a single rule from 2 lines to 60 lines of detailed prose (or one dense 600-char line) without ever tripping the 40KB whole-file cap — until enough other sections accrete that an unrelated 1-line addition breaks the build. The per-section caps catch this at the moment the long content is written, when the operator has the long-form text in hand and can move it into a `docs/agents.md/fleet/<topic>.md` companion.

## Override

```
CLAUDE_MD_FLEET_SECTION_MAX_BYTES=1500 # default 1500
CLAUDE_MD_FLEET_SECTION_MAX_LINES=12   # default 12
```

No bypass phrase — the override env-vars are the documented escape valve. If you find yourself reaching for one, that's a strong signal the rule should be outsourced.

## Reading

- CLAUDE.md → opening fleet-canonical note (cap is cited there).
- `.claude/hooks/fleet/claude-md-size-guard/` — the companion byte-cap hook.
