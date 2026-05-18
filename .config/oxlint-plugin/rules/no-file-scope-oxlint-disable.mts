/**
 * @file Forbid file-scope `oxlint-disable <rule>` comments — every exemption
 *   must be justified per call site via `oxlint-disable-next-line <rule> --
 *   <reason>`. Why: a file-scope `/* oxlint-disable
 *   socket/no-console-prefer-logger *\/` block at the top of a file silently
 *   exempts the entire file from a fleet rule. The exemption applies to lines
 *   the author never thought about — including future edits — and the reason
 *   field at the top is easy to forget by the time someone adds a new call
 *   below. Inline `oxlint-disable-next-line socket/<rule> -- <reason>` forces
 *   the author to write a fresh justification per call site, which surfaces in
 *   code review and in `git blame` next to the actual disabled code. Allowed:
 *
 *   - `// oxlint-disable-next-line <rule> -- <reason>` (per call site)
 *   - `/* oxlint-disable-next-line <rule> *\/` block form, also per call
 *   - File-scope disable for **plugin-internal rules** where the file itself
 *     defines the rule and intentionally contains the banned shape as
 *     lookup-table data (e.g. `no-status-emoji.mts` containing the emoji it
 *     bans). Matched by file path: any file under
 *     `.config/oxlint-plugin/rules/` is exempt from this rule. Banned:
 *   - `/* oxlint-disable <rule> *\/` at file scope (no `-next-line`)
 *   - `// oxlint-disable <rule>` at file scope (no `-next-line`)
 *   - Block `oxlint-enable` toggles that come paired with file-scope
 *     `oxlint-disable` blocks — same anti-pattern. No autofix: the rule reports
 *     each file-scope disable; the human moves each one to the call site that
 *     needs it (or removes it if the code can be rewritten to satisfy the
 *     rule).
 */

// Path-recognition helpers shared with sibling rules. See
// `../lib/fleet-paths.mts` for the rationale behind each exemption.
import {
  isPathsModule,
  isPluginInternalPath,
} from '../lib/fleet-paths.mts'
import type { AstNode, RuleContext } from '../lib/rule-types.mts'

const FILE_SCOPE_DISABLE_RE =
  /^\s*(?:\/\*|\/\/)\s*oxlint-disable(?!-next-line)\s+/

const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Forbid file-scope `oxlint-disable` comments; require `oxlint-disable-next-line` per call site so each exemption is independently justified.',
      category: 'Stylistic Issues',
      recommended: true,
    },
    fixable: undefined,
    messages: {
      fileScopeDisable:
        "File-scope `oxlint-disable {{rule}}` silently exempts the whole file from a fleet rule. Move the disable to `oxlint-disable-next-line {{rule}} -- <reason>` on the specific line that needs it. If the entire file legitimately can't comply, the file probably needs a refactor instead.",
    },
    schema: [],
  },

  create(context: RuleContext) {
    const filename = context.filename ?? context.getFilename?.() ?? ''
    if (isPluginInternalPath(filename) || isPathsModule(filename)) {
      return {}
    }
    const sourceCode = context.getSourceCode
      ? context.getSourceCode()
      : context.sourceCode
    return {
      Program(_node: AstNode) {
        const comments =
          (sourceCode.getAllComments && sourceCode.getAllComments()) || []
        for (let i = 0, { length } = comments; i < length; i += 1) {
          const c = comments[i]!
          const raw = c.value || ''
          // Skip JSDoc blocks. They start with a leading `*` after the
          // comment opener (`/**`), which sourceCode preserves as the
          // first char of `value`. JSDoc carries documentation prose
          // — including examples of the banned shape — not directives.
          if (c.type === 'Block' && raw.startsWith('*')) {
            continue
          }
          // sourceCode strips the leading `/*` or `//`; reconstruct so
          // the regex sees the directive line as authored.
          const reconstructed = `${c.type === 'Block' ? '/*' : '//'}${raw}`
          if (!FILE_SCOPE_DISABLE_RE.test(reconstructed)) {
            continue
          }
          const m = /oxlint-disable\s+([^\s*]+(?:\s+[^\s*]+)*)/.exec(
            reconstructed,
          )
          const ruleName = m && m[1] ? m[1].trim() : '<rule>'
          context.report({
            node: c as AstNode,
            messageId: 'fileScopeDisable',
            data: { rule: ruleName },
          })
        }
      },
    }
  },
}

export default rule
