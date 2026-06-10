# broken-hook-detector

**Lifecycle**: SessionStart

**Purpose**: the single, standalone hook-recovery net. Catch the failure mode where every Bash invocation prints noisy `PreToolUse:Bash hook error … node:internal/modules/package_json_reader:314` lines without identifying which hook crashed or what it needed, and, for the common deterministic cause, auto-repair it.

## What it does

At `SessionStart` (once per session, no Bash spam), the hook probes each `.claude/hooks/*/index.mts` and classifies any `ERR_MODULE_NOT_FOUND` into one of two causes.

### (A) Gutted node_modules, auto-repaired

A `pnpm install` aborted mid-purge (`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`) deletes the top-level package links but leaves the `.pnpm` virtual store intact, plus a stale `node_modules/.pnpm-workspace-state-v1.json`. That stale marker makes every subsequent `pnpm install` / `--force` no-op with "Already up to date" while `node_modules` stays unlinked, so every fleet hook crashes on `@socketsecurity/lib-stable`.

The hook detects this by a precise 3-way signature (`.pnpm` store populated, a stale state marker present, and the top-level `@socketsecurity/` link missing), then auto-repairs. It removes the stale markers and runs `CI=true pnpm install`, which re-links from the intact store in under a second with no network (every package is already in `.pnpm`). It reports the outcome as `additionalContext`.

The repair is guarded. It only fires on the exact signature, skips when a `pnpm install` is already running (a second concurrent install is what *causes* the gutting), runs at most once per session (a temp-dir sentinel), and removes the markers only immediately before the install so a bail-out never leaves `node_modules` in a worse state. If any guard trips, it reports the manual command instead of acting.

### (B) Missing dep, reported

A genuinely-uninstalled new dependency (absent from the `.pnpm` store too, usually a fresh cascade `import` the repo hasn't installed). The hook reports the failing hook, the missing package(s), and the exact `pnpm i` command. It does not auto-install: a new dep may also need a catalog entry plus soak-bypass, which needs judgment.

## Self-imposed constraint: Node built-ins only

This hook is the safety net for "the lib is unresolvable"; it must not itself depend on anything installed via pnpm. The entire import surface is `node:fs`, `node:path`, `node:child_process`, `node:url`. It *spawns* `pnpm` for the gutted repair, but never *imports* a pnpm-installed module, so it works even when every such module is broken, which is the whole point. This is the documented exemption from `prefer-async-spawn-guard` (the recovery net cannot route through the lib it recovers).

## Fail-open

The probe and the repair never block. On any internal error (timeout, unreadable file, a guard tripping, the install failing) the hook exits 0 and the session starts normally. The point is recovery plus diagnosis, not enforcement.

## Timing note (the mid-session gap)

This fires at `SessionStart`, so it repairs the gutted state for the *next* session. A gutting that happens *mid*-session still surfaces as the raw Bash crash noise during that session, and the printed or auto-run command is the fix in both cases. A mid-session detector would have to run on every Bash call, which is too heavy, so the SessionStart repair covers the common "next session is broken" case.
