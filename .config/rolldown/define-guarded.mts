/**
 * @file Guarded compile-time define for rolldown builds. A `transform` plugin
 *   that replaces global / property-accessor reads with constant values — like
 *   oxc's `transform.define`, but it ONLY rewrites read positions. Matches that
 *   sit in an assignment target, a `delete` / `++` / `--` operand, or a binding
 *   position are left untouched. Why this exists: oxc's `define` (and
 *   `@rollup/plugin-replace`, even with `preventAssignment`) substitutes
 *   `delete` operands, so `delete process.env.DEBUG` (debug's node.js `save()`)
 *   becomes `delete undefined` — a strict-mode SyntaxError. esbuild's `define`
 *   skipped both lvalue and delete positions; this restores that behavior so
 *   risky keys (`process.env.DEBUG`, …) stay safe to define. Uses rolldown's
 *   bundled oxc parser (`rolldown/parseAst`) for reliable AST spans +
 *   MagicString for surgical rewrites. When the consuming build opts into
 *   rolldown's `experimental.nativeMagicString`, the `transform` hook receives a
 *   native MagicString on `meta.magicString` (same API, Rust-backed, no JS
 *   sourcemap round-trip) — we use it when present and fall back to the
 *   `magic-string` npm package otherwise. Keys are dotted member chains
 *   (`process.env.X`) or bare identifiers; source may spell a member access
 *   with dot or quoted-bracket notation (`process.env.X`, `process.env['X']`,
 *   `process.env["X"]`) — all normalize to the same dotted key, since
 *   TypeScript forces quoted bracket access on index-signature types like
 *   `process.env`. Values are already-quoted source text (same contract as
 *   esbuild / oxc `define`).
 */

import MagicString from 'magic-string'
import { parseAst } from 'rolldown/parseAst'

import type { Plugin } from 'rolldown'

// oxc parser dialect, picked from a module's file extension. `parseAst`
// defaults to plain JS and rejects TypeScript syntax, so we must tell it the
// dialect or every `.ts`/`.tsx` module silently fails to parse (and the define
// is skipped). `.mts`/`.cts` are TS; `.tsx` keeps JSX; `.jsx`/`.mjs`/`.cjs`/`.js`
// are JS(X); anything unknown falls back to 'js'.
type OxcLang = 'js' | 'jsx' | 'ts' | 'tsx'

function langForId(id: string | undefined): OxcLang {
  // Strip any query suffix (e.g. `foo.ts?inline`) before reading the ext.
  const clean = (id ?? '').split('?')[0] ?? ''
  if (clean.endsWith('.tsx')) {
    return 'tsx'
  }
  if (clean.endsWith('.jsx')) {
    return 'jsx'
  }
  if (
    clean.endsWith('.ts') ||
    clean.endsWith('.mts') ||
    clean.endsWith('.cts')
  ) {
    return 'ts'
  }
  return 'js'
}

interface DefineEntry {
  // Dotted chain split into segments, e.g. ['process', 'env', 'DEBUG'] or
  // ['__DEV__'] for a bare identifier.
  segments: string[]
  value: string
}

function toEntries(define: Record<string, string>): DefineEntry[] {
  return Object.entries(define).map(([key, value]) => ({
    segments: key.split('.'),
    value,
  }))
}

// A match is a read unless its immediate parent uses it as a write/delete/
// binding target. parent.type + the key under which the node hangs identify
// the position unambiguously.
function isReadPosition(parentType: string, parentKey: string): boolean {
  // `x = …` / `x += …` — left side is a write target.
  if (parentType === 'AssignmentExpression' && parentKey === 'left') {
    return false
  }
  // `delete x` / `x++` / `--x` — operand is mutated, not read.
  if (
    (parentType === 'UnaryExpression' || parentType === 'UpdateExpression') &&
    parentKey === 'argument'
  ) {
    return false
  }
  // `{ x } = …` style binding / property shorthand targets.
  if (parentType === 'AssignmentTargetPropertyIdentifier') {
    return false
  }
  return true
}

// Read the property name off a member-expression node, normalizing the three
// equivalent spellings to a bare identifier string:
//   `obj.prop`          → StaticMemberExpression, property = Identifier
//   `obj['prop']`       → ComputedMemberExpression, property = string Literal
//   `obj["prop"]`       → ComputedMemberExpression, property = string Literal
// Returns undefined for anything else (e.g. `obj[expr]` dynamic access), which
// can't be a constant define target.
function memberPropName(node: Record<string, unknown>): string | undefined {
  const property = node['property'] as Record<string, unknown> | undefined
  if (!property) {
    return undefined
  }
  if (property['type'] === 'Identifier') {
    return property['name'] as string
  }
  // String-literal computed access (`obj['prop']` / `obj["prop"]`). oxc tags
  // the node `Literal` with a string `value`; a dynamic `obj[expr]` has a
  // non-Literal property and is correctly rejected here.
  if (property['type'] === 'Literal' && typeof property['value'] === 'string') {
    return property['value']
  }
  return undefined
}

