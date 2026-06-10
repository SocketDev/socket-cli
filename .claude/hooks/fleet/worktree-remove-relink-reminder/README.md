# worktree-remove-relink-reminder

Claude Code **PostToolUse** hook. After a Bash `git worktree remove` or
`git worktree prune`, it writes a stderr reminder to run `pnpm i` in the
**main** checkout.

## Why

Creating a `git worktree` can leave the main repo's `node_modules`
symlinks (such as `@socketsecurity/lib-stable`) pointing into the worktree
directory. This happens when pnpm relinks the shared store while the
worktree exists. Removing or pruning that worktree then dangles those
links, so every lib-importing fleet hook dies with:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@socketsecurity/lib-stable'
```

`pnpm install` in the main checkout rebuilds the links from the lockfile,
restoring the symlink to `../.pnpm/...`.

## Trigger

- **Fires** on `Bash` PostToolUse when the command invokes
  `git worktree remove` or `git worktree prune`. Detection uses the shared
  shell parser, so it sees through command chains and `git -C <path>`, and
  ignores a quoted command inside a message. `git worktree add` / `list` /
  `move` do not fire, since they don't orphan the main checkout's links.
- **Reminder, not a blocker.** It exits 0 always. The removal already
  happened; the hook adds the relink step for the next turn.

## Headless purge note

If `pnpm i` wants to purge `node_modules` but there's no TTY, pnpm aborts
with `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`. Prefix `CI=true`:

```sh
CI=true pnpm i
```

## Bypass

None needed. A reminder never blocks; hook output is informational.
