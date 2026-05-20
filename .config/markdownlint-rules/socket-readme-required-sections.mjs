/**
 * @file Enforce the canonical fleet README section list.
 *
 *   Fires only on the repo-root `README.md` (skipped for nested READMEs
 *   under `packages/`, `docs/`, `.claude/`, etc. — those are scoped docs
 *   with their own shape). Every fleet root README must contain five
 *   level-2 sections in this order:
 *
 *     1. Why this repo exists
 *     2. Install
 *     3. Usage
 *     4. Development
 *     5. License
 *
 *   The canonical skeleton lives at socket-wheelhouse/template/README.md.
 *   Additional sections between/after these are allowed; reordering /
 *   missing / typo'd sections are findings.
 *
 *   No autofix: a missing section needs content, not just a heading.
 */

import path from 'node:path'

import { isInsideWheelhouse } from './_shared/wheelhouse-self-skip.mjs'

const RULE_NAME = 'socket-readme-required-sections'
const REQUIRED_SECTIONS = [
  'Why this repo exists',
  'Install',
  'Usage',
  'Development',
  'License',
]

function isRootReadme(filePath) {
  // markdownlint passes `params.name` as a path relative to the working
  // dir. The root README is the one whose basename is README.md AND
  // whose directory is the cwd or `.`.
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

/** @type {import("markdownlint").Rule} */
const rule = {
  names: [RULE_NAME, 'socket/readme-required-sections'],
  description:
    'Fleet root README must contain the canonical five sections in order',
  tags: ['socket', 'fleet', 'readme'],
  parser: 'none',
  function(params, onError) {
    if (isInsideWheelhouse()) {
      return
    }
    if (!isRootReadme(params.name)) {
      return
    }
    const headings = []
    for (let i = 0; i < params.lines.length; i += 1) {
      const line = params.lines[i]
      const m = /^##\s+(.+?)\s*$/.exec(line)
      if (m) {
        headings.push({ text: m[1], lineNumber: i + 1 })
      }
    }
    let cursor = 0
    for (let r = 0; r < REQUIRED_SECTIONS.length; r += 1) {
      const want = REQUIRED_SECTIONS[r]
      let found = -1
      for (let h = cursor; h < headings.length; h += 1) {
        if (headings[h].text === want) {
          found = h
          break
        }
      }
      if (found === -1) {
        onError({
          lineNumber: 1,
          detail: `Missing required section "## ${want}" (or it appears out of order). Canonical order: ${REQUIRED_SECTIONS.map((s) => `"## ${s}"`).join(' → ')}.`,
          context: `README.md: required section "## ${want}" not found after position ${cursor}`,
        })
        return
      }
      cursor = found + 1
    }
  },
}

export default rule
