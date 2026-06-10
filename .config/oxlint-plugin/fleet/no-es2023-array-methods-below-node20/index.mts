/**
 * @file Forbid the ES2023 copying Array methods — `toReversed`, `toSorted`,
 *   `toSpliced`, and `with` — in repos whose `engines.node` floor predates Node
 *   20 (where these landed). The methods are only safe once the minimum
 *   supported runtime has them; on Node 18 they throw `TypeError: ... is not a
 *   function` at runtime, which a type-checker targeting a newer lib will not
 *   catch. This is ENGINE-AWARE, not a blanket ban: the rule walks up from the
 *   file to the nearest `package.json`, reads `engines.node`, and only fires
 *   when the declared floor is below Node 20. A repo on `engines.node >= 22`
 *   (or with no engines field — assumed evergreen) may use these methods
 *   freely, so the one fleet rule serves both the Node-18 repos
 *   (socket-registry, socket-sdk-js, socket-packageurl-js, stuie, ultrathink at
 *   the time of writing) and the evergreen ones without false-blocking either.
 *   Only the `Array.prototype` copying quartet is covered. `with` is matched as
 *   a method call (`arr.with(...)`); a bare identifier `with` (the deprecated
 *   statement) is unrelated and never matched. No autofix — the safe rewrite
 *   (`[...arr].reverse()` / `.sort()` / `.splice()` / index-assign on a copy)
 *   depends on intent.
 */

/**
 * @type {import('eslint').Rule.RuleModule}
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import type { AstNode, RuleContext } from '../../lib/rule-types.mts'

const ES2023_ARRAY_METHODS = new Set([
  'toReversed',
  'toSorted',
  'toSpliced',
  'with',
])

// The Node major where the ES2023 copying Array methods became available.
const ES2023_NODE_MAJOR = 20

// Per-directory cache: directory → whether its package.json engines.node floor
// is below Node 20 (so the methods are unsafe). Keyed by the directory walked
// up from a file, so repeated files in the same package don't re-read disk.
const belowFloorCache = new Map<string, boolean>()

// The leading major version in a semver range string, or undefined when none
// parses. `>=18`, `>= 18.20.8`, `^18.0.0`, `18 || 20` → 18.
export function parseNodeFloorMajor(range: string): number | undefined {
  const m = /(\d+)/.exec(range)
  if (!m) {
    return undefined
  }
  const n = Number(m[1])
  return Number.isInteger(n) ? n : undefined
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
          engines?: { node?: unknown } | undefined
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

// Is the ES2023 quartet unsafe for the file at `filename`? True only when a
// package.json engines.node floor below Node 20 is found. No engines field
// (undefined) → assumed evergreen → false (allowed).
function methodsUnsafeFor(filename: string): boolean {
  const dir = path.dirname(filename)
  const cached = belowFloorCache.get(dir)
  if (cached !== undefined) {
    return cached
  }
  const floor = nearestEnginesNodeFloor(dir)
  const unsafe = floor !== undefined && floor < ES2023_NODE_MAJOR
  belowFloorCache.set(dir, unsafe)
  return unsafe
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid ES2023 copying Array methods (toReversed/toSorted/toSpliced/with) in repos whose engines.node floor is below Node 20.',
      category: 'Best Practices',
      recommended: true,
    },
    fixable: undefined,
    messages: {
      es2023ArrayMethod:
        '`Array.prototype.{{name}}` requires Node 20+, but this package declares `engines.node` below 20 — it throws at runtime on the supported floor. Use a copy + in-place op (`[...arr].reverse()` / `.sort()` / `.splice()`, or index-assign on a clone) instead.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    const filename = context.filename ?? context.getFilename?.() ?? ''
    if (!filename || !methodsUnsafeFor(filename)) {
      return {}
    }
    return {
      CallExpression(node: AstNode) {
        const callee = node.callee
        if (
          callee.type !== 'MemberExpression' ||
          callee.computed ||
          callee.property.type !== 'Identifier' ||
          !ES2023_ARRAY_METHODS.has(callee.property.name)
        ) {
          return
        }
        context.report({
          node,
          messageId: 'es2023ArrayMethod',
          data: { name: callee.property.name },
        })
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
