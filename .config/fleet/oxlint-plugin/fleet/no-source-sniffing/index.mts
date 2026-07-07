/**
 * @file Forbid SOURCE-SNIFFING — inferring what code DOES by pattern-matching
 *   its source TEXT, in a check / generator / lint rule / unit test. To know
 *   what a module does, IMPORT it and read its typed export (e.g. a
 *   `defineHook` instance's `.type` / `.event`), or parse its AST — never regex
 *   its source. Text sniffing rots: a refactor that keeps behavior but changes
 *   wording silently flips the verdict (the dispatch classifier once decided
 *   dispatch-vs-spawn by grepping `withBashGuard|runGuard` out of hook source).
 *   Flags, in a file under `scripts/`, `.config/fleet/oxlint-plugin/`, or a
 *   `*.test.*`, a regex/string scan of a value holding a code module's source —
 *   a variable named `source` or ending in `Source` (`hookFileSource`,
 *   `rawSource`): `<regex>.test(source)` / `.exec`, or
 *   `source.match(re)` / `.search` / `.includes(s)`. Fix: import the module +
 *   assert its typed export, or parse the AST — not its bytes. Deliberately
 *   narrow (no `src`/`code`/`contents`, no bare `readFileSync(...)`) so honest
 *   content checks ("does package.json contain X?") don't false-positive. No
 *   autofix (the rewrite is structural). Pairs with the import-based dispatch
 *   classifier + `hook-names-are-accurate`.
 */

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import type { AstNode, RuleContext } from '../../lib/rule-types.mts'

function isRegexLike(node: AstNode): boolean {
  if (!node) {
    return false
  }
  if (node.type === 'Literal' && node.regex) {
    return true
  }
  return node.type === 'NewExpression' && node.callee?.name === 'RegExp'
}

// A value that holds a code module's SOURCE TEXT: a variable named `source`, or
// one ending in `Source` (`hookFileSource`, `rawSource`, `moduleSource`).
// Deliberately NARROW — `src` / `code` / `contents` / `text` also name non-code
// data (an image src, an HTTP/error code, any file body), and a bare
// `readFileSync(...)` is just as often a legitimate content check (does
// package.json contain X?). Matching those would false-positive on honest data
// checks, and a false-positive error rule gets disabled. The import-based
// dispatch classifier + `hook-names-are-accurate` are the real enforcement;
// this rule catches the obvious regression — a `*Source` var grepped for a code
// idiom (the shape that decided dispatch-vs-spawn from hook source text).
function isSourceOperand(node: AstNode): boolean {
  return (
    node?.type === 'Identifier' &&
    (node.name === 'source' || node.name.endsWith('Source'))
  )
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Do not infer behavior by pattern-matching source text — import the module and read its typed export, or parse its AST.',
      category: 'Possible Errors',
      recommended: true,
    },
    fixable: undefined,
    messages: {
      sourceSniff:
        'Source-sniffing: this scans source/file TEXT to infer behavior, which rots when wording changes. Import the module and read its typed export (e.g. a defineHook instance) or parse its AST instead.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    const filename = normalizePath(
      context.filename ?? context.getFilename?.() ?? '',
    )
    // Only the surfaces that decide behavior: checks, generators, lint rules,
    // unit tests. A general text/source processor elsewhere is out of scope.
    if (
      !/\/scripts\//.test(filename) &&
      !/\/\.config\/oxlint-plugin\//.test(filename) &&
      !/\.test\.[mc]?[jt]s$/.test(filename)
    ) {
      return {}
    }
    return {
      CallExpression(node: AstNode) {
        const callee = node.callee
        if (callee?.type !== 'MemberExpression') {
          return
        }
        const method = callee.property?.name
        if (
          (method === 'exec' || method === 'test') &&
          isRegexLike(callee.object) &&
          isSourceOperand(node.arguments?.[0])
        ) {
          context.report({ node, messageId: 'sourceSniff' })
          return
        }
        if (
          (method === 'includes' ||
            method === 'match' ||
            method === 'search') &&
          isSourceOperand(callee.object)
        ) {
          context.report({ node, messageId: 'sourceSniff' })
        }
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
