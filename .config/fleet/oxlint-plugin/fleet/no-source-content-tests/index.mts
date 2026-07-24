/*
 * @file In a test file, reading another repo file's SOURCE TEXT and asserting
 *   on it with a containment-style expectation — `toContain` / `toMatch` /
 *   `assert.match` / `src.includes(...)` inside an assertion — tests wording,
 *   not behavior. A rename, a comment edit, or a mechanical refactor flips the
 *   verdict while behavior is unchanged; the test rots exactly like
 *   source-sniffing in checks (`socket/no-source-sniffing` covers that tier).
 *   The behavioral shape: import the module and assert on its exports, or
 *   spawn it and assert on its output. Scope is deliberately NARROW so the
 *   legitimate text checks stay silent:
 *
 *   - Fires only in `*.test.*` files. Marker checks under `scripts/fleet/check/*`
 *     are check scripts, out of scope by construction.
 *   - Fires only when the read path statically names a repo CODE file — a string
 *     literal that both lands under a repo source dir (`scripts/`, `src/`,
 *     `template/`, `.claude/`, `.config/`) and ends in a code extension. A
 *     fixture read (`test/fixtures/…`, `*.json`, `*.md`) or a file the test
 *     itself generated under a tmp dir never matches.
 *   - Fires only on containment assertions. Full-equality compares —
 *     `expect(templateText).toBe(liveText)` and friends — are how template==
 *     live parity tests byte-compare two reads; they stay silent. Report-only:
 *     the rewrite is structural (import + behavioral assertion), not a
 *     mechanical text fix.
 */

import { isTestFile } from '../../lib/test-file.mts'

import type { AstNode, RuleContext } from '../../lib/rule-types.mts'

