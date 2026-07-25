# Shadscan Audit

Shadscan audits a React shadcn app for missing UI fundamentals: theme and
command-menu wiring, route and loading states, accessible controls, form
feedback, metadata, and mobile behavior. The result is a 0-100 score across
six weighted categories plus evidence-backed findings — the missing UI
fundamentals report that anchors a review before any rendering.

The fleet pins `@shadscan/cli` in the wheelhouse catalog. Run the workspace
binary directly — never an unpinned `npx` / `pnpm dlx` fetch:

```bash
node_modules/.bin/shadscan <app-root> --no-interactive --no-roast
```

The scan is deterministic, static, and read-only. It does not start the app,
edit files, call an AI model, or upload source; repeat runs on an unchanged
tree report identical findings, so a before/after pair is trustworthy review
evidence.

## When It Applies

- The target is a React app with shadcn wiring: a `components.json` at the app
  root plus React source. Supported adapters: Next.js App Router, Pages
  Router, hybrid Next.js, TanStack Start, Vite React, and generic React.
- Point the positional path at the app root — the directory holding
  `components.json` and the app's `package.json` — not at the repo root of a
  monorepo.
- The tool reports its detected adapter and source coverage; treat a partial
  coverage warning as a scoping problem to fix before trusting the score.

## Output Modes

- Human report, for the review summary:
  `node_modules/.bin/shadscan <app-root> --no-interactive --no-roast`
- Machine-readable JSON, stable across runs except `durationMs`:
  `node_modules/.bin/shadscan <app-root> --json --no-interactive`
- One category while investigating a focused area:
  `node_modules/.bin/shadscan <app-root> --category accessibility --no-interactive --no-roast`
- CI floor — exits non-zero when the score is below the floor, unassessed, or
  based on partial source coverage:
  `node_modules/.bin/shadscan <app-root> --fail-under 80 --no-interactive --no-roast`

Skip the `--apply` and `--prompt` agent-handoff modes: the reviewer following
this skill is already the acting agent. Read the findings and do the work.

## Acting On Findings

Findings arrive in four dispositions. Handle each differently:

- **Fixes** — high-confidence defects with repository-relative evidence, e.g.
  `src/App.tsx:6` for an image missing alt text. Route the implementation to
  the improving-web-interfaces companion, then re-scan.
- **Decisions** — product choices such as mounting a command menu or a theme
  shortcut. Surface each to the owner; implement it or record an explicit
  waiver. Never silently drop a decision item.
- **Advisories** — score-neutral checks that static analysis cannot prove.
  Verify the rendered behavior with rendering-chromium-to-png or
  testing-web-interfaces; a verified no-change outcome is a valid result. Do
  not churn code just to silence an advisory.
- **Not applicable** — rules excluded because the UI surface is absent.
  Ignore them.

After the work, re-run the exact same pinned command and compare findings:
implemented fixes should disappear, waived decisions and verified advisories
may remain when reported with rationale. A score jump without matching
evidence is suspect.

## Exit Status

- `0` — scan completed; findings alone never fail the process.
- `1` — discovery, audit, or setup failure, or an unmet `--fail-under` floor.
