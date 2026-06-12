# options-param-naming-guard

A **Claude Code PreToolUse hook** that blocks Edit/Write tool calls
introducing a function whose options-bag param is named `opts` into a
code file.

## Why this rule

The fleet options convention uses two names, one per role:

- the **param** that receives a caller's options bag is `options`;
- the **normalized local** it produces is `opts`
  (`const opts = { __proto__: null, ...options }`).

A param named `opts` makes the raw, untrusted input wear the "safe"
name, conflating it with its null-proto-safe form. It also reads as if
the input were already normalized, which hides the missing
prototype-pollution defense.

This is the edit-time half of a defense-in-depth pair. The lint half is
`socket/options-param-naming`, which also autofixes the rename.

## Conventional shape

```ts
// Wrong — the param is named `opts`:
function resolve(opts?: ResolveOptions) {
  return opts?.cwd
}

// Right — param `options`, normalized local `opts`:
function resolve(options?: ResolveOptions) {
  const opts = { __proto__: null, ...options } as ResolveOptions
  return opts.cwd
}
```

## What's enforced

- A function (declaration / expression / arrow) with a param that is a
  plain Identifier named `opts`, in a code file
  (`.ts` / `.mts` / `.cts` / `.js` / `.mjs` / `.cjs`).
- Detection is **AST-based**, parsed via the vendored acorn-wasm in
  `_shared/acorn/`. The parser fully understands TypeScript, so a typed
  `opts?: { … }` param matches on its Identifier name, never on a regex
  over the type-annotation text.

## What's exempt

- Declaration files (`.d.ts`, `.d.mts`) — they mirror external-package
  signatures verbatim.
- Test files (`*.test.*`, files under a `/test/` tree) — they author
  throwaway option-shaped helpers, not production readers.
- A destructured param (`{ opts }`), a rest param, a `.opts` property
  access, or a `{ opts: number }` type member — none is a param binding
  named `opts`.

## Override marker

For a legitimate one-off, add the marker on the param line or the line
above the function:

```ts
// socket-lint: allow options-param-naming
function legacy(opts: Whatever) {
  return opts
}
```

## Bypass phrase

To bypass the whole hook for one session, the user must type
`Allow options-param-naming bypass` verbatim in a recent user turn.

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
            "command": "node .claude/hooks/fleet/options-param-naming-guard/index.mts"
          }
        ]
      }
    ]
  }
}
```

## Cross-fleet sync

This hook lives in `socket-wheelhouse/template/.claude/hooks/options-param-naming-guard`
and is required to be byte-identical across every fleet repo.
`scripts/sync-scaffolding.mts` flags drift; `--fix` rewrites it.
