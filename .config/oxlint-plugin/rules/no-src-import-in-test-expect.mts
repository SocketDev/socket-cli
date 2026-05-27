/**
 * @file In a test file, a lib utility imported from the local `src/` tree must
 *   not be used as a TOOL inside `expect(...)` (to build the expected value).
 *   Doing so validates `src` against itself: if the utility has a bug, the API
 *   output AND the expected value are wrong the same way, so the assertion
 *   still passes and the bug hides. The system-under-test legitimately imports
 *   from `src/` — this rule does NOT object to that. It only fires when a
 *   `src/`-imported binding appears inside an `expect(...)` argument, where the
 *   trustworthy reference is the PUBLISHED snapshot via the `-stable` alias
 *   (`@socketsecurity/<pkg>-stable/<subpath>`). Concrete incident (socket-lib,
 *   2026-05-27): `dlx/detect.test.mts` imported `normalizePath` from
 *   `../../../src/paths/normalize` and used it as
 *   `expect(result.packageJsonPath).toBe(normalizePath(join(...)))`. The
 *   pre-existing `prefer-stable-self-import` rule missed it twice: it skips
 *   test files, and it only flags bare package-name imports, not relative
 *   `src/` paths. Scope: files matching `*.test.*`. A binding is flagged only
 *   when it (a) is imported from a relative specifier whose path lands under a
 *   `src/` segment, and (b) appears as an identifier inside an `expect(...)`
 *   call's arguments. Report-only — the `-stable` package name varies per repo,
 *   so the rewrite is left to the author (replace the relative `src/` path with
 *   `@socketsecurity/<pkg>-stable/<subpath>`).
 */

import type { AstNode, RuleContext } from '../lib/rule-types.mts'

const TEST_FILE_RE = /\.test\.(?:[mc]?[jt]s)$/

// A relative specifier that points into a `src/` tree: `./src/x`,
// `../src/x`, `../../../src/paths/normalize`, etc.
const SRC_RELATIVE_RE = /^\.\.?\/(?:[^'"]*\/)?src\//

// Does this CallExpression callee root back to the `expect` identifier?
// Covers `expect(x)`, `expect(x).toBe(...)`, `expect(x).not.toBe(...)`.
function calleeRootsAtExpect(callee: AstNode | undefined): boolean {
  let cur: AstNode | undefined = callee
  while (cur) {
    if (cur.type === 'Identifier') {
      return cur.name === 'expect'
    }
    if (cur.type === 'MemberExpression') {
      cur = cur.object
      continue
    }
    if (cur.type === 'CallExpression') {
      cur = cur.callee
      continue
    }
    return false
  }
  return false
}

// Collect every Identifier name used in a value position within `node`'s
// subtree. Skips non-computed member property names (`.foo`) and object
// literal keys, which aren't real references to a binding.
function collectValueIdentifiers(node: AstNode, out: Set<string>): void {
  if (!node || typeof node !== 'object') {
    return
  }
  if (Array.isArray(node)) {
    for (let i = 0, { length } = node; i < length; i += 1) {
      collectValueIdentifiers(node[i] as AstNode, out)
    }
    return
  }
  if (typeof node.type !== 'string') {
    return
  }
  if (node.type === 'Identifier') {
    out.add(node.name)
    return
  }
  for (const key of Object.keys(node)) {
    if (key === 'parent' || key === 'loc' || key === 'range') {
      continue
    }
    const child = (node as Record<string, unknown>)[key]
    // Skip the property name of a non-computed member access (`obj.foo`).
    if (
      node.type === 'MemberExpression' &&
      key === 'property' &&
      !node.computed
    ) {
      continue
    }
    // Skip object-literal keys (`{ foo: x }` — `foo` isn't a reference).
    if (node.type === 'Property' && key === 'key' && !node.computed) {
      continue
    }
    if (child && typeof child === 'object') {
      collectValueIdentifiers(child as AstNode, out)
    }
  }
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'In tests, a src/-imported utility used inside expect(...) must come from the -stable alias, not local src/ (else the test validates src against itself).',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      srcToolInExpect:
        '`{{name}}` is imported from local `src/` (`{{specifier}}`) and used inside `expect(...)`. A utility used to BUILD the expected value must come from the published snapshot — import it from the `@socketsecurity/<pkg>-stable/<subpath>` alias instead. Importing `src/` for the system-under-test is fine; this only applies to tools used in assertions.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    const filename = context.filename ?? context.getFilename?.() ?? ''
    if (!TEST_FILE_RE.test(filename)) {
      return {}
    }

    return {
      Program(program: AstNode) {
        // 1. Collect bindings imported from a relative `src/` specifier.
        const srcBindings = new Map<string, string>()
        const importNodes = new Map<string, AstNode>()
        for (const stmt of program.body) {
          if (
            stmt.type !== 'ImportDeclaration' ||
            stmt.source?.type !== 'Literal'
          ) {
            continue
          }
          const specifier = String(stmt.source.value)
          if (!SRC_RELATIVE_RE.test(specifier)) {
            continue
          }
          for (const spec of stmt.specifiers) {
            if (spec.local?.type === 'Identifier') {
              srcBindings.set(spec.local.name, specifier)
              importNodes.set(spec.local.name, stmt)
            }
          }
        }
        if (srcBindings.size === 0) {
          return
        }

        // 2. Find every expect(...) call, gather the identifiers used in
        //    its argument subtree, and flag any that resolve to a src
        //    binding. Report once per binding.
        const flagged = new Set<string>()
        const visit = (node: AstNode): void => {
          if (!node || typeof node !== 'object') {
            return
          }
          if (Array.isArray(node)) {
            for (let i = 0, { length } = node; i < length; i += 1) {
              visit(node[i] as AstNode)
            }
            return
          }
          if (typeof node.type !== 'string') {
            return
          }
          if (
            node.type === 'CallExpression' &&
            calleeRootsAtExpect(node.callee) &&
            Array.isArray(node.arguments)
          ) {
            const used = new Set<string>()
            for (let i = 0, { length } = node.arguments; i < length; i += 1) {
              collectValueIdentifiers(node.arguments[i] as AstNode, used)
            }
            for (const name of used) {
              if (srcBindings.has(name)) {
                flagged.add(name)
              }
            }
          }
          for (const key of Object.keys(node)) {
            if (key === 'parent' || key === 'loc' || key === 'range') {
              continue
            }
            const child = (node as Record<string, unknown>)[key]
            if (child && typeof child === 'object') {
              visit(child as AstNode)
            }
          }
        }
        visit(program)

        for (const name of flagged) {
          context.report({
            node: importNodes.get(name)!,
            messageId: 'srcToolInExpect',
            data: { name, specifier: srcBindings.get(name)! },
          })
        }
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
