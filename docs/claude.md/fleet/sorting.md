# Sorting reference

Sort lists alphanumerically (literal byte order, ASCII before letters).

## Where to sort

- **Config lists** — `permissions.allow` / `permissions.deny` in `.claude/settings.json`, `external-tools.json` checksum keys, allowlists in workflow YAML.
- **Object key entries** — keys in plain JSON config + return-shape literals + internal-state objects. (Exception: `__proto__: null` always comes first, ahead of any data keys.)
- **Import specifiers** — sort named imports inside a single statement: `import { encrypt, randomDataKey, wrapKey } from './crypto.mts'`. `import type` follows the same rule. Statement _order_ (`node:` → external → local → types) is separate from specifier order _within_ a statement.
- **Method / function placement** — within a module, sort top-level functions alphabetically. Convention: private functions (lowercase / un-exported) sort first, exported functions second. The `export` keyword is the divider.
- **Array literals** — when the array is a config list, allowlist, or set-like collection. Position-bearing arrays (e.g. `argv`, anything where index matters semantically) keep their meaningful order.
- **`Set` constructor arguments** — `new Set([...])` and `new SafeSet([...])` literals. The runtime is order-insensitive, so source order is alphanumeric. Same rationale as Array literals: predictable diffs, no merge conflicts on insertions.
- **Regex alternation groups** — `(foo|bar|baz)` reads as `(bar|baz|foo)`. Capturing, non-capturing, and named-capture groups all follow the rule. Auto-fixable when every alternative is a simple literal. The exception is order-bearing alternations where the regex engine MUST try one alternative before another (rare; the canonical example is markup parsers where `<!--|-->` would silently mismatch if reordered) — append `// socket-hook: allow regex-alternation-order` on those lines.
- **String-equality disjunctions** — `x === 'a' || x === 'b' || x === 'c'` reads with the comparand strings in alpha order. The De Morgan dual `x !== 'a' && x !== 'b'` (negative-membership check) follows the same rule. The `||` chain short-circuits regardless of operand order; sorting reduces diff churn when adding new comparands and makes "is X in this set?" checks visually consistent. Auto-fixable when every clause has the same left operand and uses string-literal comparands. Mixed shape (different left, different operator, non-string right) is skipped — those are usually genuine ordering-sensitive predicates and the autofix would change semantics.

## Default

When in doubt, sort. The cost of a sorted list that didn't need to be is approximately zero; the cost of an unsorted list that did need to be is a merge conflict.
