# no-boolean-trap-guard

PreToolUse Write/Edit guard that blocks introducing a boolean positional
parameter in a TypeScript function signature — the
[boolean-trap](https://ariya.io/2011/08/hall-of-api-shame-boolean-trap)
antipattern.

## Why

`function foo(x: T, dry: boolean)` forces callers to write
`foo(x, true)` where the `true` is silent and meaningless. Six months
later nobody knows what it means. An options object names the flag at
the call site: `foo(x, { dry: true })`.

## The fleet options-object pattern

```ts
// Declaration
export interface FooOptions {
  dry?: boolean | undefined
  verbose?: boolean | undefined
}
export function foo(x: T, options?: FooOptions | undefined): void {
  // Null-prototype spread — immune to poisoned Object.prototype.
  const opts = { __proto__: null, ...options } as FooOptions
  const dry = opts.dry === true
  …
}
```

Key invariants: field types `?: T | undefined` (both `?` AND `| undefined`);
options param `?: TypedOptions | undefined`; body resolves via the
`{ __proto__: null, ...options }` spread. Full recipe in
[`docs/claude.md/fleet/options-object.md`](../../../docs/claude.md/fleet/options-object.md).

## Allowed

- A function with a **single** boolean param and no other params —
  predicate pattern (`isEnabled(value: boolean)`).
- `boolean` fields inside an interface body (not params).
- Generated / dist / build files.
- Bypass: `Allow boolean-trap bypass`.

## Cross-fleet sync

Lives in `socket-wheelhouse/template/.claude/hooks/fleet/` and is
byte-identical across every fleet repo.
