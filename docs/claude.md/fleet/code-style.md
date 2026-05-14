# Code style

The CLAUDE.md `### Code style` section is the short list of heaviest invariants; this file is the full set of subrules and their rationale. When a rule has a sister skill or hook, the SKILL.md / hook README is canonical for the enforcement details — this file is the reading-order overview.

## Comments

Default to none. Write one only when the WHY is non-obvious to a senior engineer. **When you do write a comment, the audience is a junior dev**: explain the constraint, the hidden invariant, the "why this and not the obvious thing." Don't label it ("for junior devs:", "intuition:", etc.) — just write in that voice. No teacher-tone, no condescension, no flattering the reader.

## Completion

Never leave `TODO` / `FIXME` / `XXX` / shims / stubs / placeholders. Finish 100%. If too large for one pass, ask before cutting scope.

## `null` vs `undefined`

Use `undefined`. `null` is allowed only for `__proto__: null` or external API requirements.

## Object literals

`{ __proto__: null, ... }` for config / return / internal-state.

## Imports

No dynamic `await import()`. `node:fs` cherry-picks (`existsSync`, `promises as fs`); `path` / `os` / `url` / `crypto` use default imports. Exception: `fileURLToPath` from `node:url`.

## HTTP

Never `fetch()`. Use `httpJson` / `httpText` / `httpRequest` from `@socketsecurity/lib/http-request`.

## Subprocesses

Prefer async `spawn` from `@socketsecurity/lib/spawn` over `spawnSync` from `node:child_process`. Async unblocks parallel tests / event-loop work; the sync version freezes the runner for the duration of the child. Use `spawnSync` only when you genuinely need synchronous semantics (script bootstrapping, a hot loop where awaiting would invert control flow). When you do need stdin input: `const child = spawn(cmd, args, opts); child.stdin?.end(payload); const r = await child;` — the lib's `spawn` returns a thenable child handle, not a `{ input }` option. Throws `SpawnError` on non-zero exit; catch with `isSpawnError(e)` to read `e.code` / `e.stderr`.

## File existence

`existsSync` from `node:fs`. Never `fs.access` / `fs.stat`-for-existence / async `fileExists` wrapper.

## File deletion

Route every delete through `safeDelete()` / `safeDeleteSync()` from `@socketsecurity/lib/fs`. Never `fs.rm` / `fs.unlink` / `fs.rmdir` / `rm -rf` directly — even for one known file. Prefer the async `safeDelete()` over `safeDeleteSync()` when the surrounding code is already async (test bodies, request handlers, build scripts that await elsewhere) — sync I/O blocks the event loop and there's no benefit when the caller is awaiting anyway. Reserve `safeDeleteSync()` for top-level scripts whose entire flow is sync.

## Edits

Edit tool, never `sed` / `awk`.

## Generated reports

Quality scans, security audits, perf snapshots, anything an automated tool emits — write to `.claude/reports/` (naturally gitignored as part of `.claude/*`, no separate rule needed). Never commit reports to a tracked `reports/`, `docs/reports/`, or similarly-named tracked directory: dated reports rot the moment they land and the directory becomes a graveyard. The current state of the repo is the report; tools regenerate findings on demand. If a finding is genuinely worth keeping past one run, fix it or open an issue — don't pickle it as a markdown file.

## Inclusive language

See [`inclusive-language.md`](inclusive-language.md) for the substitution table.

## Sorting

Sort alphanumerically (literal byte order, ASCII before letters). Applies to: object property keys (config + return shapes + internal state — `__proto__: null` first); named imports inside a single statement (`import { a, b, c }`); `Set` / `SafeSet` constructor arguments; allowlists / denylists / config arrays / interface members; **string-equality disjunctions** (`x === 'a' || x === 'b'` and the De Morgan dual `x !== 'a' && x !== 'b'`). Position-bearing arrays (where index matters) keep their meaningful order. Full details in [`sorting.md`](sorting.md). When in doubt, sort.

## `Promise.race` / `Promise.any` in loops

Never re-race a pool that survives across iterations (the handlers stack). See `.claude/skills/plug-leaking-promise-race/SKILL.md`.

## `Safe` suffix

Non-throwing wrappers end in `Safe` (`safeDelete`, `safeDeleteSync`, `applySafe`, `weakRefSafe`). Read it as "X, but safe from throwing." The wrapper traps the thrown value internally and returns `undefined` (or the documented fallback). Don't invent alternative suffixes (`Try`, `OrUndefined`, `Maybe`) — pick `Safe`.

## `node:smol-*` modules

Feature-detect, then require. From outside socket-btm (socket-lib, socket-cli, anywhere else): `import { isBuiltin } from 'node:module'; if (isBuiltin('node:smol-X')) { const mod = require('node:smol-X') }`. The `node:smol-*` namespace is provided by socket-btm's smol Node binary; on stock Node `isBuiltin` returns false and the require would throw. Wrap the loader in a `/*@__NO_SIDE_EFFECTS__*/` lazy-load that caches the result — see `socket-lib/src/smol/util.ts` and `socket-lib/src/smol/primordial.ts` for canonical shape. **Inside** socket-btm's `additions/source-patched/` JS (the smol binary's own bootstrap code), use `internalBinding('smol_X')` directly — that's the C++-binding access path and it's guaranteed available there.
