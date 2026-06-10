# no-underscore-ident-guard

PreToolUse hook that blocks `Edit` / `Write` operations introducing a new
underscore-prefixed **identifier** (`_resetX`, `_internal`, `_cache`, etc.).

## Why

Privacy in TypeScript is handled by module boundaries (not exporting) or by
the `_internal/` _directory_ pattern — not by leading underscores on symbol
names. The underscore-as-internal-marker convention is borrowed from other
languages where it has runtime meaning; in TS it's purely decorative and
adds noise to `git blame` and IDE autocomplete.

## What's banned

| Form       | Example                    |
| ---------- | -------------------------- |
| Variable   | `const _cache = new Map()` |
| Function   | `function _doResolve() {}` |
| Class      | `class _Helper {}`         |
| Interface  | `interface _Options {}`    |
| Type alias | `type _Internal = ...`     |
| Re-export  | `export { _foo }`          |

## What's allowed

- **`_internal/` directories** — the canonical way to signal module-private
  files. The rule is about identifiers inside files, not folder layout.
- **Bare `_` throwaway** — `for (const _ of arr)`, destructuring rest, etc.
- **Generated output** under `dist/` / `build/` / `node_modules/`.
- **Bypass:** type `Allow underscore-identifier bypass` verbatim in a recent
  user turn.

## See also

- CLAUDE.md → "No underscore-prefixed identifiers"
- `.config/oxlint-plugin/fleet/no-underscore-identifier/index.mts` (commit-time
  partner of this edit-time hook)
