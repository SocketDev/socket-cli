/**
 * @file Require a module-scope entry guard to run its async `main()` via an
 *   async IIFE, never bare `await main()` or a floating `void main()` /
 *   `main()`. The fleet entry-guard idiom is `if
 *   (process.argv[1]?.endsWith('…')) { … }`. When the body runs an async
 *   function there are three shapes: await main() // top-level await — CJS
 *   bundle can't (caught // by socket/no-top-level-await) void main() / main()
 *   // floats the promise: an unhandled rejection // is silent and exitCode
 *   timing is implicit void (async () => { await main() })() // correct — await
 *   inside the IIFE This rule catches the middle shape: a `void <asyncFn>()` or
 *   a bare `<asyncFn>()` expression-statement inside the entry guard, where
 *   `<asyncFn>` is a module-scope async function declaration. Report-only (the
 *   right rewrite wraps the call in an async IIFE; the author confirms
 *   intent).
 */

import type { AstNode, RuleContext } from '../../lib/rule-types.mts'

// The entry-guard test: `process.argv[1]?.endsWith(...)`. Optional chaining
// makes oxc/ESTree wrap the whole thing in a ChainExpression and/or set
// `optional: true` on the member/call, and `import.meta.url` variants also
// exist — so rather than match one rigid shape, detect a `.endsWith(...)` call
// anywhere in the test whose member object references `argv` or `import`. Robust
// to the optional-chain flavor the parser emits.
function memberPropName(node: AstNode): string | undefined {
  return node?.property?.name
}

function isEntryGuardTest(test: AstNode): boolean {
  // Unwrap a ChainExpression (optional chaining) to its inner expression.
  let expr = test
  if (expr?.type === 'ChainExpression') {
    expr = expr.expression
  }
  if (
    !expr ||
    (expr.type !== 'CallExpression' && expr.type !== 'OptionalCallExpression')
  ) {
    return false
  }
  const callee = expr.callee
  if (memberPropName(callee) !== 'endsWith') {
    return false
  }
  // Confirm the receiver chain mentions `argv` (process.argv[1]) or `import`
  // (import.meta.url) — the two canonical entry anchors. Walk the object chain.
  let obj = callee.object
  for (let depth = 0; obj && depth < 6; depth += 1) {
    if (
      obj.type === 'Identifier' &&
      (obj.name === 'argv' || obj.name === 'process')
    ) {
      return true
    }
    if (obj.type === 'MetaProperty') {
      return true
    }
    obj = obj.object ?? obj.expression
  }
  return false
}

// The async-function names declared at module scope.
function collectAsyncFnNames(programBody: AstNode[]): Set<string> {
  const names = new Set<string>()
  for (let i = 0, { length } = programBody; i < length; i += 1) {
    const node = programBody[i]!
    if (node.type === 'FunctionDeclaration' && node.async && node.id) {
      names.add(node.id.name)
    }
    // `const main = async () => {}` / `async function`
    if (node.type === 'VariableDeclaration') {
      for (let j = 0, { length: dl } = node.declarations; j < dl; j += 1) {
        const decl = node.declarations[j]!
        if (
          decl.id?.name &&
          decl.init &&
          (decl.init.type === 'ArrowFunctionExpression' ||
            decl.init.type === 'FunctionExpression') &&
          decl.init.async
        ) {
          names.add(decl.id.name)
        }
      }
    }
  }
  return names
}

// How an entry-guard statement (wrongly) invokes its async fn.
//   'await'    — `await main()` (top-level await; also caught by
//                no-top-level-await, but we give the specific IIFE fix here)
//   'floating' — `void main()` or bare `main()` (drops the promise)
// A correct `void (async () => { await main() })()` returns undefined (the
// callee is a function expression, not the named async fn).
export interface EntryCall {
  name: string
  form: 'await' | 'floating'
}

export function entryCall(stmt: AstNode): EntryCall | undefined {
  if (!stmt || stmt.type !== 'ExpressionStatement') {
    return undefined
  }
  let expr = stmt.expression
  let form: EntryCall['form'] = 'floating'
  // `void f()` -> unwrap the UnaryExpression (still floating).
  if (expr?.type === 'UnaryExpression' && expr.operator === 'void') {
    expr = expr.argument
  } else if (expr?.type === 'AwaitExpression') {
    // `await f()` -> top-level await form.
    form = 'await'
    expr = expr.argument
  }
  if (!expr || expr.type !== 'CallExpression') {
    return undefined
  }
  const callee = expr.callee
  if (!callee || callee.type !== 'Identifier') {
    return undefined
  }
  return { name: callee.name, form }
}

/**
 * @type {import('eslint').Rule.RuleModule}
 */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require a module-scope async entry guard to await main() via an async IIFE, not a floating void main() / main().',
      category: 'Possible Errors',
      recommended: true,
    },
    fixable: undefined,
    messages: {
      floating:
        'Entry-guard `{{name}}()` floats an async promise (an unhandled rejection is silent, exitCode timing is implicit). Wrap it: `void (async () => { await {{name}}() })()`.',
      awaited:
        'Entry-guard `await {{name}}()` is top-level await (the CJS bundle target forbids it). Wrap it: `void (async () => { await {{name}}() })()`.',
    },
    schema: [],
  },
  create(context: RuleContext) {
    return {
      Program(program: AstNode) {
        const body = program.body ?? []
        const asyncNames = collectAsyncFnNames(body)
        if (asyncNames.size === 0) {
          return
        }
        for (let i = 0, { length } = body; i < length; i += 1) {
          const node = body[i]!
          if (node.type !== 'IfStatement' || !isEntryGuardTest(node.test)) {
            continue
          }
          const guardBody =
            node.consequent?.type === 'BlockStatement'
              ? (node.consequent.body ?? [])
              : node.consequent
                ? [node.consequent]
                : []
          for (let j = 0, { length: gl } = guardBody; j < gl; j += 1) {
            const call = entryCall(guardBody[j]!)
            if (call && asyncNames.has(call.name)) {
              context.report({
                node: guardBody[j]!,
                messageId: call.form === 'await' ? 'awaited' : 'floating',
                data: { name: call.name },
              })
            }
          }
        }
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