/**
 * Match a member-expression / identifier node against a define entry's segments
 * by walking the chain structurally (right-to-left). Dot access and quoted
 * bracket access normalize to the same dotted key, so a single `process.env.X`
 * define key matches `process.env.X`, `process.env['X']`, and
 * `process.env["X"]` source alike — important because `process.env` is an
 * index-signature type and TypeScript (TS4111) forces quoted bracket access.
 */
function matchesChain(
  node: Record<string, unknown>,
  segments: string[],
): boolean {
  if (segments.length === 1) {
    return node['type'] === 'Identifier' && node['name'] === segments[0]
  }
  // Walk the member chain from the outermost property inward, matching each
  // segment from the tail. The innermost object must be an Identifier equal to
  // the first segment.
  let current: Record<string, unknown> | undefined = node
  for (let i = segments.length - 1; i >= 1; i -= 1) {
    if (
      !current ||
      (current['type'] !== 'StaticMemberExpression' &&
        current['type'] !== 'ComputedMemberExpression' &&
        current['type'] !== 'MemberExpression')
    ) {
      return false
    }
    if (memberPropName(current) !== segments[i]) {
      return false
    }
    current = current['object'] as Record<string, unknown> | undefined
  }
  return (
    !!current &&
    current['type'] === 'Identifier' &&
    current['name'] === segments[0]
  )
}

/**
 * Build a guarded-define rolldown plugin. `define` maps a key (bare identifier
 * or dotted property accessor) to already-quoted replacement source text.
 */
export function defineGuardedPlugin(define: Record<string, string>): Plugin {
  const entries = toEntries(define)
  // Top-level segment set lets us cheaply skip files that can't contain any
  // key before doing the full parse + walk.
  const firstSegments = new Set(entries.map(e => e.segments[0]!))

  return {
    name: 'define-guarded',
    // `meta` carries rolldown's native MagicString on `meta.magicString` when
    // the build opts into `experimental.nativeMagicString` (config-level, set by
    // the consuming repo). It's Rust-backed and serialized by rolldown without a
    // JS `toString()` / `generateMap()` round-trip. Absent that flag, `meta` is
    // undefined and we construct a JS `magic-string` instance ourselves.
    transform(code, id, meta) {
      // Cheap bail: no key's leading segment appears in the source.
      let maybe = false
      for (const seg of firstSegments) {
        if (code.includes(seg)) {
          maybe = true
          break
        }
      }
      if (!maybe) {
        return undefined
      }

      let program: Record<string, unknown>
      try {
        // Parse with the dialect matching the module's extension. The default
        // (JS) chokes on TypeScript type annotations, which would silently
        // disable the define for every .ts/.tsx consumer — `parseAst` would
        // throw and we'd fall through to the no-op `catch`. Derive `lang` from
        // the id so .ts/.mts/.cts → 'ts', .tsx → 'tsx', .jsx → 'jsx', else 'js'.
        program = parseAst(code, {
          lang: langForId(id),
        }) as unknown as Record<string, unknown>
      } catch {
        // Unparseable (e.g. a syntax oxc rejects) — leave the module to the
        // main pipeline, which will surface the real error.
        return undefined
      }

      // Prefer rolldown's native MagicString (experimental.nativeMagicString)
      // when the transform hook hands one over; same .overwrite()/.toString()
      // API as the npm package. Fall back to a JS instance otherwise.
      const native = (meta as { magicString?: MagicString } | undefined)
        ?.magicString
      const ms = native ?? new MagicString(code)
      let rewrote = false
      // Track [start,end] spans already rewritten so a parent member chain
      // and its `.object` sub-chain don't double-overwrite.
      const done = new Set<string>()

      const walk = (
        node: unknown,
        parent: Record<string, unknown> | undefined,
        key: string | undefined,
      ): void => {
        if (!node || typeof node !== 'object') {
          return
        }
        if (Array.isArray(node)) {
          for (const child of node) {
            walk(child, parent, key)
          }
          return
        }
        const n = node as Record<string, unknown>
        if (typeof n['type'] === 'string') {
          for (const entry of entries) {
            if (!matchesChain(n, entry.segments)) {
              continue
            }
            const start = n['start'] as number
            const end = n['end'] as number
            const spanKey = `${start}:${end}`
            if (done.has(spanKey)) {
              continue
            }
            if (!isReadPosition(parent?.['type'] as string, key ?? '')) {
              // Mark as done so we don't reconsider the same span; a guarded
              // write target stays verbatim.
              done.add(spanKey)
              continue
            }
            ms.overwrite(start, end, entry.value)
            done.add(spanKey)
            rewrote = true
            // Don't descend into a matched chain (its `.object` is part of
            // the same replaced text).
            return
          }
        }
        for (const k of Object.keys(n)) {
          if (k === 'start' || k === 'end') {
            continue
          }
          walk(n[k], n, k)
        }
      }

      walk(program, undefined, undefined)

      if (!rewrote) {
        return undefined
      }
      // Native path: hand the MagicString straight back — rolldown serializes
      // it + threads the sourcemap natively, skipping the JS toString/generateMap
      // round-trip. JS-fallback path: serialize + emit a hi-res sourcemap here.
      if (native) {
        return { code: ms as unknown as string }
      }
      return { code: ms.toString(), map: ms.generateMap({ hires: true }) }
    },
  }
}
