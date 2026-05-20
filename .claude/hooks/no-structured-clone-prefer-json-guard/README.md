# no-structured-clone-prefer-json-guard

A **Claude Code PreToolUse hook** that blocks Edit/Write tool calls
introducing a bare `structuredClone(...)` call into a code file
without the canonical per-line opt-out comment.

## Why this rule

For the JSON-roundtrippable subset — anything that came from
`JSON.parse`, anything you'd happily round-trip through
`JSON.stringify` and back — `JSON.parse(JSON.stringify(x))` is
**3-5× faster** than `structuredClone(x)`. The browser/Node
`structuredClone` runs the full HTML structured-clone algorithm:
type tagging, transferable handling, prototype preservation, cycle
detection. None of those apply to JSON data. The JSON round-trip
goes straight through V8's tight C++ JSON path with no type dispatch.

For caches, hot read-paths, and defensive-copy wrappers, the
constant-factor difference is meaningful at scale.

## Conventional shape

```ts
// Wrong — bare structuredClone on JSON-shaped data:
const copy = structuredClone(parsedJson)

// Right — JSON round-trip:
const copy = JSON.parse(JSON.stringify(parsedJson))

// Right — primordial-safe form for socket-lib internals:
import { JSONParse, JSONStringify } from '@socketsecurity/lib/primordials/json'
const copy = JSONParse(JSONStringify(parsedJson))
```

## When `structuredClone` IS the right tool

The value genuinely contains shapes JSON can't round-trip:

- `Date` instances (JSON → ISO string, not Date)
- `Map` / `Set` (JSON → `{}` / `[]`)
- `RegExp` (JSON → `{}`)
- `ArrayBuffer` / typed arrays (JSON → `{}` / array of numbers)
- `Error` instances (JSON → `{}`)
- Circular references (JSON throws)

For those, opt back in per-line with a rationale:

```ts
// oxlint-disable-next-line socket/no-structured-clone-prefer-json -- value contains Date / Map; JSON round-trip would corrupt.
const copy = structuredClone(value)
```

## What's enforced

- Any line containing `structuredClone(` inside a code file
  (`.ts` / `.mts` / `.cts` / `.js` / `.mjs` / `.cjs`).
- The immediately-preceding line must contain
  `oxlint-disable-next-line socket/no-structured-clone-prefer-json`.
- Lines marked `// socket-hook: allow structured-clone` are also
  exempt for one-off pre-rule legacy cases.

## What's exempt

- Declaration files (`.d.ts`, `.d.mts`).
- Comment lines that happen to mention `structuredClone` (docstrings,
  rationale comments).
- Markdown, JSON, YAML, and any non-code file.

## Override marker

For a legitimate one-off:

```ts
const copy = structuredClone(value) // socket-hook: allow structured-clone
```

Don't reach for this — add the `oxlint-disable-next-line` with a
rationale instead, so the lint rule keeps the per-callsite gate.

## Bypass phrase

If the user genuinely needs to bypass the whole hook for one session,
they must type `Allow no-structured-clone-prefer-json bypass`
verbatim in a recent user turn.

## Wiring

In `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "node .claude/hooks/no-structured-clone-prefer-json-guard/index.mts"
          }
        ]
      }
    ]
  }
}
```

## Cross-fleet sync

This hook lives in `socket-wheelhouse/template/.claude/hooks/no-structured-clone-prefer-json-guard`
and is required to be byte-identical across every fleet repo.
`scripts/sync-scaffolding.mts` flags drift; `--fix` rewrites it.
