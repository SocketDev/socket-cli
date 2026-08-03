/*
 * @file Generate the credential-shape list embedded in the gh-aw agent prompts.
 *
 *   The agentic workflows post their reports — issue bodies, comments, PR
 *   descriptions, and the `missing_data` / incomplete-result paths — verbatim
 *   into repositories that may be public. An agent that writes a
 *   credential-shaped string into one of those trips secret scanning, and the
 *   alert costs a human an investigation to disprove. That happens even when
 *   the value was invented as an illustration, because a made-up key is
 *   indistinguishable from a real one to a scanner.
 *
 *   The prompts therefore need to name the shapes. They cannot import
 *   `SECRET_VALUE_PATTERNS` — a workflow prompt is markdown, not TypeScript —
 *   so this generator splices the catalog's labels into a marked block, and
 *   `--check` fails when the block drifts. That keeps one source of truth: a
 *   new vendor shape is added to token-patterns.mts, and every consumer picks
 *   it up, the Bash-time token-guard and the agent prompts alike.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { SECRET_VALUE_PATTERNS } from '../../../.claude/hooks/fleet/_shared/token-patterns.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { writeThroughMirrorLock } from '../_shared/mirror-lock.mts'
import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

const BEGIN_MARKER =
  '<!-- BEGIN GENERATED token-shapes: scripts/fleet/gen/aw-token-shapes.mts -->'
const END_MARKER = '<!-- END GENERATED token-shapes -->'

// Both tiers: the template seed the cascade ships, and the wheelhouse's own
// live copy that `gh aw compile` reads.
const WORKFLOW_RELATIVE_PATHS: readonly string[] = [
  'template/base/.github/workflows/weekly-update.md',
  'template/base/.github/workflows/get-green.md',
  '.github/workflows/weekly-update.md',
  '.github/workflows/get-green.md',
]

/**
 * The generated block body: one bullet per catalog entry. Labels already read
 * as `Vendor thing (prefix)`, which is what an agent needs to recognise a
 * shape, so they ship verbatim rather than being reformatted.
 */
export function renderTokenShapeBlock(
  patterns: ReadonlyArray<{ label: string }> = SECRET_VALUE_PATTERNS,
): string {
  const labels = [...new Set(patterns.map(p => p.label))].toSorted()
  const bullets = labels.map(label => `- ${label}`).join('\n')
  return `${BEGIN_MARKER}\n\n${bullets}\n\n${END_MARKER}`
}

/**
 * Replace the marked region in `source`, or return `undefined` when the
 * markers are absent or inverted. Absent markers are a caller error worth
 * reporting rather than silently appending a block to the end of a prompt.
 */
export function spliceTokenShapeBlock(
  source: string,
  block: string,
): string | undefined {
  const start = source.indexOf(BEGIN_MARKER)
  const end = source.indexOf(END_MARKER)
  if (start === -1 || end === -1 || end < start) {
    return undefined
  }
  return source.slice(0, start) + block + source.slice(end + END_MARKER.length)
}

export function generateAwTokenShapes(config: {
  check: boolean
  repoRoot: string
}): number {
  const cfg = { __proto__: null, ...config } as typeof config
  const { check, repoRoot } = cfg
  const block = renderTokenShapeBlock()
  const stale: string[] = []
  const missing: string[] = []
  for (let i = 0, { length } = WORKFLOW_RELATIVE_PATHS; i < length; i += 1) {
    const relPath = WORKFLOW_RELATIVE_PATHS[i]!
    const absPath = path.join(repoRoot, relPath)
    if (!existsSync(absPath)) {
      continue
    }
    const current = readFileSync(absPath, 'utf8')
    const next = spliceTokenShapeBlock(current, block)
    if (next === undefined) {
      missing.push(relPath)
      continue
    }
    if (next === current) {
      continue
    }
    stale.push(relPath)
    if (!check) {
      writeThroughMirrorLock(absPath, next)
    }
  }
  if (missing.length) {
    logger.error(
      `gen/aw-token-shapes: missing the generated-block markers in ${missing.length} file(s): ${missing.join(', ')}. Add the BEGIN/END pair where the shape list belongs.`,
    )
    return 1
  }
  if (!stale.length) {
    if (!check) {
      logger.success(
        `gen/aw-token-shapes: token shapes already current, ${SECRET_VALUE_PATTERNS.length} pattern(s).`,
      )
    }
    return 0
  }
  if (check) {
    logger.error(
      `gen/aw-token-shapes: the embedded token-shape list is stale in ${stale.length} file(s): ${stale.join(', ')}. Run \`node scripts/fleet/gen/aw-token-shapes.mts\`, re-run \`gh aw compile\`, and commit both the .md and .lock.yml.`,
    )
    return 1
  }
  logger.success(
    `gen/aw-token-shapes: refreshed the token-shape list in ${stale.length} file(s). Re-run \`gh aw compile\` so the .lock.yml matches.`,
  )
  return 0
}

function main(): void {
  process.exitCode = generateAwTokenShapes({
    check: process.argv.includes('--check'),
    repoRoot: REPO_ROOT,
  })
}

if (isMainModule(import.meta.url)) {
  main()
}
