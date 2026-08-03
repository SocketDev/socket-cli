# no-removal-comment-nudge

PreToolUse `Edit`/`MultiEdit` hook that nudges (never blocks) when an edit
removes code and simultaneously adds a comment whose text carries a relocation
phrase ("moved to", "now lives in", "managed below", etc.).

A comment explaining where something went belongs at the ADD site (next to the
import, call, or config that replaces the deleted code). At the removal site
it is orphaned noise — the reader has nothing to attach it to. See
[`docs/agents.md/fleet/parser-comments.md`](../../../../docs/agents.md/fleet/parser-comments.md).

## What it flags

An `Edit`/`MultiEdit` is flagged when **both** hold:

1. `old_string` removes at least one non-comment (code) line.
2. `new_string` adds at least one comment line (not already in `old_string`)
   matching a relocation phrase:

| Phrase family               | Examples                                              |
| --------------------------- | ----------------------------------------------------- |
| moved/move to/into          | `# moved to utils.ts`, `// move into config/`        |
| relocated to/from           | `# relocated to src/lib/`                             |
| now lives / now managed     | `// now lives in registry.ts`                         |
| managed below/above/here/by | `# managed below`, `# managed by the cascade`        |
| lives in                    | `// lives in settings.json`                           |
| handled elsewhere/below/by  | `# handled elsewhere`, `# handled by the hook`       |
| no longer here/needed here  | `// no longer here`, `# no longer needed here`       |
| used to live/be here        | `// used to live in config.ts`                        |

## What it does NOT flag

- Write tool (no `old_string`/`new_string` distinction).
- Edits where only comments changed (no code line removed).
- Relocation comments already present in `old_string` (not newly added).
- Pointer comments without a relocation phrase (`// see X` — that's
  `pointer-comment-nudge`'s domain).

## Heuristic limitation

The hook works on the Edit fragment, not the full file. A relocation phrase in
a newly added comment is a strong signal, but the hook can't rule out that the
comment also appears next to newly added replacement code in the same fragment.
False positives are possible; the bar is "obvious removal-site annotation."

## Trigger

Fires on `Edit` / `MultiEdit` PreToolUse events. Always exits 0; the reminder
is informational on stderr.

## Bypass

No bypass phrase — this hook never blocks.

## Companion files

- `index.mts` — the hook; `detectRemovalComment(old, new)` is the pure
  exported detector.
- `test/repo/integration/hooks/no-removal-comment-nudge.test.mts` — vitest
  integration tests (spawn-based, never self-import).
