# A piped exit code is the filter's, not the command's

`cmd | rg pattern | head` reports `head`'s exit status, not `cmd`'s. The same
trap fires in a background task whose command ends in a pipe: a "completed
(exit code 0)" notification can describe a filter that ran fine on a command
that failed or never finished.

## The rule

- **Never read a pipeline's exit code as the first command's verdict.**
  `node scripts/fleet/lint-rust.mts | rg pattern | head` — the `$?` (or the
  task-runner's reported exit code) belongs to `head`. A non-zero real
  failure upstream is invisible unless the pipeline itself says otherwise.
- **Capture the real status durably, then read that.** Redirect to a log and
  echo the actual exit code into it: `cmd > log 2>&1; echo "EXIT=$?" >> log`
  — then grep/read the log, never the shell's own `$?` after a pipe. `set -o
  pipefail` (propagates the first non-zero exit through the pipeline) or
  reading `PIPESTATUS`/`pipestatus` are the in-shell alternatives when a log
  file isn't in play.
- **A truncated tail is the same family of mistake.** Piping a long run
  through `tail`/`head` doesn't just hide the exit code — it silently drops
  every line before the window, which is why `no-tail-install-out-guard`
  blocks a bare `pnpm install | tail -N`. Both traps share one shape: the
  shell faithfully reports what you asked for, not what happened.
- **This applies to task notifications, not just interactive shells.** A
  background task whose command string ends in a pipe reports the pipeline's
  exit code exactly the same way — "completed (exit code 0)" can describe a
  `head`/`tail`/`grep` that succeeded while the real command it was filtering
  failed or hung.

## Why

This isn't a hypothetical: the trap fired twice in one session. Once it
masked whether a benchmark had actually executed — the reported "exit code 0"
belonged to a downstream filter. Once it fired against a full Rust test
suite, where the same piped-command shape reported success while the
underlying suite's real result sat unread inside the log. Neither case
required a bug in the command being run — the exit code was never the
command's to begin with.
