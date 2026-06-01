/**
 * @file Per fleet "Code style" rule: `<script defer>` / `<script async>` on
 *   inline (no-src) `<script>` tags is a spec no-op — the script runs
 *   immediately. The author intent (wait for DOMContentLoaded) is silently
 *   ignored. Past incident: same shape bit a fleet project twice; rendered
 *   pages went silently broken when the script tried to operate on DOM nodes
 *   that didn't exist yet. Sibling:
 *   `.claude/hooks/fleet/inline-script-defer-guard/` catches this at edit time.
 *   This lint rule catches it at commit time when edits happened outside
 *   Claude. Detects: string literals (single-quoted, double-quoted, or
 *   template) containing `<script ...defer...>` or `<script ...async...>`
 *   lacking `src=`. The rule applies to TS/JS source — HTML / template files
 *   aren't lint-target by oxlint. Autofix: remove the `defer` / `async`
 *   attribute. The DOMContentLoaded wrap is a manual fix surfaced in the error
 *   message.
 */

import { makeBypassChecker } from '../lib/comment-markers.mts'
import { isPluginSelfFile } from '../lib/fleet-paths.mts'
import type { AstNode, RuleContext, RuleFixer } from '../lib/rule-types.mts'

const SCRIPT_OPENER_RE = /<script\b([^>]*)>/gi

// socket-hook: allow inline-defer -- opt-out for a string that contains a
// `<script ...>` snippet as DATA (e.g. a hook's own diagnostic text describing
// the banned shape), not as real inline-script markup.
const BYPASS_RE = /socket-hook:\s*allow\s+inline-defer/

interface Match {
  /**
   * Full matched `<script ...>` opener.
   */
  readonly opener: string
  /**
   * The `defer` or `async` attribute name found.
   */
  readonly attr: 'defer' | 'async'
  /**
   * Offset of the matched opener within the string literal value.
   */
  readonly offset: number
}

function findInlineDeferOrAsync(text: string): Match | undefined {
  SCRIPT_OPENER_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = SCRIPT_OPENER_RE.exec(text)) !== null) {
    const attrs = m[1] ?? ''
    const attrMatch = /\b(async|defer)\b/i.exec(attrs)
    if (!attrMatch) {
      continue
    }
    if (/\bsrc\s*=/.test(attrs)) {
      continue
    }
    return {
      opener: m[0],
      attr: attrMatch[1]!.toLowerCase() as 'defer' | 'async',
      offset: m.index,
    }
  }
  return undefined
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        '`<script defer>` / `<script async>` on inline (no-src) scripts is a spec no-op. Wrap in DOMContentLoaded or move to an external file.',
      category: 'Possible Errors',
      recommended: true,
    },
    fixable: 'code',
    messages: {
      inlineDeferAsync:
        '`<script {{attr}}>` lacks `src=` — `{{attr}}` is a no-op on inline scripts (spec says ignore). The script runs IMMEDIATELY, not on DOMContentLoaded. Wrap the body in `document.addEventListener("DOMContentLoaded", () => {...})`, or move to an external file with `<script {{attr}} src="...">`.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    // The rule's own source + fixtures contain `<script defer>` as data.
    if (isPluginSelfFile(context)) {
      return {}
    }
    const sourceCode = context.getSourceCode
      ? context.getSourceCode()
      : context.sourceCode
    const hasBypassComment = makeBypassChecker(context, BYPASS_RE)

    function checkLiteralText(
      node: AstNode,
      text: string,
      // Start of the inner content (excluding surrounding quote) in the
      // source. Used to align the autofix range.
      innerStart: number,
    ): void {
      const found = findInlineDeferOrAsync(text)
      if (!found) {
        return
      }
      if (hasBypassComment(node)) {
        return
      }

      context.report({
        node,
        messageId: 'inlineDeferAsync',
        data: { attr: found.attr },
        fix(fixer: RuleFixer) {
          // Locate the attribute within the source and strip it.
          // attribute appears as ` defer` (with leading space) or `defer ` —
          // find the simplest occurrence within the opener span and remove
          // it + one leading whitespace if present.
          const openerStart = innerStart + found.offset
          const openerSrcEnd = openerStart + found.opener.length
          const openerSrc = sourceCode
            .getText()
            .slice(openerStart, openerSrcEnd)
          const attrRe = new RegExp(
            `\\s+${found.attr}\\b|\\b${found.attr}\\s+`,
            'i',
          )
          const m = attrRe.exec(openerSrc)
          if (!m) {
            return undefined
          }
          const removeStart = openerStart + m.index
          const removeEnd = removeStart + m[0].length
          return fixer.replaceTextRange([removeStart, removeEnd], '')
        },
      })
    }

    return {
      Literal(node: AstNode) {
        const v = (node as { value?: unknown | undefined }).value
        if (typeof v !== 'string') {
          return
        }
        if (!v.includes('<script')) {
          return
        }
        const range = (node as { range?: [number, number] | undefined }).range
        if (!range) {
          return
        }
        // Skip the leading quote char.
        checkLiteralText(node, v, range[0] + 1)
      },
      TemplateElement(node: AstNode) {
        const v = (
          node as {
            value?:
              | { cooked?: string | undefined; raw?: string | undefined }
              | undefined
          }
        ).value
        const cooked = v?.cooked ?? v?.raw ?? ''
        if (!cooked.includes('<script')) {
          return
        }
        const range = (node as { range?: [number, number] | undefined }).range
        if (!range) {
          return
        }
        // TemplateElement range covers the inner cooked text (no quote chars).
        checkLiteralText(node, cooked, range[0])
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
