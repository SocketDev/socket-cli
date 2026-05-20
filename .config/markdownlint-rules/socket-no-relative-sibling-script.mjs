/**
 * @file Flag commands that reference sibling repos via relative paths.
 *
 *   `node ../socket-foo/scripts/bar.mts` in a fleet README assumes the
 *   reader has the sibling repo checked out at exactly the right level
 *   relative to the current repo. That's almost never true for an
 *   outside user, and the command silently fails.
 *
 *   Detects (inside fenced code blocks and inline `code`):
 *     - `node ../<segment>/...` invocations
 *     - `pnpm ../<segment>/...` invocations
 *     - Bare `../socket-<segment>/...` references in code/inline-code
 *
 *   Skips: relative paths to the current repo's own tree (`./scripts/`,
 *   `../package.json` within a monorepo), which are useful and don't
 *   leak sibling state.
 *
 *   No autofix: the rewrite is to either inline the script's content or
 *   publish the helper to npm and reference the published name.
 */

import { isInsideWheelhouse } from './_shared/wheelhouse-self-skip.mjs'

const RULE_NAME = 'socket-no-relative-sibling-script'
const SIBLING_PATH_RES = [
  // Detect `<runner> ../<sibling>/...` where runner is node/pnpm/npm/yarn/bun
  // (anything resembling a runtime invocation).
  /\b(?:node|pnpm|npm|yarn|bun|deno)\s+\.\.\/[\w@-]+\//,
  // Detect bare ../<segment>/ where the first segment doesn't start with `.`
  // (i.e. genuine sibling, not the current repo's `..` for monorepo packages).
  /(?:^|\s)\.\.\/socket-[\w-]+\//i,
  /(?:^|\s)\.\.\/sdxgen\//,
  /(?:^|\s)\.\.\/stuie\//,
]

/** @type {import("markdownlint").Rule} */
const rule = {
  names: [RULE_NAME, 'socket/no-relative-sibling-script'],
  description:
    'Commands referencing sibling fleet repos via relative paths fail for outside readers',
  tags: ['socket', 'fleet'],
  parser: 'none',
  function(params, onError) {
    if (isInsideWheelhouse()) {
      return
    }
    for (let i = 0; i < params.lines.length; i += 1) {
      const line = params.lines[i]
      for (let j = 0; j < SIBLING_PATH_RES.length; j += 1) {
        const re = SIBLING_PATH_RES[j]
        const match = re.exec(line)
        if (!match) {
          continue
        }
        onError({
          lineNumber: i + 1,
          detail:
            'Rewrite the command to not depend on a sibling-repo checkout. Inline the script, link to its source on GitHub, or publish the helper to npm and reference the package name.',
          context: line.trim().slice(0, 120),
          range: [match.index + 1, match[0].length],
        })
        break
      }
    }
  },
}

export default rule
