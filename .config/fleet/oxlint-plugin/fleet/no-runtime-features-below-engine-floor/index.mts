/**
 * @file Forbid modern runtime built-ins whose `engines.node` floor predates the
 *   Node major that first shipped them — below that floor they throw
 *   `TypeError: ... is not a function` at runtime, which a type-checker
 *   targeting a newer lib won't catch. ENGINE-AWARE, not a blanket ban: the
 *   rule walks up to the nearest `package.json`, reads `engines.node`, and
 *   fires per feature only when the declared floor is below that feature's Node
 *   major. No engines field means evergreen — everything allowed. Coverage
 *   spans ES2023–2026; the feature → Node-major table is mirrored in
 *   MEMBER_METHOD_MAJORS / STATIC_METHOD_MAJORS below. Sources, safe rewrites,
 *   and the recheck cadence (verified 2026-06-11):
 *   docs/agents.md/fleet/runtime-feature-floors.md.
 */

/**
 * @type {import('eslint').Rule.RuleModule}
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import type { AstNode, RuleContext } from '../../lib/rule-types.mts'

// Array.prototype methods matched as `x.<name>(...)`, mapped to the Node major
// that first shipped them and the exact copy-pasteable Node-floor-safe rewrite.
// The rewrites copy first (the spread), so the original is never mutated and
// behavior matches the non-mutating original — drop the spread only when the
// receiver is already a throwaway.
const MEMBER_METHOD_MAJORS = new Map<string, { major: number; fix: string }>([
  // ES2023 change-by-copy quartet.
  ['toReversed', { major: 20, fix: '`[...arr].reverse()`' }],
  ['toSorted', { major: 20, fix: '`[...arr].sort(cmp)`' }],
  [
    'toSpliced',
    {
      major: 20,
      fix: '`const copy = [...arr]; copy.splice(start, deleteCount, ...items)`',
    },
  ],
  ['with', { major: 20, fix: '`const copy = [...arr]; copy[index] = value`' }],
  // ES2023 find-from-end.
  ['findLast', { major: 20, fix: '`[...arr].reverse().find(fn)`' }],
  [
    'findLastIndex',
    {
      major: 20,
      fix: '`for (let i = arr.length - 1; i >= 0; i -= 1) { if (fn(arr[i])) { … } }`',
    },
  ],
])

// Static methods matched as `<Global>.<name>(...)`, mapped to (global object
// name, Node major, rewrite). Keyed by method name; the object identifier must
// match.
const STATIC_METHOD_MAJORS = new Map<
  string,
  { object: string; major: number; fix: string }
>([
  // ES2024 array grouping.
  [
    'groupBy',
    {
      object: 'Object',
      major: 21,
      fix: '`arr.reduce((acc, x) => { (acc[key(x)] ??= []).push(x); return acc }, {})`',
    },
  ],
  // Map.groupBy shares the `groupBy` name; resolved by the object check below.
  [
    'withResolvers',
    {
      object: 'Promise',
      major: 22,
      fix: 'a manual executor that captures resolve/reject (e.g. the SDK `promiseWithResolvers` helper)',
    },
  ],
  [
    'fromAsync',
    {
      object: 'Array',
      major: 22,
      fix: '`const out = []; for await (const x of iter) { out.push(x) }`',
    },
  ],
])

// Both Object.groupBy and Map.groupBy are ES2024 grouping helpers on the same
// Node-21 floor; the single STATIC_METHOD_MAJORS entry can't hold two objects,
// so grouping objects are listed here and checked first.
const GROUP_BY_OBJECTS = new Set(['Map', 'Object'])
const GROUP_BY_MAJOR = 21
const GROUP_BY_FIX =
  '`arr.reduce((acc, x) => { (acc[key(x)] ??= []).push(x); return acc }, {})`'

// Per-directory cache: directory → engines.node floor major (or undefined when
// none found / evergreen). Keyed by the directory walked up from a file, so
// repeated files in the same package don't re-read disk.
const floorCache = new Map<string, number | undefined>()

// The leading major version in a semver range string, or undefined when none
// parses. `>=18`, `>= 18.20.8`, `^18.0.0`, `18 || 20` → 18.
export function parseNodeFloorMajor(range: string): number | undefined {
  const m = /(?<major>\d+)/.exec(range)
  if (!m) {
    return undefined
  }
  /* c8 ignore start - m.groups is always defined when exec() matches a named-group pattern; \d+ always produces an integer */
  const n = Number(m.groups?.['major'])
  return Number.isInteger(n) ? n : undefined
  /* c8 ignore stop */
}

