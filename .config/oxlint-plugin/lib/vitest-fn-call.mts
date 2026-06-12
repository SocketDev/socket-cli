/**
 * @file Shared classifier for vitest test/hook/expect calls, used by the fleet
 *   `socket/no-vitest-*` guardrail rules. A lean adaptation of
 *   `@vitest/eslint-plugin`'s `parse-vitest-fn-call.ts` (612 lines, heavy on
 *   the TS type checker + scope analysis) tailored to how the fleet actually
 *   writes tests: globals are OFF everywhere (`globals: false` in every vitest
 *   config), so a bare `it` / `describe` / `expect` is a vitest call ONLY when
 *   imported from `'vitest'`. That collapses upstream's scope walk into a
 *   single import-binding pass. Callers run inside `*.test.*` files. Vocabulary
 *   (mirrors upstream `types.ts`):
 *
 *   - test-case names: it, test, fit, xit, xtest, bench
 *   - describe names: describe, fdescribe, xdescribe
 *   - hook names: beforeAll, beforeEach, afterAll, afterEach
 *   - modifiers chained after a test/describe: only, skip, todo, concurrent,
 *     sequential, each, fails, skipIf, runIf, for `getVitestCallChain(callNode,
 *     names)` returns the dotted member chain rooted at a known vitest binding
 *     (e.g. `['it','skip']`, `['describe','each']`, `['expect']`) or undefined.
 *     `collectVitestNames(program)` builds the set of local binding names that
 *     resolve to a vitest import (plus the always-known globals as a fallback
 *     so a globals-on fixture still classifies).
 */

import type { AstNode } from './rule-types.mts'

export const TEST_CASE_NAMES: ReadonlySet<string> = new Set([
  'bench',
  'fit',
  'it',
  'test',
  'xit',
  'xtest',
])

export const DESCRIBE_NAMES: ReadonlySet<string> = new Set([
  'describe',
  'fdescribe',
  'xdescribe',
])

export const HOOK_NAMES: ReadonlySet<string> = new Set([
  'afterAll',
  'afterEach',
  'beforeAll',
  'beforeEach',
])

// Modifiers that may chain after a test-case or describe binding:
// `it.skip`, `describe.each`, `it.skipIf(...)`, `test.concurrent.each`.
export const MODIFIER_NAMES: ReadonlySet<string> = new Set([
  'concurrent',
  'each',
  'fails',
  'for',
  'only',
  'runIf',
  'sequential',
  'skip',
  'skipIf',
  'todo',
])

// Names that the fleet's globals-off configs would NOT make available without
// an import, but which are still unambiguous test/hook/expect roots — kept as a
// fallback so a globals-on fixture (or a stray) still classifies.
//
// Trade-off: seeding these as always-known means a LOCAL binding that shadows a
// vitest name (`const it = somethingElse`) is still classified as vitest. In
// the fleet this is a non-issue — `it`/`describe`/`expect` are always the vitest
// imports in `*.test.*` files — and catching a globals-on `it.only` is worth
// more than guarding against a shadowing that the fleet never writes.
const ALWAYS_KNOWN_ROOTS: ReadonlySet<string> = new Set([
  ...TEST_CASE_NAMES,
  ...DESCRIBE_NAMES,
  ...HOOK_NAMES,
  'expect',
])

// Result of scanning a program's imports for test-runner bindings.
export interface VitestNames {
  // Globals-tolerant map: local-name → imported vitest name, seeded with the
  // always-known roots so globals-on fixtures classify. Use for rules that are
  // correct regardless of runner (`.only` / `.skip` are wrong in any runner).
  names: Map<string, string>
  // STRICT set: local names that were actually imported from `'vitest'`. Use
  // for rules whose correctness depends on the runner being vitest specifically
  // (e.g. expect-expect: a `node:test` test asserts via `throw`, not `expect`).
  fromVitestImport: Set<string>
  // True when the file imports `it` / `test` / `describe` from `'node:test'` —
  // a signal that bare test calls are NOT vitest and runner-specific rules
  // should stand down.
  importsNodeTest: boolean
  // EVERY local name bound by an import in the file, regardless of source
  // module. A camelCase wrapper like `describeNetworkOnly` imported from
  // `'./util/skip-helpers'` classifies as a describe call (the wrapper
  // heuristic) but is NOT from `'vitest'`; without this set the
  // require-vitest-globals-import rule would falsely flag it as an unimported
  // global. A name in `importedNames` is a real binding, so it's never
  // "undefined at runtime".
  importedNames: Set<string>
}

