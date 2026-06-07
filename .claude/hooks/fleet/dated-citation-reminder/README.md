# dated-citation-reminder

PreToolUse hook. Nudges (never blocks) when an `Edit`/`Write`/`MultiEdit` adds a
**dated-incident citation** to a fleet-facing rule-prose surface — `CLAUDE.md`,
`docs/claude.md/fleet/**`, `.claude/skills/**/SKILL.md`, or a
`.claude/hooks/fleet/**/README.md`.

## Why

CLAUDE.md "Compound lessons into rules" says: when a rule / hook / doc cites the
case that motivated it, write it **generically, as a timeless example** — not a
dated incident log. A citation like `**Why:** 2026-06-07 pnpm 11.0.0 vs 11.5.1
broke the cascade at SHA abc1234` ages into a changelog: the date, the version
delta, and the SHA stop meaning anything once the versions move on, and they
leak operational detail into a duplicated-across-the-fleet file. The
example-shape — `**Why:** a stale pnpm on PATH fails the version check and
aborts the cascade install` — teaches the same lesson and never goes stale.

## What fires it

A line carrying a **rationale marker** (`**Why:**`, "incident", "regression",
"red-lined") that ALSO carries a **specificity token**: an ISO date, a version
delta (`11.4.0 vs 11.3.0`), a percentage delta (`98.9%→99.15%`), or a commit
SHA. A bare date elsewhere — a SHA-pin `# <tag> (YYYY-MM-DD)` comment, a
`# published: YYYY-MM-DD` soak annotation, a `.gitmodules` stamp, a CHANGELOG
entry — is not a rationale line and does not fire.

Detection + surface scoping are shared with the commit-time check via
`_shared/dated-citation.mts`, so the two surfaces can't drift.

## Reminder, not a guard

A date is occasionally load-bearing in prose, so this surfaces the antipattern
on the way in and lets the write through (exit 0). The hard gate is the
commit-time check `scripts/fleet/check/rule-citations-are-generic.mts` (in
`check --all`), which fails on a dated citation in committed rule prose.

## Bypass

None needed — the hook only nudges. To stop the commit-time check on a genuine
need, the check is reporting-only at the call site you fix; there is no phrase
bypass because the fix (rewrite generically) is always the right move.
