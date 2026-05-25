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

No dynamic `await import()`. `node:fs` is the canonical fs source — one import per file: `import { existsSync, promises as fs } from 'node:fs'`. Sync APIs may be cherry-picked (`existsSync`, `copyFileSync`, `readFileSync`, etc.). Async APIs MUST go through the `promises as fs` namespace — never cherry-pick from `node:fs/promises` (`import { rename } from 'node:fs/promises'` is forbidden; use `fs.rename(...)` instead). Rationale: a single canonical handle for async fs keeps the call sites uniform across the fleet and avoids two imports for what's logically one module. `path` / `os` / `url` / `crypto` use default imports. Exception: `fileURLToPath` from `node:url`.

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

## Env-var checks

`'CI' in process.env` presence check over truthy. Whether `CI` is set is what matters; the value is irrelevant.

## `node:os` import

`import os from 'node:os'` (default import). Not `import { tmpdir, homedir } from 'node:os'`. Default-import shape lets call sites read `os.tmpdir()` etc. — clearer at the call site that this is an OS-level lookup.

## Logger

`getDefaultLogger()` from `@socketsecurity/lib-stable/logger` over `console.*` / `process.stderr.write` / `process.stdout.write` (enforced by `.claude/hooks/logger-guard/`). The logger wraps level routing, transcript-safe rendering, and the token-minifier proxy.

## Doc filenames

`lowercase-with-hyphens.md` under `docs/` or `.claude/` (enforced by `.claude/hooks/markdown-filename-guard/`). One canonical form; no spaces, no PascalCase, no underscores.

## Inline `<script>` defer/async

`<script defer>` and `<script async>` without a `src=` attribute are a spec no-op — the HTML parser ignores the deferral on inline scripts. Wrap the body in a `DOMContentLoaded` listener instead. Enforced by `.claude/hooks/inline-script-defer-guard/` + the `socket/no-inline-defer-async` oxlint rule. Bypass: `Allow inline-defer bypass`.

## ESLint / Biome config refs

Stale. The fleet runs oxlint / oxfmt. Don't reference `.eslintrc` / `eslint-config-*` / `biome.json` / `@biomejs/*` in any new code (enforced by the `socket/no-eslint-biome-config-ref` oxlint rule).

## `structuredClone` vs JSON round-trip

`structuredClone(x)` is banned for JSON-shaped data — `JSON.parse(JSON.stringify(x))` (or `JSONParse(JSONStringify(x))` from `@socketsecurity/lib/primordials/json`) is 3-5× faster because it skips the full HTML structured-clone algorithm (type tagging, transferable handling, prototype preservation, cycle detection — none of which the JSON subset needs). The common case is "defensive-copy a `JSON.parse`d value to defend against caller mutation"; that's purely JSON-shaped by construction. Opt back in per-line with `// oxlint-disable-next-line socket/no-structured-clone-prefer-json -- <reason>` when the value genuinely contains `Date` / `Map` / `Set` / `RegExp` / `ArrayBuffer` / typed-array shapes. Enforced edit-time by `.claude/hooks/no-structured-clone-prefer-json-guard/` + the `socket/no-structured-clone-prefer-json` oxlint rule. Bypass: `Allow no-structured-clone-prefer-json bypass`.

## Comments — cross-port Lock-step

See [`parser-comments.md`](parser-comments.md) §5–7 for the full Lock-step comment spec (port provenance, byte-identical header block, deviation paragraphs). Enforced edit-time by `.claude/hooks/lock-step-ref-guard/` and CI-gate-time by `scripts/check-lock-step-refs.mts` + `scripts/check-lock-step-header.mts`. Bypass: `Allow lock-step bypass`.

## Pointer comments

`// see X` comments need both a destination and an inline one-line claim of what's at the destination (enforced by `.claude/hooks/pointer-comment-guard/`). "see X" alone forces the reader to chase the link to learn anything; "see X: it does Y" gives the reader Y up front and X for verification.

## `Promise.race` / `Promise.any` in loops

Never re-race a pool that survives across iterations (the handlers stack). See `.claude/skills/plug-leaking-promise-race/SKILL.md`.

## `Safe` suffix

Non-throwing wrappers end in `Safe` (`safeDelete`, `safeDeleteSync`, `applySafe`, `weakRefSafe`). Read it as "X, but safe from throwing." The wrapper traps the thrown value internally and returns `undefined` (or the documented fallback). Don't invent alternative suffixes (`Try`, `OrUndefined`, `Maybe`) — pick `Safe`.

## `node:smol-*` modules

Feature-detect, then require. From outside socket-btm (socket-lib, socket-cli, anywhere else): `import { isBuiltin } from 'node:module'; if (isBuiltin('node:smol-X')) { const mod = require('node:smol-X') }`. The `node:smol-*` namespace is provided by socket-btm's smol Node binary; on stock Node `isBuiltin` returns false and the require would throw. Wrap the loader in a `/*@__NO_SIDE_EFFECTS__*/` lazy-load that caches the result — see `socket-lib/src/smol/util.ts` and `socket-lib/src/smol/primordial.ts` for canonical shape. **Inside** socket-btm's `additions/source-patched/` JS (the smol binary's own bootstrap code), use `internalBinding('smol_X')` directly — that's the C++-binding access path and it's guaranteed available there.
