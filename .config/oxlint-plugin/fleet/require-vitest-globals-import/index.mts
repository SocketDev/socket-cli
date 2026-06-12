/**
 * @file In a `*.test.*` file, a vitest global (`describe` / `it` / `test` /
 *   `expect` / `beforeAll` / `beforeEach` / `afterAll` / `afterEach`) that is
 *   CALLED but never imported from `'vitest'` is an error. The fleet runs
 *   vitest with `globals: false` (.config/repo/vitest.config.mts), so an
 *   un-imported global is `undefined` at runtime — the file errors at
 *   COLLECTION ("X is not defined") and the whole suite never runs. This is a
 *   silent, total failure: the test file looks present but contributes zero
 *   assertions. Why a rule: a fleet sweep found 95 test files in one repo
 *   broken exactly this way (a `globals: true → false` migration that didn't
 *   update test imports). The fix is mechanical (add the import), but nothing
 *   stopped the next one — so this gate fails CI/editor the moment a test uses
 *   a vitest global it didn't import. Scope: `*.test.*`. Stands down when the
 *   file imports from `node:test` (it's a node:test file, not vitest —
 *   `globals` doesn't apply). Reports once per distinct missing global. Built
 *   on lib/vitest-fn-call.mts, whose `fromVitestImport` set is the
 *   authoritative "actually imported from vitest" signal.
 */

import { TEST_FILE_RE } from '../../lib/test-file.mts'
import {
  classifyVitestCall,
  collectVitestNames,
} from '../../lib/vitest-fn-call.mts'

import type { AstNode, RuleContext } from '../../lib/rule-types.mts'

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'In a *.test.* file (vitest globals:false), a vitest global called without importing it from `vitest` is undefined at runtime — the file errors at collection and the suite never runs.',
      category: 'Possible Errors',
      recommended: true,
    },
    messages: {
      missingImport:
        "`{{name}}` is a vitest global used here but never imported. Fleet vitest is `globals: false`, so this is `undefined` at runtime — the file errors at collection and NEVER runs. Add it to `import { … } from 'vitest'`.",
    },
    schema: [],
  },

  create(context: RuleContext) {
    const filename = context.filename ?? context.getFilename?.() ?? ''
    if (!TEST_FILE_RE.test(filename)) {
      return {}
    }
    let fromVitestImport: Set<string> | undefined
    let importedNames: Set<string> | undefined
    let names: Map<string, string> | undefined
    let importsNodeTest = false
    // Report each missing global at most once (per local name).
    const reported = new Set<string>()

    return {
      Program(program: AstNode) {
        const collected = collectVitestNames(program)
        names = collected.names
        fromVitestImport = collected.fromVitestImport
        importedNames = collected.importedNames
        importsNodeTest = collected.importsNodeTest
      },
      CallExpression(node: AstNode) {
        // node:test files use the node runner — `globals` is a vitest concept
        // and doesn't apply; stand down.
        if (importsNodeTest || !names || !fromVitestImport || !importedNames) {
          return
        }
        const call = classifyVitestCall(node, names)
        if (!call) {
          return
        }
        // The local binding name written at the call site (root of the chain).
        const localName = call.localChain[0]
        if (!localName || reported.has(localName)) {
          return
        }
        // Imported from vitest → fine. Imported from ANY OTHER module (a custom
        // wrapper like `describeNetworkOnly` from `./util/skip-helpers`, which
        // the classifier's camelCase heuristic flags as a describe call) → also
        // fine; it's a real binding, not an unimported global. Only a name that
        // is neither vitest-imported NOR otherwise import-bound is the
        // globals:false bug (used but undefined at runtime). A bare `describe()`
        // with no import is still caught — it's in neither set.
        if (!fromVitestImport.has(localName) && !importedNames.has(localName)) {
          reported.add(localName)
          context.report({
            node,
            messageId: 'missingImport',
            data: { name: localName },
          })
        }
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
