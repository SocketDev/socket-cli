/*
 * @file Enforce the canonical fleet README section list. Fires only on the
 *   repo-root `README.md` (skipped for nested READMEs under `packages/`,
 *   `docs/`, `.claude/`, etc. — those are scoped docs with their own shape).
 *   Every fleet root README must contain five level-2 sections in this order:
 *
 *   1. Why this repo exists
 *   2. Install
 *   3. Usage
 *   4. Development
 *   5. License The canonical skeleton lives at
 *      socket-wheelhouse/template/README.md. Additional sections between/after
 *      these are allowed; reordering / missing / typo'd sections are findings.
 *      No autofix: a missing section needs content, not just a heading.
 */

import type { MarkdownlintRule } from './_shared/rule-types.mts'

import { isFreeformReadmeOptIn } from './_shared/freeform-readme-optin.mts'
import { isRootReadme } from './_shared/root-readme.mts'
import { isInsideWheelhouse } from './_shared/wheelhouse-self-skip.mts'

export { isRootReadme } from './_shared/root-readme.mts'

const RULE_NAME = 'socket-readme-required-sections'
const REQUIRED_SECTIONS = [
  'Why this repo exists',
  'Install',
  'Usage',
  'Development',
  'License',
]

const rule: MarkdownlintRule = {
  description:
    'Fleet root README must contain the canonical five sections in order',
  function(params, onError) {
    if (isInsideWheelhouse()) {
      return
    }
    if (!isRootReadme(params.name)) {
      return
    }
    // Product / marketplace repos (freeform-readme roster opt-in) carry public
    // READMEs that don't fit the five-section infra skeleton. The universal
    // badge / leak / sibling rules still apply; this section rule does not.
    if (isFreeformReadmeOptIn()) {
      return
    }
    const headings = []
    for (let i = 0; i < params.lines.length; i += 1) {
      const line = params.lines[i]!
      const m = /^##\s+(.+?)\s*$/.exec(line)
      if (m) {
        headings.push({ text: m[1]!, lineNumber: i + 1 })
      }
    }
    let cursor = 0
    for (let r = 0; r < REQUIRED_SECTIONS.length; r += 1) {
      const want = REQUIRED_SECTIONS[r]
      let found = -1
      for (let h = cursor; h < headings.length; h += 1) {
        if (headings[h]!.text === want) {
          found = h
          break
        }
      }
      if (found === -1) {
        onError({
          lineNumber: 1,
          detail: `Missing required section "## ${want}" (or it appears out of order). Canonical order: ${REQUIRED_SECTIONS.map(s => `"## ${s}"`).join(' → ')}.`,
          context: `README.md: required section "## ${want}" not found after position ${cursor}`,
        })
        return
      }
      cursor = found + 1
    }
  },
  names: [RULE_NAME, 'socket/readme-required-sections'],
  parser: 'none',
  tags: ['socket', 'fleet', 'readme'],
}

// oxlint-disable-next-line socket/no-default-export -- markdownlint-cli2 loads custom rules via dynamic import and expects the default export to be the rule object.
export default rule