const NODE_TEST_SPECIFIERS: ReadonlySet<string> = new Set([
  'node:test',
  'test',
  'test/reporters',
])

// Collect test-runner binding names. With globals off, `fromVitestImport` is the
// authoritative vitest set; `names` additionally unions the always-known roots
// so globals-on fixtures still classify for runner-agnostic rules. Handles
// `import { it as t }` aliasing.
export function collectVitestNames(program: AstNode): VitestNames {
  const names = new Map<string, string>()
  const fromVitestImport = new Set<string>()
  const importedNames = new Set<string>()
  let importsNodeTest = false
  // Seed the tolerant map with the always-known roots mapping to themselves.
  for (const root of ALWAYS_KNOWN_ROOTS) {
    names.set(root, root)
  }
  if (!program || !Array.isArray(program.body)) {
    return { fromVitestImport, importedNames, importsNodeTest, names }
  }
  for (let i = 0, { length } = program.body; i < length; i += 1) {
    const stmt = program.body[i] as AstNode
    if (
      stmt?.type !== 'ImportDeclaration' ||
      stmt.source?.type !== 'Literal' ||
      !Array.isArray(stmt.specifiers)
    ) {
      continue
    }
    // Record the local name of EVERY import specifier (named, default, or
    // namespace) from ANY module — a real binding is never an unimported
    // global, even when the wrapper heuristic classifies it as a test call.
    for (let j = 0, { length: slen } = stmt.specifiers; j < slen; j += 1) {
      const spec = stmt.specifiers[j] as AstNode
      if (spec?.local?.type === 'Identifier') {
        importedNames.add(spec.local.name)
      }
    }
    const specifier = String(stmt.source.value)
    if (NODE_TEST_SPECIFIERS.has(specifier)) {
      importsNodeTest = true
      continue
    }
    if (specifier !== 'vitest') {
      continue
    }
    for (let j = 0, { length: slen } = stmt.specifiers; j < slen; j += 1) {
      const spec = stmt.specifiers[j] as AstNode
      if (
        spec?.type === 'ImportSpecifier' &&
        spec.imported?.type === 'Identifier' &&
        spec.local?.type === 'Identifier'
      ) {
        names.set(spec.local.name, spec.imported.name)
        fromVitestImport.add(spec.local.name)
      }
    }
  }
  return { fromVitestImport, importedNames, importsNodeTest, names }
}

// Walk a CallExpression's callee to extract the dotted member chain, e.g.
// `it.skip(...)` → ['it','skip'], `describe.concurrent.each(...)` →
// ['describe','concurrent','each'], `expect(x)` → ['expect']. Returns undefined
// for computed/dynamic members. The first element is the ROOT binding name (the
// local name, which `names` maps back to the imported vitest name).
// True when a CallExpression has the genuine titled-test shape `name('title',
// fn)`: a string-literal (or template-literal) title followed by a function
// body. This is the shape every fleet test/describe wrapper is invoked with
// (`itWindowsOnly('x', () => {…})`, `describeUnixOnly('grp', () => {…})`). It is
// the discriminator that keeps the camelCase wrapper heuristic from mis-firing
// on a same-prefixed NON-test local: `testRequire('@npmcli/arborist')` (string
// arg, NO callback), `testServer(...)`, a `createRequire` result, etc. Those
// match `/^test[A-Z]/` by name but are not titled-test invocations, so they are
// rejected here.
export function isTitledCallWithBody(node: AstNode): boolean {
  const args = node?.arguments
  if (!Array.isArray(args) || args.length < 2) {
    return false
  }
  const title = args[0] as AstNode
  const titleIsString =
    (title?.type === 'Literal' && typeof title.value === 'string') ||
    title?.type === 'TemplateLiteral'
  if (!titleIsString) {
    return false
  }
  const body = args[1] as AstNode
  return (
    body?.type === 'FunctionExpression' ||
    body?.type === 'ArrowFunctionExpression'
  )
}

