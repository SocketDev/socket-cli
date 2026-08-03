# Options-object pattern

Use an options object instead of boolean (or other positional) parameters.
A boolean positional forces callers to write `foo(x, true)` where the
`true` is silent and meaningless at the call site — the
[boolean-trap](https://ariya.io/2011/08/hall-of-api-shame-boolean-trap).
An options object names the flag: `foo(x, { dry: true })`.

## Canonical shape

```ts
// 1. Declare the interface with every field `?: T | undefined` — both
//    the optional marker AND the explicit `| undefined`. This satisfies
//    `exactOptionalPropertyTypes` and documents the absent-vs-unset
//    distinction explicitly.
export interface FooOptions {
  dry?:     boolean | undefined
  verbose?: boolean | undefined
  signal?:  AbortSignal | undefined
}

// 2. The param is `options?: TypedOptions | undefined` — the same dual
//    optional+undefined pattern on the container itself.
export function foo(
  src: string,
  options?: FooOptions | undefined,
): void {
  // 3. Resolve via a null-prototype spread so a poisoned
  //    Object.prototype can't inject a `dry` getter.
  const opts = { __proto__: null, ...options } as FooOptions

  const dry     = opts.dry     === true
  const verbose = opts.verbose === true
  …
}
```

## Why `{ __proto__: null, ...options }`

A spread onto a plain `{}` copies the option properties but keeps
`Object.prototype` in the chain — so a prototype-poisoning attack can
supply a `dry` getter via `Object.prototype.dry`. The null-prototype
spread breaks that chain: the resulting object has no prototype, so
every property access hits only the own properties (the caller's
options). The `as TypedOptions` cast tells TypeScript the resulting
object matches the interface after the prototype strip.

## Detecting boolean trap at edit time

The `no-boolean-trap-guard` hook blocks Write/Edit ops that introduce a
boolean positional in a multi-param function signature. Bypass:
`Allow boolean-trap bypass`.