// A repo CODE file named statically: a path segment anchored in a repo source
// dir AND a code extension. `test/fixtures/sample.mts` has no such anchor once
// joined from a fixtures constant; `package.json` / `*.md` fail the extension.
const REPO_SOURCE_FILE_RE =
  /(?:^|\/)(?:\.claude|\.config|scripts|src|template)\/[^'"`]*\.(?:[jt]sx?|[mc][jt]s)$/

// Read functions whose return value is the file's raw text.
const READ_FN_NAMES: ReadonlySet<string> = new Set(['readFile', 'readFileSync'])

// A tmp-dir signal in a read path: the test reads a file IT generated under a
// scratch dir, and asserting on generated output is behavioral. Matches
// `tmp()` / `tmpDir` / `mkdtempSync` / `os.tmpdir` / `scratch` identifiers; the
// trailing boundary keeps `template`/`templateDir` from matching `temp`.
const TMP_SIGNAL_RE =
  /(?:^|[-_.])(?:mkdtemp|scratch|tmpdir|tmp|temp)(?:$|[-_.0-9A-Z])/

// expect(...) matchers that assert CONTAINMENT of the text. Full-equality
// matchers (toBe / toEqual / toStrictEqual) are excluded on purpose — they are
// the parity byte-compare shape.
const CONTENT_MATCHERS: ReadonlySet<string> = new Set(['toContain', 'toMatch'])

// String methods that turn the text into a containment boolean/match inside an
// assertion argument.
const CONTENT_METHODS: ReadonlySet<string> = new Set([
  'includes',
  'match',
  'search',
])

// The callee name of a read call: `readFileSync(...)` or `fs.readFileSync(...)`
// / `fsp.readFile(...)`.
function readCalleeName(node: AstNode): string | undefined {
  if (node?.type !== 'CallExpression') {
    return undefined
  }
  const callee = node.callee
  if (callee?.type === 'Identifier') {
    return callee.name
  }
  if (
    callee?.type === 'MemberExpression' &&
    !callee.computed &&
    callee.property?.type === 'Identifier'
  ) {
    return callee.property.name
  }
  return undefined
}

// True when `node`'s subtree contains a string literal (or template quasi)
// naming a repo code file.
function subtreeNamesRepoSource(node: AstNode): boolean {
  let found = false
  walk(node, child => {
    if (found) {
      return
    }
    if (
      child.type === 'Literal' &&
      typeof child.value === 'string' &&
      REPO_SOURCE_FILE_RE.test(child.value)
    ) {
      found = true
      return
    }
    if (child.type === 'TemplateElement') {
      const cooked = child.value?.cooked
      if (typeof cooked === 'string' && REPO_SOURCE_FILE_RE.test(cooked)) {
        found = true
      }
    }
  })
  return found
}

// Generic ESTree walk: call `visit` on every node object in the subtree,
// skipping location/parent bookkeeping keys.
function walk(node: AstNode, visit: (node: AstNode) => void): void {
  if (!node || typeof node !== 'object') {
    return
  }
  if (Array.isArray(node)) {
    for (let i = 0, { length } = node; i < length; i += 1) {
      walk(node[i] as AstNode, visit)
    }
    return
  }
  if (typeof node.type !== 'string') {
    return
  }
  visit(node)
  const keyList = Object.keys(node)
  for (let i = 0, { length } = keyList; i < length; i += 1) {
    const key = keyList[i]!
    if (key === 'loc' || key === 'parent' || key === 'range') {
      continue
    }
    const child = (node as Record<string, unknown>)[key]
    if (child && typeof child === 'object') {
      walk(child as AstNode, visit)
    }
  }
}

// Unwrap `await expr` to `expr`.
function unwrapAwait(node: AstNode): AstNode {
  return node?.type === 'AwaitExpression' ? node.argument : node
}

// Does this CallExpression chain root back to the bare `expect` identifier?
// Covers `expect(x).toContain(...)` and `expect(x).not.toMatch(...)`.
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

// The matcher name of an `expect(...).<matcher>(...)` invocation, else
// undefined.
function matcherName(node: AstNode): string | undefined {
  if (
    node.type === 'CallExpression' &&
    node.callee?.type === 'MemberExpression' &&
    !node.callee.computed &&
    node.callee.property?.type === 'Identifier'
  ) {
    return node.callee.property.name
  }
  return undefined
}

// The inner `expect(<actual>)` call of a matcher chain, else undefined.
function innerExpectCall(node: AstNode): AstNode | undefined {
  let cur: AstNode | undefined = node.callee
  while (cur) {
    if (
      cur.type === 'CallExpression' &&
      cur.callee?.type === 'Identifier' &&
      cur.callee.name === 'expect'
    ) {
      return cur
    }
    if (cur.type === 'MemberExpression') {
      cur = cur.object
      continue
    }
    if (cur.type === 'CallExpression') {
      cur = cur.callee
      continue
    }
    return undefined
  }
  return undefined
}

// Is this call `assert.match(...)` / `assert.ok(...)` / bare `assert(...)`?
function assertCallKind(node: AstNode): string | undefined {
  const callee = node.callee
  if (callee?.type === 'Identifier' && callee.name === 'assert') {
    return 'assert'
  }
  if (
    callee?.type === 'MemberExpression' &&
    !callee.computed &&
    callee.object?.type === 'Identifier' &&
    callee.object.name === 'assert' &&
    callee.property?.type === 'Identifier'
  ) {
    return callee.property.name
  }
  return undefined
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'In tests, do not assert on the raw source text of another repo file — import the module and assert on its behavior.',
      category: 'Best Practices',
      recommended: true,
    },
    fixable: undefined,
    messages: {
      sourceContentAssertion:
        'This asserts on the raw SOURCE TEXT of a repo file — a rename or comment edit flips the verdict with behavior unchanged. Import the module and assert on its exports, or spawn it and assert on its output. Full-equality parity byte-compares and scripts/fleet/check/* marker checks are the legitimate text checks.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    const filename = context.filename ?? context.getFilename?.() ?? ''
    if (!isTestFile(filename)) {
      return {}
    }

    return {
      Program(program: AstNode) {
        // 1. Every declarator, so a read via a path variable is traceable:
        //    `const P = path.join(here, '../scripts/x.mts')` →
        //    `readFileSync(P, 'utf8')`.
        const declInits = new Map<string, AstNode>()
        walk(program, node => {
          if (
            node.type === 'VariableDeclarator' &&
            node.id?.type === 'Identifier' &&
            node.init
          ) {
            declInits.set(node.id.name, node.init)
          }
        })

        // A tmp signal in the args, directly or through one declarator hop:
        // `path.join(dir, 'scripts/x.mts')` where `dir = tmp()` reads a file
        // the test generated, not the repo's source.
        const argsHaveTmpSignal = (args: AstNode): boolean => {
          let found = false
          walk(args, node => {
            if (found || node.type !== 'Identifier') {
              return
            }
            if (TMP_SIGNAL_RE.test(node.name)) {
              found = true
              return
            }
            const init = declInits.get(node.name)
            if (!init) {
              return
            }
            walk(init, inner => {
              if (
                inner.type === 'Identifier' &&
                TMP_SIGNAL_RE.test(inner.name)
              ) {
                found = true
              }
            })
          })
          return found
        }

        // A read call counts as a REPO-SOURCE read when its arguments name a
        // repo code file, directly or through one declarator hop, with no tmp
        // signal on the path.
        const argsNameRepoSource = (args: AstNode): boolean => {
          if (argsHaveTmpSignal(args)) {
            return false
          }
          if (subtreeNamesRepoSource(args)) {
            return true
          }
          let found = false
          walk(args, node => {
            if (found || node.type !== 'Identifier') {
              return
            }
            const init = declInits.get(node.name)
            if (init && subtreeNamesRepoSource(init)) {
              found = true
            }
          })
          return found
        }

        const isSourceReadCall = (node: AstNode): boolean => {
          const unwrapped = unwrapAwait(node)
          const name = readCalleeName(unwrapped)
          if (name === undefined || !READ_FN_NAMES.has(name)) {
            return false
          }
          return argsNameRepoSource(unwrapped.arguments ?? [])
        }

        // 2. Bindings holding repo-source text.
        const sourceTextBindings = new Set<string>()
        for (const [name, init] of declInits) {
          if (isSourceReadCall(init)) {
            sourceTextBindings.add(name)
          }
        }

        const holdsSourceText = (node: AstNode): boolean => {
          const unwrapped = unwrapAwait(node)
          if (
            unwrapped?.type === 'Identifier' &&
            sourceTextBindings.has(unwrapped.name)
          ) {
            return true
          }
          return unwrapped ? isSourceReadCall(unwrapped) : false
        }

        // A containment probe on source text somewhere in an assertion
        // argument: `src.includes('x')`, `src.match(/x/)`, `/x/.test(src)`.
        const subtreeProbesSourceText = (args: AstNode): boolean => {
          let found = false
          walk(args, node => {
            if (found || node.type !== 'CallExpression') {
              return
            }
            const callee = node.callee
            if (
              callee?.type !== 'MemberExpression' ||
              callee.computed ||
              callee.property?.type !== 'Identifier'
            ) {
              return
            }
            const method = callee.property.name
            if (CONTENT_METHODS.has(method) && holdsSourceText(callee.object)) {
              found = true
              return
            }
            if (
              method === 'test' &&
              (callee.object?.type === 'Literal' ||
                callee.object?.type === 'NewExpression') &&
              holdsSourceText(node.arguments?.[0])
            ) {
              found = true
            }
          })
          return found
        }

        // 3. The assertion shapes.
        walk(program, node => {
          if (node.type !== 'CallExpression') {
            return
          }
          // expect(src).toContain('x') / expect(src).not.toMatch(/x/)
          if (calleeRootsAtExpect(node.callee)) {
            const matcher = matcherName(node)
            if (matcher !== undefined && CONTENT_MATCHERS.has(matcher)) {
              const inner = innerExpectCall(node)
              if (inner && holdsSourceText(inner.arguments?.[0])) {
                context.report({
                  node,
                  messageId: 'sourceContentAssertion',
                })
                return
              }
            }
            // expect(src.includes('x')).toBe(true) — the probe hides in the
            // expect ACTUAL argument. Report at the bare inner expect(...)
            // call, which the walk always visits, so one construct reports
            // once.
            if (
              node.callee?.type === 'Identifier' &&
              node.callee.name === 'expect' &&
              subtreeProbesSourceText(node.arguments ?? [])
            ) {
              context.report({ node, messageId: 'sourceContentAssertion' })
            }
            return
          }
          // assert.match(src, /x/) / assert.ok(src.includes('x')) /
          // assert(src.includes('x'))
          const kind = assertCallKind(node)
          if (kind === undefined) {
            return
          }
          if (
            (kind === 'doesNotMatch' || kind === 'match') &&
            holdsSourceText(node.arguments?.[0])
          ) {
            context.report({ node, messageId: 'sourceContentAssertion' })
            return
          }
          if (subtreeProbesSourceText(node.arguments ?? [])) {
            context.report({ node, messageId: 'sourceContentAssertion' })
          }
        })
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
