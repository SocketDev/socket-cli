# The coverage ratchet is law

New features ship fully covered, and the gains they buy get LOCKED: the Cover
thresholds must track measured coverage, one-way, forever. Coverage work is a
treadmill against active development, and that is the intended shape - the
ratchet is what keeps the treadmill from sliding backward.

## The rule

- **A landed feature is a covered feature.** Tests land in the same change as
  the source they cover. `scripts-have-unit-tests` enforces the per-script
  floor; the aggregate Cover gate enforces the percentages.
- **Measured gains lock within one cover run.** When a metric's measured value
  in the last cover run exceeds its committed `cover.thresholds` entry by more
  than the ratchet band (1.5 points),
  `check/coverage-thresholds-are-ratcheted.mts` fails and names the gap. The
  fix is its own `--fix`, which rewrites each stale threshold to
  `floor(measured) - 1` - the margin that absorbs local-vs-CI variance.
- **A threshold never moves down.** Same one-way discipline as
  `socket-pins-are-never-lowered`: a genuine coverage regression fails the
  Cover gate itself; lowering the bar is never the fix. The `--fix` writer
  refuses to produce a lower value.
- **Fail-open where there is nothing to ratchet.** No coverage summary on the
  tree (no cover run yet) or no `cover.thresholds` block (a report-only repo)
  skips clean.

## Why

The margin between measured coverage and the committed threshold is the budget
an uncovered change can silently spend. A twelve-wave campaign raised the
wheelhouse from 77% to 93% functions, and every point of it was ratchet-locked
by hand at each crossing - until a concurrent feature burst added enough
uncovered source in one afternoon to claw back nearly a point before any gate
noticed. Manual ratcheting is a habit; this check makes it a law, so covered
features raise the bar automatically and uncovered ones show up as visible
margin loss the moment the next cover run reports.

## Enforcement

- `scripts/fleet/check/coverage-thresholds-are-ratcheted.mts` - registered in
  the check registry, `--fix` self-heals, fail-open on missing artifacts.
- The Cover gate (`pnpm run cover`) - owns the downward direction: measured
  below threshold fails the run.
- `scripts/repo/check/scripts-have-unit-tests.mts` - the per-script existence
  floor with its grandfather baseline.
