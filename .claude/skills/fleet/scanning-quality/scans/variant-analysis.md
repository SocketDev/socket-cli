# Variant analysis scan

After other scans surface findings, this pass asks: **does the same shape exist elsewhere?**

## Mission

For every finding flagged at severity High or Critical by another scan in this run, search the rest of the repo (and optionally sibling fleet repos) for the same antipattern. Bugs cluster.

## Inputs

- The aggregated finding list from earlier scan phases.
- The repo working tree.
- (Optional) `--fleet` flag: also scan declared fleet siblings via `pnpm run fleet-skill --list-skills` to see what's discoverable; otherwise local-only.

## Method

For each High/Critical finding:

1. Read the surrounding 50 lines on each side of the source location. Identify the antipattern shape (call sequence, condition, data flow).
2. Construct an `rg` pattern that matches the shape, not the specific names. For example, `Promise.race\(.*\)` inside a `for|while` body, not `racePromises(`.
3. Run the search across `src/`, `scripts/`, `packages/*/src/` (whatever applies).
4. For each hit, decide:
   - **Same bug** — list as a variant of the original finding; share the original fix.
   - **Same shape, different context** — list as a variant with `Severity: LOWER` and a per-site fix note.
   - **False positive** — note in `Assumptions / Gaps`.
5. Read [`_shared/variant-analysis.md`](../../_shared/variant-analysis.md) for the full taxonomy of "what counts as the same shape."

## Output shape

```
### Variant Analysis

For original finding <id> (<file:line>):
- file:line — variant
  Pattern: <one-line>
  Severity: <propagated>
  Fix: <reference to original>
- file:line — variant (different context)
  Pattern: <one-line>
  Severity: <one notch lower>
  Fix: <per-site note>

For original finding <id>: no variants found ✓
```

## When this scan adds value

- **Path duplication** — once `path.join('build', mode)` is found in one file, the rest of the codebase usually has 5 more.
- **Forbidden API drift** — `fetch(`, `fs.rm(`, `npx`, raw `fs.access` for existence — fleet rules mandate one canonical answer; variants are the drift.
- **Insecure default propagation** — a fail-open default copy-pasted across config files.
- **Missing null check** — a refactor that introduced a possibly-undefined receiver usually broke siblings the same way.

## When to skip

- Finding is severity Low or Medium — variant-hunt cost > value.
- Finding is style-only (formatting, comment wording) — handled by linters, not by skills.
- Finding is in a generated file or vendored upstream — the fix belongs upstream.

## Source

Pattern adapted from Trail of Bits' `variant-analysis` plugin (https://github.com/trailofbits/skills/tree/main/plugins/variant-analysis), retargeted from Semgrep-rule-driven security review to general fleet correctness.
