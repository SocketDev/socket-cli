/*
 * @file Single source of truth for modern runtime built-ins and the Node major
 *   that first shipped each. Two consumers derive from this list:
 *     1. the `no-runtime-features-below-engine-floor` lint rule (which features
 *        to flag, at what floor, with what rewrite hint), and
 *     2. the es-polyfills parity test (the polyfill must install exactly this
 *        set — .claude/hooks/fleet/_shared/es-polyfills.mts).
 *   Keeping the table here means a new feature is added once, not in two places
 *   that silently drift. Node majors verified against ECMA-262 + node.green.
 */

export type RuntimeFeatureKind = 'member' | 'static'

export interface RuntimeFeatureFloor {
  // The method name as it appears in source (`x.toSorted()` → `toSorted`).
  readonly name: string
  // The Node major that first shipped it; below this the built-in is absent.
  readonly major: number
  // `member` → prototype method matched on any receiver by name; `static` →
  // matched as `<object>.<name>(...)`.
  readonly kind: RuntimeFeatureKind
  // Required when kind is `static`: the global the method hangs off.
  readonly object?: string
  // Copy-pasteable Node-floor-safe rewrite, shown in the lint message.
  readonly fix: string
}

// Sorted by name, then object (ASCII byte order).
export const RUNTIME_FEATURE_FLOORS: readonly RuntimeFeatureFloor[] = [
  {
    name: 'findLast',
    major: 18,
    kind: 'member',
    fix: '`[...arr].reverse().find(fn)`',
  },
  {
    name: 'findLastIndex',
    major: 18,
    kind: 'member',
    fix: '`for (let i = arr.length - 1; i >= 0; i -= 1) { if (fn(arr[i])) { … } }`',
  },
  {
    name: 'fromAsync',
    major: 22,
    kind: 'static',
    object: 'Array',
    fix: '`const out = []; for await (const x of iter) { out.push(x) }`',
  },
  {
    name: 'groupBy',
    major: 21,
    kind: 'static',
    object: 'Map',
    fix: '`const m = new Map(); for (const x of arr) { const k = key(x); (m.get(k) ?? m.set(k, []).get(k)).push(x) }`',
  },
  {
    name: 'groupBy',
    major: 21,
    kind: 'static',
    object: 'Object',
    fix: '`arr.reduce((acc, x) => { (acc[key(x)] ??= []).push(x); return acc }, {})`',
  },
  {
    name: 'isWellFormed',
    major: 20,
    kind: 'member',
    fix: 'a manual lone-surrogate scan, or normalize upstream',
  },
  {
    name: 'toReversed',
    major: 20,
    kind: 'member',
    fix: '`[...arr].reverse()`',
  },
  {
    name: 'toSorted',
    major: 20,
    kind: 'member',
    fix: '`[...arr].sort(cmp)`',
  },
  {
    name: 'toSpliced',
    major: 20,
    kind: 'member',
    fix: '`const copy = [...arr]; copy.splice(start, deleteCount, ...items)`',
  },
  {
    name: 'toWellFormed',
    major: 20,
    kind: 'member',
    fix: 'a manual lone-surrogate replacement, or normalize upstream',
  },
  {
    name: 'with',
    major: 20,
    kind: 'member',
    fix: '`const copy = [...arr]; copy[index] = value`',
  },
  {
    name: 'withResolvers',
    major: 22,
    kind: 'static',
    object: 'Promise',
    fix: 'a manual executor that captures resolve/reject',
  },
]

// The fully-qualified feature names the es-polyfills module must install. Derived
// from the table: member methods live on Array/String/TypedArray prototypes;
// change-by-copy members (toSorted/toReversed/with) are also TypedArray methods.
// The parity test asserts POLYFILLED_FEATURES equals this set.
export const EXPECTED_POLYFILL_FEATURES: readonly string[] = (() => {
  const names = new Set<string>()
  const typedArrayCopyMembers = new Set(['toReversed', 'toSorted', 'with'])
  const stringMembers = new Set(['isWellFormed', 'toWellFormed'])
  for (const feature of RUNTIME_FEATURE_FLOORS) {
    if (feature.kind === 'static') {
      names.add(`${feature.object}.${feature.name}`)
      continue
    }
    if (stringMembers.has(feature.name)) {
      names.add(`String.prototype.${feature.name}`)
    } else {
      names.add(`Array.prototype.${feature.name}`)
    }
    if (typedArrayCopyMembers.has(feature.name)) {
      names.add(`TypedArray.prototype.${feature.name}`)
    }
  }
  return [...names].sort()
})()
