# Sorting reference

Sort lists alphanumerically (natural order: case-insensitive and numeric-aware).
This is a **universal** rule: any block of sibling items, in any file type, gets
sorted unless there's a documented ordering reason. When you touch an unsorted
block, **fully re-sort it**. Don't append the new entry and leave the rest unsorted.

## What "alphanumeric" means here

The one canonical comparator is `naturalCompare` from
`@socketsecurity/lib/sorts/natural`. Every `socket/sort-*` rule and the
`alpha-sort-nudge` hook delegate to it, so all surfaces agree.

1. **Natural numeric order.** `'name-2'` sorts **before** `'name-10'` (the
   embedded number is compared as a number, not character by character).
2. **Case-insensitive.** `'apple'`, `'Mango'`, `'zebra'` (a lowercase word is
   not forced behind an uppercase one). Capitalization is a tiebreak, not the
   primary key.
3. **Whole-token comparison**, not character-class buckets.

These are the exact semantics every `socket/sort-*` lint rule uses.

## Where to sort: code surfaces (lint-enforced)

- **Import specifiers**: named imports inside a single statement, e.g.
  `import { encrypt, randomDataKey, wrapKey } from './crypto.mts'`. `import type`
  follows the same rule. Statement _order_ (`node:` → external → local → types)
  is separate from specifier order _within_ a statement. Enforced by
  `socket/sort-named-imports`.
- **Object literal properties**: sibling properties of an object literal at
  module scope (and inside `export const` / `export default`) sort
  alphanumerically. Exception: `__proto__: null` always comes first, ahead of
  any data key. Object literals that are position-bearing (HTTP header order,
  protocol field order) opt out with `// socket-lint: allow object-property-order`.
  Enforced by `socket/sort-object-literal-properties`.
- **Method / function placement**: within a module, sort top-level functions
  alphabetically. Private functions (lowercase / un-exported) sort first,
  exported functions second; the `export` keyword is the divider. `main`, if
  present, stays last. Enforced by `socket/sort-source-methods`.
- **Array literals**: when the array is a config list, allowlist, or set-like
  collection. Position-bearing arrays (`argv`, anything where index matters
  semantically) keep their meaningful order.
- **`Set` constructor arguments**: `new Set([...])` and `new SafeSet([...])`
  literals. The runtime is order-insensitive, so source order is alphanumeric.
  Enforced by `socket/sort-set-args`.
- **Regex alternation groups**: `(foo|bar|baz)` reads as `(bar|baz|foo)`.
  Capturing, non-capturing, and named-capture groups all follow the rule.
  Auto-fixable when every alternative is a simple literal. Order-bearing
  alternations (rare; markup parsers where `<!--|-->` would silently mismatch if
  reordered) append `// socket-lint: allow regex-alternation-order`. Enforced by
  `socket/sort-regex-alternations`.
- **String-equality disjunctions**: `x === 'a' || x === 'b' || x === 'c'` reads
  with the comparand strings in alpha order. The De Morgan dual
  `x !== 'a' && x !== 'b'` follows the same rule. Auto-fixable when every clause
  has the same left operand and uses string-literal comparands; mixed shapes are
  skipped. Enforced by `socket/sort-equality-disjunctions`.
- **Boolean identifier chains**: `agentshieldOk && zizmorOk && sfwOk` reads in
  alpha order. Fires only when every leaf is a bare `Identifier` AND the chain
  has **3+ operands** (two-operand chains are guard patterns whose order carries
  narrative). Duplicate identifiers and interior comments are skipped. Enforced
  by `socket/sort-boolean-chains`.
- **TypeScript union of string literals**: `type Source = 'download' | 'path' | 'vfs'`.
  Members are interchangeable at the type level; alpha order makes "which values
  can this take?" answerable without scanning. Position-bearing unions (a
  discriminator where order encodes priority) append
  `// socket-lint: allow union-order`. _(Rule planned; see Roadmap.)_

## Where to sort: non-code surfaces (hook-reminded, manual)

oxlint only sees JS/TS, so these are caught by the `alpha-sort-nudge` hook on
edit and by review, not by a lint rule.

- **JSON / JSONC** (`tsconfig.json`, `package.json`, `.oxlintrc.json`,
  `.config/*.json`): sort every object's keys alphanumerically.
  - Exception: `tsconfig.json` top-level has a canonical order
    (`extends` → `compilerOptions` → `include` → `exclude` → `files`); keys
    _inside_ `compilerOptions` alphabetize.
  - Exception: `package.json` top-level keeps npm convention
    (`name` → `version` → `description` → … → `scripts` → `dependencies`); keys
    inside `scripts` / `dependencies` / `devDependencies` alphabetize.
