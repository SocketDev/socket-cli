# Runtime feature floors

The `socket/no-runtime-features-below-engine-floor` lint rule blocks modern
runtime built-ins in repos whose `engines.node` floor predates the Node major
that first shipped them. Below that floor the feature throws
`TypeError: … is not a function` at runtime — a hazard a type-checker targeting
a newer lib won't catch. The rule is engine-aware: it reads `engines.node` from
the nearest `package.json` and fires per feature only when the floor is below
that feature's major. Repos with no `engines` field are treated as evergreen
(everything allowed). Coverage spans ES2023–2026 (the rule grew out of an
ES2023-array-only check, hence the feature columns below).

## Feature → first Node major

| Feature                         | ECMAScript | First Node major | Match shape                    |
| ------------------------------- | ---------- | ---------------- | ------------------------------ |
| `Array.prototype.toReversed`    | ES2023     | 20               | `x.toReversed(…)`              |
| `Array.prototype.toSorted`      | ES2023     | 20               | `x.toSorted(…)`                |
| `Array.prototype.toSpliced`     | ES2023     | 20               | `x.toSpliced(…)`               |
| `Array.prototype.with`          | ES2023     | 20               | `x.with(…)` (method call only) |
| `Array.prototype.findLast`      | ES2023     | 20               | `x.findLast(…)`                |
| `Array.prototype.findLastIndex` | ES2023     | 20               | `x.findLastIndex(…)`           |
| `Object.groupBy`                | ES2024     | 21               | `Object.groupBy(…)`            |
| `Map.groupBy`                   | ES2024     | 21               | `Map.groupBy(…)`               |
| `Promise.withResolvers`         | ES2024     | 22               | `Promise.withResolvers(…)`     |
| `Array.fromAsync`               | ES2026     | 22               | `Array.fromAsync(…)`           |

Static methods match only when the object is the exact global identifier
(`Object` / `Map` / `Promise` / `Array`), so a local `promise.withResolvers()`
won't false-fire.

## Safe rewrites

- Array copy quartet → copy + in-place op: `[...arr].reverse()` / `.sort()` /
  `.splice()`, or index-assign on a clone.
- `findLast` / `findLastIndex` → reverse-iterate, or a manual loop from the end.
- `Object.groupBy` / `Map.groupBy` → a `reduce` / loop building the groups.
- `Promise.withResolvers` → the SDK's guarded `promiseWithResolvers` polyfill
  (`socket-sdk-js/src/utils.mts`), or a manual executor that captures
  `resolve`/`reject`.
- `Array.fromAsync` → a `for await … of` loop pushing into an array.

## Sources (verified 2026-06-11)

The mapping was looked up from, and should be re-verified against:

- **MDN browser-compat data** — each feature's "Browser compatibility" table
  has a `deno`/`nodejs` row with the first supporting Node version, e.g.
  `developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/fromAsync`.
- **Node.js release announcements** — `nodejs.org/en/blog/announcements` note
  the bundled V8 version per major; the V8 version that ships a feature pins the
  Node major.
- **node.green** — per-feature Node support matrix, used as a cross-check.

## When to re-check

- **The fleet's lowest `engines.node` floor rises.** When the lowest floor among
  fleet repos climbs past one of the majors above, that feature is universally
  safe and its entry can be dropped from the rule (one less thing to guard).
  Floors at the time of writing: socket-registry, socket-sdk-js,
  socket-packageurl-js, stuie, ultrathink sit on Node 18; most others are
  evergreen.
- **A new copy/static built-in is adopted.** When the fleet starts using another
  recent built-in — a future ES proposal, a new `Iterator.*` helper, etc. — add
  it to the table here and to `MEMBER_METHOD_MAJORS` / `STATIC_METHOD_MAJORS` in
  the rule, with a valid + invalid test arm.

## Where the rule lives

- Rule: `.config/fleet/oxlint-plugin/fleet/no-runtime-features-below-engine-floor/index.mts`
- Test: same dir under `test/`
- Activation: `.config/fleet/oxlintrc.json` (`"socket/no-runtime-features-below-engine-floor": "error"`)
