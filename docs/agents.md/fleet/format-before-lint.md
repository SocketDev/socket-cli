# Format before lint

The formatter runs FIRST, then the linter. Every fleet runner orders the two
phases that way, and a runner that inverts them is a defect.

## The rule

- **oxfmt owns the final wrapping, so it goes first.** `createLintRunners`
  (`scripts/fleet/_shared/lint-runners.mts`) runs the format phase ahead of the
  oxlint phase on both paths, whole-tree and scoped. Every other entry point
  (`fix.mts`, `format.mts`, the `.git-hooks` chains) delegates to that one file,
  so the order lives in exactly one place.
- **A line-counting rule cannot be evaluated against unformatted text.**
  `socket/max-comment-block-lines`, `socket/max-file-lines`, and any future rule
  that counts lines are measured against the shape oxfmt produces. Counting
  first and formatting second measures a shape that is about to be rewritten.
- **Leave headroom under a cap, never land on it.** A block reflowed to exactly
  20 lines under a 20-line cap passes today and fails after the next format
  pass rewraps one sentence. Aim several lines below the limit.
- **A blank line is not always a durable split.** oxfmt may collapse whitespace
  it considers insignificant, so splitting one long comment into two by
  inserting a blank line can be undone. Where the split has to survive, put
  real code between the two comment groups: a statement cannot be collapsed.

## Why

Formatting after linting does not converge. Each format pass can manufacture a
fresh violation of a line-counting rule, so the loop never settles and the
verdict depends on which phase ran last.

Measured, 2026-08-04, in `ultrathink`: a sweep cleared all 19
`socket(max-comment-block-lines)` violations and verified zero remaining. A
following `pnpm run fix` reflowed prose and produced a new violation at
`packages/acorn/lang/typescript/src/core/detect-source-type.ts:1043`, where
oxfmt rewrapped a compliant 20-line block into 21. The same file then showed
the whitespace trap: a blank line splitting two docblocks inside a
parenthesized `||` expression was stripped on reformat, resurfacing the
violation. The durable fix extracted the leading conditions into a named
`const` so real code separated the comment groups.

This is the ordering `code-first-then-ai` already describes for a different
pair: run the deterministic normalizer to exhaustion, then evaluate what is
left. The formatter is the normalizer; the linter judges the residue.

## Enforcement

- `scripts/fleet/_shared/lint-runners.mts` is the single owner of the phase
  order; `test/repo/unit/lint-runners.test.mts` asserts the call sequence, so an
  inversion fails the suite instead of silently returning.
