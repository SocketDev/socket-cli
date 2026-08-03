# A fail-fast linter's remaining count is unknowable

`cargo clippy` denies per crate and stops at the first failing crate — fixing
one failure uncovers the next batch, not the total. There is no point in that
loop where "how many findings are left" is a real number.

## The rule

- **Never report or estimate a remaining count from a fail-fast linter.** A
  runner that stops at the first crate/file/module carrying a denied lint
  cannot see what's behind it. Any "N left" claim made before the runner goes
  fully clean is a guess dressed as a measurement — it will be wrong the
  moment the next batch surfaces.
- **Run the runner's own `--fix` first.** Machine-applicable lints (clippy's
  `--fix`, an autofixer's own `--fix` flag) clear the mechanical residue in
  one pass, same discipline as `code-first-then-ai`: exhaust the deterministic
  fixer before iterating by hand.
- **Iterate the hand-fix residue one round at a time.** Fix what the runner
  currently shows, re-run, repeat. Each round can uncover a new batch the
  previous one hid — that's expected, not a sign the estimate was wrong,
  because there never was a real estimate.
- **Report progress as "N fixed, unknown remaining," never invent a
  denominator.** "17 of ~40 fixed" implies a total nobody has. "23 fixed this
  round; more may surface" says the same thing without the fabricated total.

## Why

Clearing ultrathink's clippy backlog took twelve rounds under exactly this
constraint — at no point could "how many are left" be estimated, and a count
volunteered at round three, six, or nine would have been wrong every time.
The grind paid for itself past the style residue: three of the findings that
only surfaced in later rounds were latent bugs, not lint noise — doc comments
that had drifted onto the wrong functions, an orphaned `#[expect]` paired
with `#[inline(always)]` that was silently applying the `inline(always)` to
an unrelated function instead of the one the comment described, and a dead
parameter that every one of 23 call sites still passed as a constant. None of
those would have been found by stopping early because a fabricated remaining
count looked like it had hit zero.
