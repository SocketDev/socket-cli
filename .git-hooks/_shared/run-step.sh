# Shared pre-commit step runners, sourced by .git-hooks/fleet/pre-commit so the
# error-visibility + budget-bounding logic lives in ONE place.

# Error-visibility helper. When lint/test fails, harness output often
# shows only a final "Failed with non-blocking status code" line — the
# actual error is buried thousands of lines up the log and gets clipped
# by the agent's stdout limits. Tee each step's output to a tempfile,
# tail it on failure with a clear marker so the operator (or agent)
# can see what broke without scrolling.
run_step() {
  step_name=$1
  shift
  step_log=$(mktemp -t "pre-commit-${step_name}.XXXXXX") || step_log=/tmp/pre-commit-step.log
  if "$@" 2>&1 | tee "$step_log"; then
    status=0
  else
    status=$?
  fi
  if [ "$status" -ne 0 ]; then
    printf '\n========== pre-commit: %s FAILED (exit %s) ==========\n' "$step_name" "$status"
    printf 'Last 60 lines of output:\n\n'
    tail -60 "$step_log"
    printf '\n========== full log: %s ==========\n' "$step_log"
  else
    rm -f "$step_log"
  fi
  return "$status"
}

# Like run_step, but bounds the command to PRECOMMIT_STEP_BUDGET_S and, on
# timeout, KILLS THE WHOLE PROCESS GROUP (the `sfw` pnpm-shim wrapper + every
# oxlint/vitest worker it spawned) — then fails OPEN (returns 0). EVERY heavy
# optional step (lint AND test) runs through this, so the whole optional phase
# is hard-bounded: with the staged scope (lint + test both act only on the
# changed files — no whole-tree escalation), a small commit finishes in a few
# seconds, and the budget is the hang ceiling that keeps a deadlock (e.g. the
# Socket Firewall sfw proxy + a worker blocking on each other) from ever hanging
# the commit past PRECOMMIT_STEP_BUDGET_S. A real lint/test FAILURE (clean
# non-zero before the budget) still BLOCKS the commit — only a budget-exceeding
# HANG is skipped, and the pre-push `--all` gate + CI run the full suite. The
# ceiling is enforced by scripts/fleet/check/precommit-steps-are-bounded.mts,
# which fails if a heavy step is invoked un-bounded or the budget drifts above
# its cap.
#
# Portable: no `timeout`/`gtimeout`/`setsid` dependency. `set -m` puts the
# backgrounded job in its own process group so `kill -- -$pgid` reaps the
# whole tree; poll in 1s ticks (sh has no `wait -t`).
PRECOMMIT_STEP_BUDGET_S=10
run_step_bounded() {
  step_name=$1
  shift
  step_log=$(mktemp -t "pre-commit-${step_name}.XXXXXX") || step_log=/tmp/pre-commit-step.log
  set -m
  { "$@" >"$step_log" 2>&1; } &
  job=$!
  set +m
  # Poll at 5 Hz (0.2s tick) so a fast step isn't rounded up to a full second
  # of latency before the loop notices it finished; elapsed seconds = ticks / 5.
  # `sleep 0.2` is honored by GNU coreutils, macOS, and busybox sleep.
  ticks=0
  elapsed=0
  while kill -0 "$job" 2>/dev/null; do
    if [ "$elapsed" -ge "$PRECOMMIT_STEP_BUDGET_S" ]; then
      # Budget blown — a deadlock or an over-broad related-set. Take out the
      # whole group (sfw wrapper + workers), TERM then KILL, and fail open.
      # The kills run in an stderr-discarded subshell so the shell's
      # "Terminated" job-control notice doesn't leak into the commit output.
      { kill -- -"$job"; sleep 1; kill -9 -- -"$job"; } 2>/dev/null
      wait "$job" 2>/dev/null
      cat "$step_log" 2>/dev/null
      rm -f "$step_log"
      printf '\n[pre-commit] %s exceeded %ss budget — process group killed; ' \
        "$step_name" "$PRECOMMIT_STEP_BUDGET_S"
      printf 'skipped (non-blocking). The merge gate runs the full suite.\n'
      return 0
    fi
    sleep 0.2
    ticks=$((ticks + 1))
    elapsed=$((ticks / 5))
  done
  wait "$job"
  status=$?
  cat "$step_log" 2>/dev/null
  if [ "$status" -ne 0 ]; then
    printf '\n========== pre-commit: %s FAILED (exit %s) ==========\n' "$step_name" "$status"
    printf '\n========== full log: %s ==========\n' "$step_log"
  else
    rm -f "$step_log"
  fi
  return "$status"
}
