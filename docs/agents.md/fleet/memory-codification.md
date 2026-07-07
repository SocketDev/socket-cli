# Memory codification

A lesson saved only to per-user memory is policy on paper. It is invisible to
the fleet, to CI, and to every teammate's machine. A `feedback` or `project`
memory that states an enforceable rule (an always / never / MUST, or a build or
release step) must pair with an enforcer: the code that actually catches the
mistake.

## The disposition

Stamp each codifiable memory's frontmatter with an `enforcement:` line naming
how the lesson is enforced, or why it isn't:

```
enforcement: .claude/hooks/fleet/<name>       # a guard / nudge hook
enforcement: socket/<rule>                    # a lint rule
enforcement: scripts/fleet/check/<name>.mts   # an assertion check
enforcement: deferred #<task>                 # tracked follow-up, not yet built
enforcement: n/a — <reason>                   # a pure-preference, uncodifiable lesson
```

`reference` (pointers, URLs, dashboards) and `user` (who the user is) memories
are exempt. They hold no rule to enforce.

## The two surfaces

- **Write-time:** `uncodified-lesson-nudge` (Stop hook) fires when a turn writes
  a feedback/project memory with an enforceable shape and no enforcer citation.
  It is the reminder to codify now, while the lesson is fresh.
- **Audit:** `scripts/fleet/check/memories-are-codified.mts` scans the local
  memory store (when one exists for the project) and lists every codifiable
  memory missing an `enforcement:` disposition. It skips cleanly in CI and fresh
  checkouts (no store, an explicit "skipped", never false-green), and stays
  report-only until the existing backlog is stamped, then flips to a hard gate.
  That is how the uncodified backlog stays visible instead of drifting.

## Why

The fleet's whole doctrine is code-is-law: a standard that isn't executable is a
standard that erodes. Memory is a fine scratchpad for what was learned, but the
lesson only holds once it lives in a hook, a lint rule, or a check that the next
run cannot skip, on any machine. The `enforcement:` disposition makes "is this
lesson actually enforced?" a mechanically answerable question.
