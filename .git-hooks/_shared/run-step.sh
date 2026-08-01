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

# Steps that did NOT gate this commit — one that hung past the budget and was
# killed, and one that ran clean but checked zero files. Both exit 0, so
# without this ledger they read exactly like a pass in the commit output.
# Rendered by precommit_gate_summary.
PRECOMMIT_UNGATED_STEPS=''

# lint.mts prints this when the chosen scope resolved to no lintable files: the
# run exits 0 having checked nothing, which is not a verdict.
PRECOMMIT_NOTHING_CHECKED_MARKER='NOT a pass'

# Record a step as ungated, with the reason shown in the summary.
precommit_note_ungated() {
  PRECOMMIT_UNGATED_STEPS="${PRECOMMIT_UNGATED_STEPS}${PRECOMMIT_UNGATED_STEPS:+, }$1 ($2)"
}

# Final verdict. Prints nothing when every gate actually ran, so a clean commit
# stays quiet; prints a loud banner naming each step that did not, so a skipped
# gate can never be mistaken for a passed one. Call once, after the last step.
precommit_gate_summary() {
  if [ -z "$PRECOMMIT_UNGATED_STEPS" ]; then
    return 0
  fi
  printf '\n========== pre-commit: GATE INCOMPLETE ==========\n'
  printf 'These steps did NOT verify this commit: %s.\n' "$PRECOMMIT_UNGATED_STEPS"
  printf 'The commit proceeds ungated for them. Before pushing, run\n'
  printf '`pnpm run lint --all` and `pnpm test` for the real verdict.\n'
  printf '=================================================\n'
}

# Resolves a package.json script to the node script it delegates to; see the
# helper's own header for what it accepts and why. Git runs a hook from the top
# of the working tree, and the rest of this function chain already reads
# `package.json` and runs `<script-target>` from there, so the path is
# cwd-relative like they are. A repo without the helper prints nothing and keeps
# the wrapper.
PKG_SCRIPT_TARGET_HELPER=.git-hooks/_shared/pkg-script-target.mts
pkg_script_node_target() {
  [ -f "$PKG_SCRIPT_TARGET_HELPER" ] || return 0
  node "$PKG_SCRIPT_TARGET_HELPER" "$1" 2>/dev/null || return 0
}

# Run a package.json script as a bounded step, skipping `pnpm run` when the
# script body allows it (see pkg_script_node_target). The step name is the
# script name. Extra arguments are forwarded to the script either way.
run_pkg_step_bounded() {
  script_name=$1
  shift
  step_target=$(pkg_script_node_target "$script_name")
  if [ -n "$step_target" ]; then
    run_step_bounded "$script_name" node "$step_target" "$@" || return $?
  else
    # verify-deps stays off for the commit gate: its job is the STAGED files;
    # dependency freshness belongs to the install/CI gates. Without this, a
    # lockfile that cannot reconcile yet (a soak-window pin mid-wait) blocks
    # every commit in the repo, including doc-only ones. The flag is a pnpm CLI
    # option, so it only applies on this wrapper path.
    run_step_bounded "$script_name" \
      pnpm --config.verify-deps-before-run=false "$script_name" "$@" || return $?
  fi
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
      printf '\n========== pre-commit: %s SKIPPED (budget %ss exceeded) ==========\n' \
        "$step_name" "$PRECOMMIT_STEP_BUDGET_S"
      printf 'The process group was killed. This step did NOT gate the commit.\n'
      printf '=================================================================\n'
      precommit_note_ungated "$step_name" "hung past ${PRECOMMIT_STEP_BUDGET_S}s"
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
    if grep -q "$PRECOMMIT_NOTHING_CHECKED_MARKER" "$step_log" 2>/dev/null; then
      precommit_note_ungated "$step_name" 'checked zero files'
    fi
    rm -f "$step_log"
  fi
  return "$status"
}