// Walk up from `fromDir` to the nearest package.json; return its engines.node
// floor major, or undefined when no package.json / no engines.node is found.
export function nearestEnginesNodeFloor(fromDir: string): number | undefined {
  let dir = fromDir
  // Bounded walk to the filesystem root.
  for (let i = 0; i < 64; i += 1) {
    const pkgPath = path.join(dir, 'package.json')
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
          engines?: { node?: unknown | undefined } | undefined
        }
        const node = pkg.engines?.node
        if (typeof node === 'string') {
          return parseNodeFloorMajor(node)
        }
      } catch {
        // Unreadable / malformed package.json — keep walking up.
      }
    }
    const parent = path.dirname(dir)
    if (parent === dir) {
      break
    }
    dir = parent
  }
  return undefined
}

// The engines.node floor major for the file at `filename`, or undefined when no
// engines field is found (assumed evergreen → every feature allowed).
export function floorMajorFor(filename: string): number | undefined {
  const dir = path.dirname(filename)
  if (floorCache.has(dir)) {
    return floorCache.get(dir)
  }
  const floor = nearestEnginesNodeFloor(dir)
  floorCache.set(dir, floor)
  return floor
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid modern runtime built-ins (ES2023–2026 array copy/find methods, Object/Map.groupBy, Promise.withResolvers, Array.fromAsync) in repos whose engines.node floor is below the feature’s Node major.',
      category: 'Best Practices',
      recommended: true,
    },
    fixable: undefined,
    messages: {
      belowEngineFloor:
        '`{{name}}` requires Node {{major}}+, but this package declares `engines.node` below {{major}} — it throws at runtime on the supported floor. Rewrite as {{fix}} (no shim needed).',
    },
    schema: [],
  },

  create(context: RuleContext) {
    const filename = context.filename ?? context.getFilename?.() ?? ''
    if (!filename) {
      return {}
    }
    const floor = floorMajorFor(filename)
    // No engines field → assumed evergreen → nothing to flag.
    if (floor === undefined) {
      return {}
    }
    return {
      CallExpression(node: AstNode) {
        const callee = node.callee
        if (
          callee.type !== 'MemberExpression' ||
          callee.computed ||
          callee.property.type !== 'Identifier'
        ) {
          return
        }
        const name = callee.property.name
        // Member methods: `x.toSorted(...)`, `x.findLast(...)`, etc.
        const member = MEMBER_METHOD_MAJORS.get(name)
        if (member !== undefined) {
          if (floor < member.major) {
            context.report({
              node,
              messageId: 'belowEngineFloor',
              data: { name, major: String(member.major), fix: member.fix },
            })
          }
          return
        }
        // Static methods: only when the object is the exact global identifier.
        if (callee.object.type !== 'Identifier') {
          return
        }
        const objectName = callee.object.name
        // Object.groupBy / Map.groupBy share the `groupBy` name.
        if (name === 'groupBy' && GROUP_BY_OBJECTS.has(objectName)) {
          if (floor < GROUP_BY_MAJOR) {
            context.report({
              node,
              messageId: 'belowEngineFloor',
              data: {
                name: `${objectName}.groupBy`,
                major: String(GROUP_BY_MAJOR),
                fix: GROUP_BY_FIX,
              },
            })
          }
          return
        }
        const staticEntry = STATIC_METHOD_MAJORS.get(name)
        if (
          staticEntry !== undefined &&
          objectName === staticEntry.object &&
          floor < staticEntry.major
        ) {
          context.report({
            node,
            messageId: 'belowEngineFloor',
            data: {
              name: `${staticEntry.object}.${name}`,
              major: String(staticEntry.major),
              fix: staticEntry.fix,
            },
          })
        }
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
