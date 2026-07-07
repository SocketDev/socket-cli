# stale-node-modules-nudge

**Type:** PostToolUse reminder (Bash) — nudges, never blocks.

**Trigger:** a Bash command's output contains either face of the same
worktree-removal dangle:

1. A Node module-resolution error (`ERR_MODULE_NOT_FOUND`, `Cannot find
   package`, `Cannot find module`) for a scoped workspace package
   (`@<scope>/...`, commonly the repo's `-stable` self-alias).
2. `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`, the follow-on trap where
   `pnpm install` (the obvious fix) itself dies because pnpm wants to
   purge a stale modules dir and has no TTY to confirm.

**Why:** `pnpm` symlinks the main checkout's `node_modules`. After a `git
worktree remove` / `prune` those links can dangle into the removed
worktree, so the next hook or script importing a workspace package dies
with `Cannot find package '@socketsecurity/lib-stable'`. A pre-commit
hook hitting this blocks every commit, easy to misread as a content
failure. Running `pnpm install` to relink then hits face #2: in the
headless / `!`-channel pnpm can't show its modules-purge confirmation
prompt, so the relink aborts. Without handling face #2 the suggested fix
is itself blocked, and we step on ourselves.

**Action:** prints a reminder to run the headless-safe relink, `pnpm
install --config.confirmModulesPurge=false`, in the MAIN checkout, then
retry. The `--config.confirmModulesPurge=false` flag lets pnpm
remove+rebuild the modules dir with no TTY prompt, so the fix runs in the
`!`-channel and CI. Does not run the install or retry, and does not
suggest `--no-verify` (the break is transient, not a reason to bypass).

**Bypass:** none — informational only (exit 0).
