/**
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

import { isInsideWheelhouse } from './_shared/wheelhouse-self-skip.mjs'

const RULE_NAME = 'socket-no-private-wheelhouse-leak'
const FORBIDDEN_TOKEN_RE = /socket-wheelhouse/i

/**
 * @type {import('markdownlint').Rule}
 */
const rule = {
  names: [RULE_NAME, 'socket/no-private-wheelhouse-leak'],
  description:
    'socket-wheelhouse is a private repo — never reference it in public markdown',
  tags: ['socket', 'privacy'],
  parser: 'none',
  function(params, onError) {
    if (isInsideWheelhouse()) {
      return
    }
    let inFence = false
    for (let i = 0; i < params.lines.length; i += 1) {
      const line = params.lines[i]
      // Track fenced-code state. Open/close on lines that START with ``` or ~~~.
      if (/^\s*(?:```|~~~)/.test(line)) {
        inFence = !inFence
        continue
      }
      if (inFence) {
        continue
      }
      const match = FORBIDDEN_TOKEN_RE.exec(line)
      if (!match) {
        continue
      }
      onError({
        lineNumber: i + 1,
        detail:
          'Rewrite to not mention socket-wheelhouse — it is a private repo and the link will 404 for outside readers.',
        context: line.trim().slice(0, 120),
        range: [match.index + 1, match[0].length],
      })
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- markdownlint-cli2 loads custom rules via dynamic import and expects the default export to be the rule object.
export default rule