- **YAML** (`.github/workflows/*.yml`, `pnpm-workspace.yaml`): `env:` blocks,
  `with:` blocks, `catalog:` entries, `minimumReleaseAgeExclude` arrays, and
  allowlist arrays alphabetize. `matrix.include[]` entries alphabetize by a
  compound `platform → arch` key. **Even commented-out matrix entries** sort into
  position; don't drop them at the bottom.
  - Exception: step lists are ordered by pipeline phase, not alpha.
  - Exception: active matrix entries today are `x64`-before-`arm64` fleet-wide
    for historical reasons; **new** entries follow alpha (`arm64` < `x64`), and a
    fleet-wide cascade re-sort of the active entries is a future PR. (Origin:
    socket-btm `boringssl.yml`, commit c8dd1f1b.)
- **Bash / shell variables in workflow scripts**: cache-key hash assignments
  (`BIN_INFRA_LIB=$(...)`, `BORINGSSL_PACKAGE_JSON=$(...)`) alphabetize. Hash
  order doesn't affect correctness, but stable diffs do.
- **Markdown lists** (README consumer lists, doc bullet lists, fleet-canonical
  tables): alphabetize sibling bullets.
  - Exception: narrative ordering (numbered setup steps, "first X then Y").
    State the reason in surrounding prose.
  - **NO ELLIPSIS.** Drop `"..."` / `"…"` from list endings. List every item
    alphabetically, or write "N items, see `<source>`". Never trail off.

## Load-bearing order: verify before sorting

Before re-sorting any sibling list, verify that order is not load-bearing. Two
failure classes:

1. **Shared-object aliasing / mutation order.** When siblings are objects that
   share identity — the same reference held by multiple callers — and one sibling
   writes to the shared object's properties, the write sequence is load-bearing.
   Alphabetical re-sorting changes which write happens first and can silently
   corrupt the shared object's state for subsequent reads. The kw() incident:
   a helper's `options` parameter was the same object the caller passed in.
   Sibling helpers wrote directly to `options.beforeExpr` and `options.startsExpr`
   on the shared config. When those siblings were alphabetically re-sorted, the
   write ordering changed and the caller's config was left in a different state,
   producing a silent misparse. The fix for the underlying bug is the
   `socket/no-options-param-mutation` rule: never write `options.x = y` inside a
   function body — use a spread-copy local (`const merged = { ...options, x: y }`)
   so the caller's object is never touched. Once mutation is eliminated, the sort
   order is safe.

2. **TDZ chains and module-scope reads.** A module-scope `const A = f()` that
   reads `B` before `B` is initialized is a temporal dead zone fault. Sort only
   when every sibling is independently initialized (no cross-references at
   definition time).

When in doubt: add an inline comment stating the reason for the ordering, then
leave the block unsorted. `// order-independent` is the opt-in for sorted blocks
under script-name matching (see `script-aggregation.md`).

## Behavior rules

- **Fully re-sort, don't append.** Editing an already-sorted block → insert in
  sorted position. Editing an unsorted block → fully re-sort it in the same
  commit.
- **Cascade-scoped re-sorts** (e.g. all 8 builder workflows' matrix entries) get
  a dedicated `chore(wheelhouse): cascade alpha-sort <pattern>` PR. Don't slip
  the re-sort into unrelated work.
- **State the reason for any non-alpha order inline.** Boot/init sequences,
  dependency chains, parser tokens in lex order, and discriminator priority all
  qualify.

## Default

When in doubt, sort. Sorting a list that didn't need it costs nothing. Leaving
one unsorted that did costs a merge conflict later.

## Roadmap (not yet enforced)

| Surface                                                              | Plan                                                                           |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `export { … }` lists                                                 | `socket/sort-named-exports` — mirror `sort-named-imports`.                     |
| TS string-literal unions                                             | `socket/sort-union-members` — with `// socket-lint: allow union-order` escape. |
| Module-scope const arrays                                            | `socket/sort-array-literals` — skip position-bearing arrays.                   |
| Independent switch-case branches                                     | future rule; skip fall-through / early-return chains.                          |
| `.claude/settings.json` permission lists, `external-tools.json` keys | sync-scaffolding sort check.                                                   |

## Provenance

User-confirmed across 2026-04-17 → 2026-05-29 in socket-lib, socket-cli,
socket-btm, ultrathink, socket-sdk-js, and the fleet source repo. Representative asks:
"properties and configs should be sorted alphanumerically" (JSON keys,
2026-04-17); "lets alphanumeric sort" (object-literal props); repeated
`sort-source-methods` reorders; "make `sort-source-methods` autofixable"; "add a
`sort-boolean-chains` rule"; "alphanumeric, no ellipsis" (README lists,
2026-05-29); "alphanumeric sort" on commented matrix entries
(`boringssl.yml`, 2026-05-29); "how can we do more alphanumeric sorting"
(2026-05-29, the meta-ask that produced this consolidation). John-David treats
an unsorted list as a defect: "when in doubt, sort."
