# Stop the bleeding

Companion to the `### Drift watch` rule in `template/CLAUDE.md`. Drift watch says the newer version is canonical and older repos catch up. This file covers the **order of operations** when a cascaded file is actively _broken_ in a downstream repo — not just stale, but blocking work.

## The principle

> When a cascaded fleet file breaks a downstream repo, fix it locally first to unblock, then reconcile upstream and cascade.

A file that the wheelhouse owns (a hook, a `scripts/*.mts` runner, a CLAUDE.md block) can break in a downstream `socket-*` repo when the repo's copy lags a template change — e.g. an import path the template already migrated but the downstream cascade predates. The breakage often surfaces as a crashing pre-commit hook, so it blocks the very commit you're trying to land.

Two failure modes to avoid:

- **Fix only locally** → the canonical template stays broken, and the next cascade re-introduces the breakage (the local fix becomes drift the moment it lands).
- **Fix only upstream** → the current work stays blocked while you do template surgery; worse if the wheelhouse is mid-flight under another agent.

So do both, in order.

## Order of operations

1. **Stop the bleeding (downstream).** Make the smallest local fix that unblocks — typically matching the file to its current template form (the template is canonical per [Drift watch](drift-watch.md)). Commit the downstream work.
2. **Reconcile upstream (wheelhouse), right after.** Apply the canonical fix to `template/` (+ `scripts/sync-scaffolding/manifest.mts` if the file's required-set or path changed). "Right after" means this turn or the next — not a deferred backlog item — _unless_ a concurrent session is editing the same wheelhouse files (see [parallel-claude-sessions](parallel-claude-sessions.md); work in a clean tree, never clobber in-flight edits).
3. **Test it.** Run the affected script / hook in the wheelhouse (or a member with the deps installed) before pushing.
4. **Push to cascade.** Push directly to the wheelhouse `main`; the `template/` change then flows to every fleet repo via `node scripts/sync-scaffolding.mts --all --fix` (or the per-repo `--target` form). Use the `chore(wheelhouse): cascade <fix>` convention from Drift watch.

## Why a local fix isn't "backward compatibility"

Stopping the bleeding locally is not maintaining a compat shim (which the fleet forbids). It's a same-shape repair that converges _toward_ the canonical form — the upstream reconciliation in step 2 makes the local fix redundant, not permanent. If your local fix diverges from where the template is heading, you fixed it wrong.
