# Windows gotchas: the portability classes, each with its canonical fix

Every entry below shipped a real windows-only CI failure in this repo; several
were invisible for the code's whole life because they fail OPEN (a guard
allows, a gate skips) rather than loud. When touching spawn/path/URL code,
check this list first, and reach for the `@socketsecurity/lib-stable` helper,
never a hand-rolled platform test.

Enforced by `scripts/fleet/check/source-is-windows-portable.mts` (in `check --all`).

## 1. `.cmd` shims need a shell (`pnpm`, `npm`, `yarn`, npm-installed bins)

`spawnSync('pnpm', …)` works on unix and FAILS on windows: `pnpm` is
`pnpm.cmd` there, and an unshelled spawn cannot execute a `.cmd`. The error
often lands in a fail-open branch, so the operation silently vanishes:
version-bump-order-guard's ENTIRE pre-release gate never ran on windows,
undetected since the guard shipped.

Fix: `shell: WIN32` with
`import { WIN32 } from '@socketsecurity/lib-stable/constants/platform'`.
Native executables (`git`, `node`) do NOT need it.

## 2. Drive doubling: `new URL(…).pathname` yields `/D:/…`

On windows a file URL's `.pathname` keeps a leading slash before the drive
(`/D:/a/repo/x.mts`). Any later resolve doubles the drive
(`D:\D:\a\…` → MODULE_NOT_FOUND). Six test suites spawned their hook children
through this shape; whichever ran under CI contention crashed, reading as a
"rotating" flake.

Fix: `fileURLToPath(new URL(…))` from `node:url`. Never `.pathname` for a
filesystem path.

## 3. Shebangs do not execute

`#!/usr/bin/env node` is meaningless on windows. Spawning an npm package's
`bin/` script directly, as the RuleTester does with `oxlint`'s node-shim bin,
fails on every windows run.

Fix: run non-`.exe` bins through `process.execPath`:
`spawnSync(process.execPath, [binPath, …args])`. It is identical on unix and
the only working path on windows.

## 4. Separator-sensitive path matching

`startsWith('/')`, `.split('/')`, and path regexes silently mismatch
windows-form paths (`D:\…`). This is the standing
[`normalize-path-before-match`](normalize-path-before-match.md) rule: run
`normalizePath` from `@socketsecurity/lib-stable/paths/normalize` (or
`toUnixPath`) BEFORE any separator-sensitive operation, and prefer
`path.join`/`path.sep` for construction.

## 5. CRLF on process output

Raw `child_process` output carries `\r\n` on windows; an exact compare or a
`$`-anchored regex against an un-trimmed line fails. The lib-stable `spawnSync`
wrapper already trims stdout. Prefer it over `node:child_process`, and
`.trim()` any raw line before comparing.

## 6. Platform tests: `WIN32`, not `process.platform`

Hand-rolled `process.platform === 'win32'` scatters the platform decision and
drifts. The canonical constants are `WIN32` / `DARWIN` from
`@socketsecurity/lib-stable/constants/platform`.

## The shape of the failure

Windows breakage in this codebase has never been loud: each class above
surfaced as an ALLOW that should have been a block, a skipped gate, an empty
result, or a "flake". When a windows-only failure makes no sense, assume one
of these six until the inputs prove otherwise, and narrate decision inputs
under `SOCKET_DEBUG` rather than guessing (the diagnostic ladder that found
these: stderr-carrying asserts → fail-open catch debug → decision-input
narration).

## 7. POSIX tokenizers eat backslash paths in command strings

`shell-quote`, the fleet's shell parser, applies POSIX escape semantics to
every command string, so `cd C:\Users\x` tokenizes to `C:Usersx`. The mangled
target then fails git resolution, fleet detection fails SAFE to fleet, and
convention guards false-block non-fleet work. The whole chain is windows-only,
and it stayed invisible until a stderr-carrying assert printed the block text.

Fix: recover drive-letter targets from the RAW command, gated on the
tokenizer having seen a real drive-ish token (a raw-only regex harvests prose
mentions, the substring-scanner class). See `lastCdTarget` in
`.claude/hooks/fleet/_shared/fleet-context.mts`.

## 8. Short spawn timeouts die to win32 process-creation latency

A `spawnSync`/`spawn` with a short `timeout:` (a few seconds) that is fine on
POSIX gets KILLED on windows under CI load: process creation there launches a
`.cmd`/`.bat` through cmd.exe (no cheap fork), and a loaded runner spikes past
the budget. The killed probe returns empty output, which a PreToolUse guard
reads as "tool absent" and FAILS OPEN. The gh-token-hygiene storage check
stopped enforcing on windows exactly this way (a chained-command test caught
it: `0 !== 2`, an allow where a block was due).

Fix: wrap a LOCAL process-spawn timeout in `spawnTimeoutMs(<ms>)` from
`.claude/hooks/fleet/_shared/spawn-timeout.mts` (win32 gets 6x headroom; POSIX keeps the base: a
missing binary still fails fast via ENOENT, so the ceiling only extends
patience for a present-but-slow process). A NETWORK spawn (`gh api`,
`gh pr list`) keeps its raw bounded timeout, since scaling a network budget by
platform is wrong, and opts out with a `// win-timeout: network` note inside
the call. Enforced by the `spawn-timeout` rule (hooks only: a script that times
out fails loud, not open).

## 9. Hardcoded POSIX dirs: use the socket-lib path helpers

A literal `/tmp`, `~`, `/home/USER`, or `~/.config` has no meaning on windows
(temp is `%TEMP%`, home is `%USERPROFILE%`, config is `%APPDATA%`). Reach for
the `@socketsecurity/lib-stable/env/*` helpers (`getHome()`,
`getXdgCacheHome()`, `getXdgConfigHome()`, `getXdgDataHome()`,
`getXdgRuntimeDir()`) plus `os.tmpdir()`, which resolve to the right
per-platform location. Never build a path from a hardcoded POSIX absolute.

## Watch-list: classes not yet observed here

No scanner yet (nothing has shipped a failure in this repo), but they follow the
same "reach for the socket-lib helper, not a hand-rolled platform test" rule:

- A case-insensitive filesystem makes `Foo.ts` and `foo.ts` collide; a
  case-sensitive path compare can double-count or miss a match.
- Reserved names (`CON`, `NUL`, `AUX`, `COM1`) and `:` in a filename are illegal
  on windows.
- `MAX_PATH` (260 chars) truncates deep paths without long-path support.
- Env-var names are case-insensitive (`PATH` === `Path`); don't key a map on
  exact-case env names.
