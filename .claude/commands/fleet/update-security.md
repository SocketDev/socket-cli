---
description: Resolve open GitHub Dependabot security alerts on the current repo via the updating-security skill.
---

Walk open Dependabot security alerts and fix each one — direct
deps via `pnpm update`, transitives via `pnpm.overrides`,
unfixable advisories via principled dismissal. Per-alert atomic
commits with `chore(security): …` titles. Validates with
`pnpm run check`, pushes via the standard push-then-PR fallback
policy. Honors the 7-day soak gate; awaiting-soak alerts surface
in the summary without modification.

Use after `gh` warns "Dependabot found N vulnerabilities" on push,
or whenever the GitHub security tab is non-empty.

Invokes the `updating-security` skill.
