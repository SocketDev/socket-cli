#!/usr/bin/env node
/**
 * @file `check --all` gate: every gh-aw agentic workflow that pins an explicit
 *   `engine.model` in its frontmatter pins a CANONICAL model id — one the fleet
 *   recognizes (KNOWN_MODELS: the pricing registry + AI_TIER, from the shared
 *   scripts/fleet/lib/known-models.mts). This catches the drift class where a
 *   workflow keeps a stale id (`claude-sonnet-4-5`) after the canonical sonnet
 *   tier moved to `claude-sonnet-4-6` — a "same role, two model strings" split
 *   the ai-spawns gate can't see (it scans spawn CALLS in scripts/skills/hooks/
 *   workflows, not `.github/workflows/*.md` YAML). A workflow with NO explicit
 *   model inherits gh-aw's engine default and is not flagged. Pure node, no
 *   gh-aw dependency, so it runs in CI without the extension installed. Exit
 *   0 — every explicit workflow model is canonical (or none declared); 1 — at
 *   least one is stale / unknown.
 */

// oxlint-disable-next-line socket/prefer-async-spawn -- sync check; needs typed string stdout from `git ls-files`, no async.
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { readFileSync } from 'node:fs'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { KNOWN_MODELS } from '../lib/known-models.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

// The YAML frontmatter block (between the first two `---` lines), or '' when the
// file has no frontmatter (plain documentation living beside the workflows).
export function frontmatterOf(mdText: string): string {
  const parts = mdText.split(/^---\s*$/mu)
  // parts[0] is the pre-frontmatter (empty), parts[1] the frontmatter block.
  return parts.length >= 3 ? (parts[1] ?? '') : ''
}

// The explicit `model:` value declared in the frontmatter, or undefined when
// none. gh-aw nests it under `engine:` with indentation, so the key may lead
// with whitespace. A sibling key ending in `model` (`base_model:`) is NOT
// matched — the name must be exactly `model` after the leading whitespace.
export function declaredModel(frontmatter: string): string | undefined {
  const m = /^\s*model:\s*(\S+)\s*$/mu.exec(frontmatter)
  return m ? m[1] : undefined
}

// Enumerate tracked gh-aw workflow markdown sources.
function listAgenticMarkdown(): string[] {
  try {
    const r = spawnSync('git', ['ls-files', '*.github/workflows/*.md'], {
      stdio: 'pipe',
    })
    if (r.status !== 0) {
      return []
    }
    const { stdout } = r
    return (typeof stdout === 'string' ? stdout : String(stdout))
      .split(/\r?\n/u)
      .map(s => s.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

function main(): void {
  const mdFiles = listAgenticMarkdown()
  const problems: string[] = []
  let checked = 0
  for (let i = 0, { length } = mdFiles; i < length; i += 1) {
    const md = mdFiles[i]!
    let text = ''
    try {
      text = readFileSync(md, 'utf8')
    } catch {
      continue
    }
    const fm = frontmatterOf(text)
    if (!fm) {
      continue
    }
    const model = declaredModel(fm)
    if (model === undefined) {
      // No explicit model — inherits the gh-aw engine default; not our concern.
      continue
    }
    checked += 1
    if (!KNOWN_MODELS.has(model)) {
      problems.push(
        `${md}: engine.model '${model}' is not canonical — not in the pricing registry or AI_TIER (a stale/renamed id like claude-sonnet-4-5, or a typo). Use a current model id, then re-run \`gh aw compile ${md}\` and commit the .lock.yml.`,
      )
    }
  }
  if (problems.length === 0) {
    logger.log(
      checked === 0
        ? 'gh-aw workflow models: no explicit model pins (all inherit the engine default).'
        : `gh-aw workflow models: ${checked} explicit model pin(s), all canonical.`,
    )
    process.exitCode = 0
    return
  }
  logger.error(
    `gh-aw workflow models: ${problems.length} off-canonical model pin(s):`,
  )
  for (let i = 0, { length } = problems; i < length; i += 1) {
    logger.fail(problems[i]!)
  }
  process.exitCode = 1
}

if (isMainModule(import.meta.url)) {
  main()
}