export function getCalleeChain(node: AstNode): string[] | undefined {
  if (node?.type !== 'CallExpression') {
    return undefined
  }
  const chain: string[] = []
  let cur: AstNode | undefined = node.callee
  while (cur) {
    if (cur.type === 'Identifier') {
      chain.unshift(cur.name)
      return chain
    }
    if (cur.type === 'MemberExpression') {
      if (cur.computed || cur.property?.type !== 'Identifier') {
        return undefined
      }
      chain.unshift(cur.property.name)
      cur = cur.object
      continue
    }
    if (cur.type === 'CallExpression') {
      // `it.each(table)(name, fn)` — the table call is one link; keep walking.
      cur = cur.callee
      continue
    }
    return undefined
  }
  return undefined
}

export interface VitestCall {
  // The original imported vitest name of the root (it/test/describe/expect/hook).
  root: string
  // The kind of call.
  kind: 'test' | 'describe' | 'hook' | 'expect'
  // Modifier names chained after the root, in source order (only/skip/each/…).
  modifiers: string[]
  // The dotted chain of local names as written (root first).
  localChain: string[]
}

// Classify a CallExpression as a vitest test/describe/hook/expect call, or
// undefined. `names` is from collectVitestNames(program).
export function classifyVitestCall(
  node: AstNode,
  names: Map<string, string>,
): VitestCall | undefined {
  const chain = getCalleeChain(node)
  if (!chain || !chain.length) {
    return undefined
  }
  const localRoot = chain[0]!
  const imported = names.get(localRoot)
  if (!imported) {
    // Custom test/describe wrappers: a fleet convention is to wrap
    // `it.skipIf(...)` / `describe.skipIf(...)` in a name-encoded helper
    // (`itWindowsOnly`, `itUnixOnly`, `itNetworkOnly`, `describeWindowsOnly`,
    // …) so the gate condition is static and greppable rather than an inline
    // boolean (see test/unit/util/skip-helpers). These aren't imported from
    // 'vitest', so the import-binding pass above misses them — but the
    // callback they take IS a real test/describe body, and an `expect` inside
    // it is NOT standalone. Recognize the `it<Upper>` / `test<Upper>` /
    // `describe<Upper>` camelCase shape as the corresponding kind.
    //
    // GUARD: only a DIRECT titled call with a function body — `name('t', fn)` —
    // is a wrapper invocation. `chain.length === 1` rejects a member chain
    // (`testFoo.bar(...)`), and `isTitledCallWithBody` rejects same-prefixed
    // NON-test locals invoked without a callback: `testRequire('pkg')` (a
    // `createRequire` result — string arg, no fn), `testServer(...)`, etc.
    // Without this guard those classify as `kind:'test'` and
    // require-vitest-globals-import flags them as unimported vitest globals — a
    // false positive, since they are ordinary user functions, not vitest.
    if (chain.length === 1 && isTitledCallWithBody(node)) {
      if (/^(?:it|test)[A-Z]/.test(localRoot)) {
        return {
          root: localRoot,
          kind: 'test',
          modifiers: chain.slice(1),
          localChain: chain,
        }
      }
      if (/^describe[A-Z]/.test(localRoot)) {
        return {
          root: localRoot,
          kind: 'describe',
          modifiers: chain.slice(1),
          localChain: chain,
        }
      }
    }
    return undefined
  }
  const modifiers = chain.slice(1)
  let kind: VitestCall['kind']
  if (TEST_CASE_NAMES.has(imported)) {
    kind = 'test'
  } else if (DESCRIBE_NAMES.has(imported)) {
    kind = 'describe'
  } else if (HOOK_NAMES.has(imported)) {
    kind = 'hook'
  } else if (imported === 'expect') {
    kind = 'expect'
  } else {
    return undefined
  }
  return { root: imported, kind, modifiers, localChain: chain }
}

// True when the call carries the given modifier anywhere in its chain
// (`it.skip`, `it.concurrent.skip`).
export function hasModifier(call: VitestCall, modifier: string): boolean {
  return call.modifiers.includes(modifier)
}
