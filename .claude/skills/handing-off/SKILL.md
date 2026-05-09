---
name: handing-off
description: Compact the current conversation into a handoff doc so a fresh agent can pick up the work. Use when context is getting thin, a session is about to end, or the next stage of the work needs a different agent / human.
user-invocable: true
argument-hint: "What will the next session focus on?"
allowed-tools: Bash(mkdir:*), Bash(date:*), Read, Write
---

# handing-off

Write a handoff document so a fresh agent can continue the work without re-loading the entire conversation.

## When to use

- Context is approaching its limit and the work isn't done.
- The next stage requires a different agent (different model, different tools, different scope) or a human.
- Wrapping up a session at the end of the day with work in flight.
- The user invokes `/handing-off [focus]` explicitly.

## How to write the doc

1. **Summarize, don't duplicate.** Reference commits (`<sha> — <message>`), files (`path:line`), PRs, issues, ADRs, plans. The next agent can `git log`, `Read`, `gh` their way to detail. The doc carries the *why* and *where things stand*, not the contents.
2. **Lead with state.** What's done, what's in flight, what's blocked, what's next. Use bullet lists, not paragraphs.
3. **Name suggested skills.** If the next session should reach for `reviewing-code`, `updating-lockstep`, etc., list them by name with a one-line "use when" so the next agent doesn't have to discover them.
4. **Tailor to the focus.** If the user passed an argument (`/handing-off SEA migration`), shape the doc around that scope; drop unrelated work into a "deferred" section.
5. **Stop at one screen.** A handoff doc that takes longer to read than the work it summarizes has failed at its job.

## Where to save

Use `.claude/reports/<YYYY-MM-DD>-<slug>-handoff.md`. The `.claude/reports/` directory is gitignored fleet-wide (per CLAUDE.md "Generated reports" rule), so the doc stays local — no risk of committing a stale handoff. Slug is short kebab-case from the focus (e.g. `rolldown-cascade`, `bugbot-cleanup`).

```bash
mkdir -p .claude/reports
DATE=$(date +%Y-%m-%d)
PATH=".claude/reports/${DATE}-<slug>-handoff.md"
```

## What NOT to include

- The full conversation (the next agent reads commits + diffs, not transcripts).
- Code listings that exist verbatim in source files (link instead).
- Decisions already captured in commit messages or ADRs (cite the SHA / file).
- A retrospective "what I learned" section unless it's load-bearing for the next agent's choices.

## Why this exists

Originally adopted from [`mattpocock/skills/handoff`](https://github.com/mattpocock/skills/blob/main/skills/in-progress/handoff/SKILL.md), adapted for fleet conventions (`.claude/reports/` instead of `mktemp`, gerund naming, fleet skill frontmatter).
