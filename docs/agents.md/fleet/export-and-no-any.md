# Export everything + NO `any` ever

Two paired fleet rules captured under one doc because they're symbiotic — exporting types is what makes "no `any`" practical, and "no `any`" is what makes the export discipline pay back.

## Export everything

**Every top-level function, interface, type alias, class, and helper in `src/` is `export`ed.** No private symbols.

- Privacy is handled by NOT importing in consumers, or by `_internal/` directory layout for module-private files.
- Underscore-prefixed identifiers are separately banned (see _No underscore-prefixed identifiers_).
- Tests need to reach helpers directly — coverage holes appear whenever a test has to go through the public API to exercise an internal helper.
- The `socket/export-top-level-functions` oxlint rule enforces this for all four top-level declaration kinds — function, interface, type alias, and class (one `Program > …Declaration` visitor each, shared autofix that prepends `export`).

**Past incident.** socket-packageurl-js had `interface PurlObject` private at `src/purl-type.mts`. Tests of per-type validators (`PurlType.npm.validate(...)`) had to cast `PurlType` to `any` to call `.validate` because the helper namespace's generic shape didn't propagate the per-type signatures. The `any` cast hid every other type error on those call sites. The fix was to `export interface PurlObject` so tests can import it and type the shape correctly.

## NO `any` ever

The fleet's `typescript/no-explicit-any: "error"` lint setting stays at error level fleet-wide and **never gets relaxed**.

When tests or scripts touch a value of unknown shape, the right choices are:

1. **Type with the actual shape it holds.** Tests rarely operate on truly unknown data — the test author chose the input. Use the concrete shape: `Record<string, unknown>` for dynamic-key access, `t.ImportDeclaration` for babel AST nodes, `{ default?: typeof X | undefined }` for CJS/ESM interop probes.

2. **Type as `unknown` + narrow with a type guard at the use site.** Works when the test really doesn't know the shape ahead of time (parsing arbitrary JSON, reading an opaque API response). Add `if (typeof x === 'string') { ... }` or `assert.ok(isObject(x))` before access.

3. **For namespace objects whose generics don't propagate** (e.g. `createHelpersNamespaceObject` returning `Record<string, Record<string, unknown>>`): define the typed shape inline and cast `as unknown as TypedShape` **once** at the import site, then reference the typed binding everywhere else. Don't cast per-call.

**What's forbidden:**

- `as any` / `: any` / `<any>` anywhere in source or test files.
- Bulk `: any` → `: unknown` sed-replacements without adding type guards. `unknown` and `any` are not interchangeable — `unknown` requires narrowing before property access, so a bulk replace breaks every `x.foo` site downstream.
- Scoped oxlint override on `test/**` that disables `typescript/no-explicit-any`. The `socket/no-file-scope-oxlint-disable` rule + the wider _Don't disable lint rules_ policy both forbid this — fix the underlying types instead.
- Per-line `oxlint-disable-next-line typescript/no-explicit-any` as a default. The disable comments are reserved for genuinely intractable cases (third-party type holes) and need a `-- <reason>` annotation.

**Past incident.** socket-sdk-js's `test/unit/bundle-validation.test.mts` had `path: any` params in babel visitors (`ImportDeclaration(path: any)`, `CallExpression(path: any)`, etc.). A bulk `: any` → `: unknown` sed pass kept the code compiling but broke every `path.node.X` access downstream (TS18046 cascade). The right fix was importing `import type { NodePath } from '@babel/traverse'` + `import type * as t from '@babel/types'` and typing each visitor as `NodePath<t.ImportDeclaration>` etc., then guarding `callee.type === 'Identifier'` before reading `callee.name`. Slower to type out, much safer.

## When generics don't propagate

If you find yourself wanting `any` to call a method on a namespace object, the underlying issue is almost always that the namespace builder's generic types collapsed. Two patches:

1. **Fix the builder** (preferred long-term): re-type the helper-namespace constructor to be properly generic — `function createHelpersNamespaceObject<H extends Record<string, Record<string, unknown>>>(helpers: H): H` — so consumers see the per-type signatures. Touches src; do it when the change is small.

2. **Type at the consumer** (preferred short-term, for tests): define the typed shape next to the consumer and cast once.

```ts
// Pattern: typed alias next to the consumer. Mirror the runtime shape —
// `createHelpersNamespaceObject` inverts so calls read as `<key>.<method>`,
// not `<method>.<key>`. PurlType uses ecosystem keys (npm, pypi, …);
// PurlComponent uses component keys (name, namespace, …).
import { PurlType } from '../src/purl-type.mjs'
import type { PurlObject } from '../src/purl-type.mjs'

type PurlTypeHelpers = Record<
  string,
  {
    readonly validate: (purl: PurlObject, throws: boolean) => boolean
    readonly normalize: (purl: PurlObject) => PurlObject
  }
>
const PurlTypeT = PurlType as unknown as PurlTypeHelpers

// Then everywhere:
PurlTypeT['npm']!.validate(comp, false)
```

The cost is one block of declaration prose at the import site; the payoff is every call site type-checks without `any`.
