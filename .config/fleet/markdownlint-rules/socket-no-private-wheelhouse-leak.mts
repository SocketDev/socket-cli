/*
 * @file Flag mentions of `socket-wheelhouse` in public-facing markdown.
 *   socket-wheelhouse is a private repo. Public READMEs / docs / release notes
 *   that link to it leak the internal tooling layout to users who can't access
 *   the link anyway. Whatever the markdown is trying to teach should be
 *   rewritten to not require the reference. Detects:
 *
 *   - The literal token `socket-wheelhouse` (case-insensitive) anywhere in a
 *     line.
 *   - `https://github.com/SocketDev/socket-wheelhouse...` URL forms. Skips fenced
 *     code blocks because those are intentional examples (and fenced-block
 *     scanning would false-positive on the very markdownlint config that
 *     references this file). No autofix: the right rewrite is contextual.
 */

import { isInsideWheelhouse } from './_shared/wheelhouse-self-skip.mts'

import type { MarkdownlintRule } from './_shared/rule-types.mts'

const RULE_NAME = 'socket-no-private-wheelhouse-leak'
const FORBIDDEN_TOKEN_RE = /socket-wheelhouse/i
// Two LOCAL-DISK forms carry the name functionally and must stay mentionable:
// the per-repo settings file (socket-wheelhouse.json / the root
// .socket-wheelhouse.json alternative) and the dep-0 bootstrap cache dir
// (node_modules/.cache/socket-wheelhouse/). Both are artifacts on the
// reader's own machine, not links to the private repo.
const SETTINGS_FILENAME_RE =
  /\.?socket-wheelhouse\.json|\.cache\/socket-wheelhouse\b/i

const rule: MarkdownlintRule = {
  description:
    'socket-wheelhouse is a private repo — never reference it in public markdown',
  function(params, onError) {
    if (isInsideWheelhouse()) {
      return
    }
    let inFence = false
    for (let i = 0; i < params.lines.length; i += 1) {
      const line = params.lines[i]!
      // Track fenced-code state. Open/close on lines that START with ``` or ~~~.
      if (/^\s*(?:```|~~~)/.test(line)) {
        inFence = !inFence
        continue
      }
      if (inFence) {
        continue
      }
      // Strip settings-filename forms BEFORE matching so a doc naming the
      // config file it describes doesn't flag; any other mention on the
      // same line still does.
      const scannable = line.replace(
        new RegExp(SETTINGS_FILENAME_RE.source, 'gi'),
        '',
      )
      const match = FORBIDDEN_TOKEN_RE.exec(scannable)
      if (!match) {
        continue
      }
      const displayIndex = line.search(FORBIDDEN_TOKEN_RE)
      onError({
        lineNumber: i + 1,
        detail:
          'Rewrite to not mention socket-wheelhouse — it is a private repo and the link will 404 for outside readers.',
        context: line.trim().slice(0, 120),
        range: [
          (displayIndex >= 0 ? displayIndex : match.index) + 1,
          match[0].length,
        ],
      })
    }
  },
  names: [RULE_NAME, 'socket/no-private-wheelhouse-leak'],
  parser: 'none',
  tags: ['socket', 'privacy'],
}

// oxlint-disable-next-line socket/no-default-export -- markdownlint-cli2 loads custom rules via dynamic import and expects the default export to be the rule object.
export default rule
