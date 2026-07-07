/*
 * @file Enforce the canonical fleet social-follow badge block on the repo-root
 *   `README.md`. Every fleet README — including the wheelhouse source itself —
 *   carries both follow badges directly under the title:
 *
 *     [![Follow @SocketSecurity](https://img.shields.io/twitter/follow/SocketSecurity?style=social)](https://twitter.com/SocketSecurity)
 *     [![Follow @socket.dev on Bluesky](https://img.shields.io/badge/Follow-@socket.dev-1DA1F2?style=social&logo=bluesky)](https://bsky.app/profile/socket.dev)
 *
 *   These two badges are byte-identical fleet-canonical (not repo-contextual
 *   like the status badges), so unlike the section-skeleton rule this one does
 *   NOT exempt the wheelhouse source — the badges apply everywhere. Fires only
 *   on the repo-root README (nested READMEs under `packages/`, `docs/`, etc.
 *   are scoped docs with their own shape). No autofix: badge placement is
 *   contextual (under the title, after any status badges).
 */

import path from 'node:path'

import type { MarkdownlintRule } from './_shared/rule-types.mts'

const RULE_NAME = 'socket-readme-social-badges'
const SOCIAL_BADGES = [
  { name: 'Bluesky follow', signature: /bsky\.app\/profile\/socket\.dev/ },
  {
    name: 'X / Twitter follow',
    signature: /img\.shields\.io\/twitter\/follow\/SocketSecurity/,
  },
]

export function isRootReadme(filePath) {
  if (!filePath) {
    return false
  }
  const base = path.basename(filePath)
  if (base !== 'README.md') {
    return false
  }
  const dir = path.dirname(filePath)
  return dir === '.' || dir === '' || dir === process.cwd()
}

const rule: MarkdownlintRule = {
  description:
    'Fleet root README must carry both canonical social-follow badges (X / Twitter + Bluesky)',
  function(params, onError) {
    if (!isRootReadme(params.name)) {
      return
    }
    const content = params.lines.join('\n')
    for (let i = 0, { length } = SOCIAL_BADGES; i < length; i += 1) {
      const badge = SOCIAL_BADGES[i]
      if (!badge.signature.test(content)) {
        onError({
          lineNumber: 1,
          detail: `Missing the canonical "${badge.name}" badge. Every fleet README carries both the X / Twitter and Bluesky follow badges under the title. Canonical block: socket-wheelhouse/template/README.md.`,
          context: `README.md: social-follow badge "${badge.name}" not found`,
        })
      }
    }
  },
  names: [RULE_NAME, 'socket/readme-social-badges'],
  parser: 'none',
  tags: ['socket', 'fleet', 'readme'],
}

// oxlint-disable-next-line socket/no-default-export -- markdownlint-cli2 loads custom rules via dynamic import and expects the default export to be the rule object.
export default rule
