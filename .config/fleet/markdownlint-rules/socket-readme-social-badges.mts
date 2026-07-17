/*
 * @file Enforce the canonical fleet social-follow badge block on the repo-root
 *   `README.md`. Every fleet README — including the wheelhouse source itself —
 *   carries both follow badges directly under the title:
 *
 *     [![Follow @SocketSecurity](assets/fleet/badge-follow-x.svg)](https://twitter.com/SocketSecurity)
 *     [![Follow @socket.dev on Bluesky](assets/fleet/badge-follow-bluesky.svg)](https://bsky.app/profile/socket.dev)
 *
 *   These two badges are byte-identical fleet-canonical (not repo-contextual
 *   like the status badges), so unlike the section-skeleton rule this one does
 *   NOT exempt the wheelhouse source — the badges apply everywhere. Matched by
 *   the stable LINK target, not the badge image, so an image-host change (the
 *   retired shields.io URLs → the local assets/fleet/ SVGs) still counts.
 *   Fires only on the repo-root README (nested READMEs under `packages/`,
 *   `docs/`, etc. are scoped docs with their own shape). No autofix: badge
 *   placement is contextual (under the title, after any status badges).
 */

import type { MarkdownlintRule } from './_shared/rule-types.mts'

import { isRootReadme } from './_shared/root-readme.mts'

export { isRootReadme } from './_shared/root-readme.mts'

const RULE_NAME = 'socket-readme-social-badges'
const SOCIAL_BADGES = [
  { name: 'Bluesky follow', signature: /bsky\.app\/profile\/socket\.dev/ },
  {
    name: 'X / Twitter follow',
    signature: /(?:twitter|x)\.com\/SocketSecurity/,
  },
]

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
