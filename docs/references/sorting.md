# Sorting reference

Sort lists alphanumerically (literal byte order, ASCII before letters).

## Where to sort

- **Config lists** — `permissions.allow` / `permissions.deny` in `.claude/settings.json`, `external-tools.json` checksum keys, allowlists in workflow YAML.
- **Object key entries** — keys in plain JSON config + return-shape literals + internal-state objects. (Exception: `__proto__: null` always comes first, ahead of any data keys.)
- **Import specifiers** — sort named imports inside a single statement: `import { encrypt, randomDataKey, wrapKey } from './crypto.mts'`. `import type` follows the same rule. Statement _order_ (`node:` → external → local → types) is separate from specifier order _within_ a statement.
- **Method / function placement** — within a module, sort top-level functions alphabetically. Convention: private functions (lowercase / un-exported) sort first, exported functions second. The `export` keyword is the divider.
- **Array literals** — when the array is a config list, allowlist, or set-like collection. Position-bearing arrays (e.g. `argv`, anything where index matters semantically) keep their meaningful order.
- **`Set` constructor arguments** — `new Set([...])` and `new SafeSet([...])` literals. The runtime is order-insensitive, so source order is alphanumeric. Same rationale as Array literals: predictable diffs, no merge conflicts on insertions.

## Default

When in doubt, sort. The cost of a sorted list that didn't need to be is approximately zero; the cost of an unsorted list that did need to be is a merge conflict.
