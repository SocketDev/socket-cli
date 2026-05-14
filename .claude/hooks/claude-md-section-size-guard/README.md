# claude-md-section-size-guard

PreToolUse hook that caps the body length of individual `### ` sections inside the CLAUDE.md fleet-canonical block.

## What it does

Complements `claude-md-size-guard` (40KB byte cap on the whole block) by enforcing a per-section line cap inside the block. Each `### Section heading` inside the `<!-- BEGIN/END FLEET-CANONICAL -->` markers gets at most **8 body lines** (configurable via `CLAUDE_MD_FLEET_SECTION_MAX_LINES`).

Sections that exceed 8 lines should have a long-form companion at `docs/claude.md/fleet/<topic>.md` and the inline body should shrink to 1-2 sentences plus a link. The cap was 20 initially (during the bootstrap when several fleet sections were 12-19 lines); it tightened to 8 once those sections were outsourced.

Blank lines don't count. Code-fence content does count.

When a section exceeds the cap, the hook prints:

- Which section was too long.
- How many lines over.
- The canonical fix: move the long form to `docs/claude.md/fleet/<topic>.md` and leave a 1-sentence summary + link.

## What's not enforced

- Per-repo CLAUDE.md content (outside the markers) — uncapped.
- Sections at `##` or `#` level — only `### ` sections are checked, because that's where fleet rules live.
- Long lines — readability is a separate concern.

## Why a per-section cap, not just the byte cap

The failure mode this hook addresses: an operator can grow a single rule from 2 lines to 60 lines of detailed prose without ever tripping the 40KB byte cap — until enough other sections accrete that an unrelated 1-line addition breaks the build. The per-section cap catches this directly, at the moment the long content is written, when the operator has the long-form text in hand and can immediately drop it into a `docs/claude.md/fleet/<topic>.md` companion.

## Override

`CLAUDE_MD_FLEET_SECTION_MAX_LINES=12 # default 8`

No bypass phrase — the override env-var is the documented escape valve. If you find yourself reaching for it, that's a strong signal the rule should be outsourced.

## Reading

- CLAUDE.md → opening fleet-canonical note (cap is cited there).
- `.claude/hooks/claude-md-size-guard/` — the companion byte-cap hook.
