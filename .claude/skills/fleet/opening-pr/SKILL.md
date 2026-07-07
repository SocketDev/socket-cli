---
name: opening-pr
description: Implement a fix for an issue / finding / request, ensure it has a unit test or a verification path, and open the PR. Use when the user wants a change shipped as a PR — not just described, but fixed AND verified.
user-invocable: true
---

# opening-pr

Ship a change as a PR that actually **fixes the thing** AND **proves it** — a PR
without a test or a named verification path is not done. The sibling of
`decomposing-tickets`: that one writes the work down, this one lands it.

## 1. Understand the target

Read the issue / finding / request and the affected code. If it's a findings
report, this is the `fix` agent's job — deterministic fixers first, AI-patch the
residue. If it's a feature or bug, drive it test-first with `building-tdd`.

## 2. Fix it

Apply the change. Deterministic fixers (`pnpm run fix` / `format` / the finding's
named script) run before any hand patch ([`code-first-then-ai`](../../../rules/fleet/code-first-then-ai.md)).
Smallest change that resolves the target; don't refactor unrelated code.

## 3. Verify — the non-negotiable step

The change MUST carry one of:

- A **unit/integration test** at the correct seam that goes red without the fix and
  green with it (the default — drive it via `building-tdd`; seam doctrine:
  [`test-layout`](../../../../docs/agents.md/fleet/test-layout.md)), OR
- A **named verification path** when a test genuinely can't reach it (a `pnpm`
  command, a check script, a reproducible manual step) — stated explicitly in the
  PR body, never "trust me".

Run `pnpm run check` + `pnpm test <file>` and confirm green. No green verification,
no PR.

## 4. Write the PR body through prose + doctrine

Run the `prose` skill over the PR description (conversational mode) and apply
[`prose-style-and-doctrine`](../../../rules/fleet/prose-style-and-doctrine.md):
lead with what changed and why, 1–3 sentences, no throat-clearers, no diff
narration, evidence (the test/command that proves it). Public-surface hygiene: no
real customer/company name, no private repo, no Linear ref, no bare `#N` (use
`org/repo#N` or the full URL); link the issue with a closing keyword.

## 5. Open it

Commit on a branch (a worktree if the primary checkout has other sessions), push,
`gh pr create`. Opening a PR is outward-facing — confirm the base branch + that
the diff is the intended scope first.

## Completion criterion

The fix is applied, `pnpm run check` + the test/verification are green, the PR body
has passed the prose + doctrine pass and leaks no private name, and the PR links
its issue. A PR with no test and no named verification path is not complete.
