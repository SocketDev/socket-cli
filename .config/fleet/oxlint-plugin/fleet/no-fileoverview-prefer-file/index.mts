/*
 * @file Flags a file-doc JSDoc block whose tag is `@fileoverview` and autofixes
 *   it to `@file`. Only the leading file-doc block comment (the first `/** ... *​/`
 *   before any code) is inspected. Inline `//` comments, string literals, and
 *   non-leading block comments are never touched, so a file that mentions
 *   `@fileoverview` as documentation data is not false-positive-flagged.
 *
 *   Why `@file`: the fleet writes `@file` uniformly; `@fileoverview` is a JSDoc
 *   alias that doc generators (e.g. TypeDoc) do not always recognise, so a
 *   file-doc tagged `@fileoverview` shows up with an empty description in
 *   generated API output.
 */

import type { AstNode, RuleContext, RuleFixer } from '../../lib/rule-types.mts'

// Matches a literal `@fileoverview` tag token in a block-comment body.
// The body does NOT include the surrounding `/*` and `*/` delimiters. The
// tag may be at the very start (after the opening `*` of a JSDoc block) or
// after whitespace / newline + `*` continuations. We capture only the exact
// token so the fixer can replace it without touching the rest of the comment.
const FILEOVERVIEW_TAG_RE = /@fileoverview\b/

const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Use `@file` instead of `@fileoverview` in the leading file-doc block comment.',
      category: 'Stylistic Issues',
      recommended: true,
    },
    fixable: 'code',
    messages: {
      preferFile:
        'File-doc tag is `@fileoverview` — rename it to `@file`. Doc generators recognise `@file`; `@fileoverview` is a non-standard alias that can produce empty descriptions in generated API output.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    const sourceCode = context.getSourceCode
      ? context.getSourceCode()
      : context.sourceCode
    return {
      Program(node: AstNode) {
        const comments: AstNode[] = sourceCode.getAllComments
          ? sourceCode.getAllComments()
          : []

        // Find the leading file-doc: the first Block comment in the file that
        // is a JSDoc block (body starts with `*`). "Leading" means it appears
        // before any statement — its end must be at or before the start of the
        // first program body node (if any).
        let fileDoc: AstNode | undefined
        const bodyNodes: AstNode[] =
          (node as { body?: AstNode[] | undefined }).body ?? []
        const firstCodeStart: number =
          bodyNodes.length > 0
            ? ((bodyNodes[0] as { range?: [number, number] | undefined })
                .range?.[0] ?? Infinity)
            : Infinity

        for (let i = 0, { length } = comments; i < length; i += 1) {
          const c = comments[i]!
          if (c.type !== 'Block') {
            continue
          }
          // JSDoc block: body (without delimiters) starts with `*`.
          const body: string = (c.value as string) ?? ''
          if (!body.startsWith('*')) {
            continue
          }
          // Must start before the first code statement.
          const commentStart: number =
            (c.range as [number, number] | undefined)?.[0] ?? Infinity
          if (commentStart < firstCodeStart) {
            fileDoc = c
          }
          // Only the very first JSDoc block qualifies; stop after the first
          // match regardless.
          break
        }

        if (!fileDoc) {
          return
        }

        /* c8 ignore start - fileDoc.value is always a string: the same value passed startsWith('*') at line 69 */
        const body: string = (fileDoc.value as string) ?? ''
        /* c8 ignore stop */
        if (!FILEOVERVIEW_TAG_RE.test(body)) {
          return
        }

        context.report({
          node: fileDoc,
          messageId: 'preferFile',
          fix(fixer: RuleFixer) {
            // Replace the full comment node. The comment value is the text
            // BETWEEN `/*` and `*/`, so rebuild with the fixed body.
            const fixedBody = body.replace(FILEOVERVIEW_TAG_RE, '@file')
            return fixer.replaceText(fileDoc, `/*${fixedBody}*/`)
          },
        })
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
