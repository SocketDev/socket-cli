# prefer-async-spawn-guard

PreToolUse Edit/Write hook that blocks importing from `node:child_process` (or
bare `child_process`). The fleet routes every subprocess through
`@socketsecurity/lib-stable/process/spawn/child`.

## What it blocks

- `import { spawnSync } from 'node:child_process'` (and `spawn`, `exec`,
  `execSync`, `execFile`, `execFileSync`, `fork` — any named import)
- bare `import ... from 'child_process'`
- `export ... from 'node:child_process'` re-exports
- `require('node:child_process')` / `require('child_process')`

Only `.ts/.tsx/.mts/.cts/.js/.jsx/.mjs/.cjs` files are policed.

## Why

`spawnSync` freezes the runner; `execSync` runs through a shell (injection
surface). The lib `spawn` is async, ships a typed `SpawnError` +
`isSpawnError` guard, and takes an array-of-args contract. Mirrors the
commit-time `socket/prefer-async-spawn` + `socket/prefer-spawn-over-execsync`
oxlint rules — this hook catches the import at edit time so the wrong shape is
never written (the rules would only fire at commit). Defense in depth: rule +
hook + CLAUDE.md "Code style" invariant.

## Use the wrapper

```ts
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
```

Reach for `spawnSync` only when sync semantics are genuinely required — still
from the lib, not the builtin.

## Bypass

Type `Allow async-spawn bypass` in a recent message. Silence entirely with
`SOCKET_PREFER_ASYNC_SPAWN_GUARD_DISABLED=1`.

## Exemptions

This hook's own files, the two oxlint rule + test files, and the
markdownlint `wheelhouse-self-skip` shim (a `.mjs` rule loaded by
markdownlint-cli2, which can't await the async lib wrapper — its documented
fallback is the sync builtin).

## Companion files

- `index.mts` — the hook; `findChildProcessImports` / `isExemptPath` are the
  pure, exported detectors.
- `test/index.test.mts` — node:test specs.
- `package.json` — workspace declaration so `taze` sees the hook's deps.
