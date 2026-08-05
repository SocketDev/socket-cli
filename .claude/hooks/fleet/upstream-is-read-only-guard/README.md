# upstream-is-read-only-guard

PreToolUse (Edit / Write / MultiEdit / NotebookEdit) hook. Blocks a write whose
target sits inside an `upstream/` reference tree.

## Why

A vendored upstream's entire value is being **byte-identical** to the `ref =`
pinned in `.gitmodules`. It exists to be read from and ported out of. An edit
there is never a fix: it corrupts the reference every port is measured against,
and it drifts the tree off its pin.

## The incident

A fleet lint autofix rewrote `null` to `undefined` inside
`upstream/actions-checkout/__test__/*.test.ts` — the upstream's own tests. The
drift stayed invisible until lockstep rows were added and the harness reported:

```
submodule HEAD (de0fac2e4500) does not match .gitmodules ref (3d3c42e5aac5)
```

`upstream` is already in `NEVER_GATED_SEGMENTS`, so the linter should not have
reached it. This guard catches **any** writer rather than one lint path.

## What passes

- Restoring a tree TO its pin. That runs through git
  (`git -C upstream/<name> checkout --detach <ref>`), which this hook never
  sees; `no-revert-guard` carves it out separately.
- Anything with `FLEET_SYNC=1` set — the cascade materializes and repins
  upstream trees and is the sanctioned writer.

## Bypass

`Allow upstream-edit bypass`. Reach for it only to stage a patch you are about
to send upstream. Never to "fix" vendored code in place: a local fix silently
diverges every port taken from it afterward.
