#!/usr/bin/env node
/**
 * @file AI-assisted codification step — the authoring engine the
 *   codifying-disciplines skill routes its generation phase through (sibling of
 *   scripts/fleet/ai-lint-fix.mts). Given a single codification gap (a
 *   discipline that exists in prose/convention/memory but is NOT enforced by
 *   code) and the surface it should land on, this spawns a tier-matched headless
 *   agent to AUTHOR that surface — a hook, a lint rule, a check, or (delegated)
 *   the CLAUDE.md bullet + agents.md doc — with its mandatory test, then
 *   verifies the result.
 *   Why a script and not just a Workflow agent: the skill's Workflow PROPOSES
 *   the codification (scan → dedup → rank → diff sketch). This script is the
 *   APPLY engine for one chosen gap — it pins model + effort to the surface
 *   (token-spend rule), enforces the four-flag programmatic-Claude lockdown via
 *   AI_PROFILE, and runs the surface's own verifier (the new hook's tests, the
 *   new check, the lint plugin load) at the SCRIPT level the way ai-lint-fix
 *   re-runs lint — "give the agent a way to verify its work," done by the
 *   orchestrator since the agent subprocess shouldn't grade itself.
 *   Surfaces + tiers live in ./ai-codify/codify-guidance.mts. The `agents-doc`
 *   surface is delegated to scripts/fleet/codify-rule.mts (which owns the
 *   CLAUDE.md byte budget) rather than authored here.
 *   Usage:
 *   node scripts/fleet/ai-codify/cli.mts\
 *   --surface hook-guard\
 *   --discipline "<one-line statement of the rule>"\
 *   --incident "<the motivating case, generic — no dates/SHAs>"\
 *   [--memory <path/to/memory.md>] [--name <kebab-name>] [--no-ai] [--apply]
 *   Default is a DRY RUN (prints the resolved tier + prompt, authors nothing);
 *   `--apply` performs the authoring spawn + verification. Skipped silently when
 *   the claude CLI isn't on PATH or `--no-ai` / `SKIP_AI_CODIFY=1` is set.
 */

import { existsSync, readFileSync } from 'node:fs'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { AI_PROFILE } from '@socketsecurity/lib-stable/ai/profiles'
import { discoverAiAgents } from '@socketsecurity/lib-stable/ai/discover'
import { spawnAiAgent } from '@socketsecurity/lib-stable/ai/spawn'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { REPO_ROOT } from '../paths.mts'
import {
  CODIFY_SURFACES,
  SURFACE_GUIDANCE,
  tierFor,
} from './codify-guidance.mts'

import type { CodifySurface } from './codify-guidance.mts'

const logger = getDefaultLogger()

export interface CodifyGapArgs {
  apply: boolean
  discipline: string
  incident: string
  memory: string | undefined
  name: string | undefined
  noAi: boolean
  surface: CodifySurface
}

function isCodifySurface(value: string): value is CodifySurface {
  return CODIFY_SURFACES.has(value as CodifySurface)
}

export function parseArgs(argv: readonly string[]): CodifyGapArgs {
  let apply = false
  let discipline = ''
  let incident = ''
  let memory: string | undefined
  let name: string | undefined
  let noAi = false
  let surface: CodifySurface | undefined
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const arg = argv[i]!
    if (arg === '--apply') {
      apply = true
    } else if (arg === '--no-ai') {
      noAi = true
    } else if (arg === '--surface') {
      const value = argv[i + 1] ?? ''
      i += 1
      if (!isCodifySurface(value)) {
        // oxlint-disable-next-line unicorn/no-array-sort -- the spread copies CODIFY_SURFACES into a fresh array (no shared mutation); .toSorted() would trip socket/no-runtime-features-below-engine-floor in cascaded Node-18 repos.
        const surfaces = [...CODIFY_SURFACES].sort().join(', ')
        throw new Error(
          `--surface must be one of ${surfaces}; saw "${value}". Fix: pass the surface codifying-disciplines chose for this gap.`,
        )
      }
      surface = value
    } else if (arg === '--discipline') {
      discipline = argv[i + 1] ?? ''
      i += 1
    } else if (arg === '--incident') {
      incident = argv[i + 1] ?? ''
      i += 1
    } else if (arg === '--memory') {
      memory = argv[i + 1] ?? ''
      i += 1
    } else if (arg === '--name') {
      name = argv[i + 1] ?? ''
      i += 1
    }
  }
  if (!surface) {
    // oxlint-disable-next-line unicorn/no-array-sort -- the spread copies CODIFY_SURFACES into a fresh array (no shared mutation); .toSorted() would trip socket/no-runtime-features-below-engine-floor in cascaded Node-18 repos.
    const surfaces = [...CODIFY_SURFACES].sort().join(', ')
    throw new Error(
      '--surface is required (one of ' +
        `${surfaces}). Where: ai-codify CLI args. Fix: pass --surface <surface>.`,
    )
  }
  if (!discipline.trim()) {
    throw new Error(
      '--discipline is required: a one-line statement of the rule to enforce. Where: ai-codify CLI args. Fix: pass --discipline "<rule>".',
    )
  }
  return { apply, discipline, incident, memory, name, noAi, surface }
}

/**
 * Build the authoring prompt for a surface. Combines the discipline + incident
 * the skill passes in with the per-surface conventions from codify-guidance,
 * the memory file's content when one is named (the agent's source-of-truth
 * context), and an explicit verify-before-stop instruction.
 */
export function buildCodifyPrompt(args: CodifyGapArgs): string {
  const guidance = SURFACE_GUIDANCE[args.surface]
  const sections: string[] = []
  sections.push(
    'You are authoring a code enforcer for a fleet discipline that currently',
    'lives only in prose / convention / memory. Make it law: lay down the',
    'surface below so the discipline is enforced by code, with its mandatory',
    'test, matching the fleet conventions exactly.',
    '',
    `<discipline>${args.discipline}</discipline>`,
  )
  if (args.incident.trim()) {
    sections.push(`<motivating-incident>${args.incident}</motivating-incident>`)
  }
  if (args.name) {
    sections.push(`<suggested-name>${args.name}</suggested-name>`)
  }
  if (args.memory && existsSync(args.memory)) {
    let memoryText = ''
    try {
      memoryText = readFileSync(args.memory, 'utf8')
    } catch {
      memoryText = ''
    }
    if (memoryText) {
      sections.push(
        '<memory description="The recorded lesson — your source-of-truth context for what to enforce and why.">',
        memoryText,
        '</memory>',
      )
    }
  }
  sections.push(
    `<surface name="${args.surface}">`,
    guidance,
    '</surface>',
    '',
    '<verify-before-stop>',
    "Before you finish: run the surface's own check. For a hook, run its",
    'vitest test via `pnpm test test/repo/{unit,integration}/hooks/<name>.test.mts`',
    'and confirm it passes both arms. For a check, run',
    '`node scripts/fleet/check/<name>.mts` and confirm it exits 0 on a clean',
    'tree (plus its vitest test if it has one). For a lint rule, run its vitest',
    'test via `pnpm test test/repo/{unit,integration}/lint-rules/<id>.test.mts`',
    'and the plugin-load check. Do not declare done on an unverified surface.',
    '</verify-before-stop>',
  )
  return sections.join('\n')
}

/**
 * Author the `agents-doc` surface by shelling out to codify-rule.mts rather
 * than spawning our own agent — that script owns the CLAUDE.md byte budget +
 * defer-to-docs split. Requires a memory file (its source-of-truth input).
 */
async function delegateToCodifyRule(
  args: CodifyGapArgs,
): Promise<{ exitCode: number }> {
  if (!args.memory) {
    logger.warn(
      'agents-doc surface requires --memory (codify-rule.mts resolves the bullet + doc from the memory file). Skipping.',
    )
    return { exitCode: 1 }
  }
  const ruleArgs = ['scripts/fleet/codify-rule.mts', '--memory', args.memory]
  if (args.apply) {
    ruleArgs.push('--apply')
  }
  const r = await spawn('node', ruleArgs, { cwd: REPO_ROOT, stdio: 'inherit' })
  return { exitCode: r.code ?? 1 }
}

async function hasClaudeCli(cwd: string): Promise<boolean> {
  const discovered = await discoverAiAgents({ repoRoot: cwd })
  return 'claude' in discovered
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (args.noAi || process.env['SKIP_AI_CODIFY'] === '1') {
    return
  }

  // The doc surface is a different engine — route it before the tier/spawn
  // path so codify-rule.mts owns the CLAUDE.md budget end-to-end.
  if (args.surface === 'agents-doc') {
    const { exitCode } = await delegateToCodifyRule(args)
    if (exitCode !== 0) {
      process.exitCode = exitCode
    }
    return
  }

  const { effort, model, tier } = tierFor(args.surface)
  const prompt = buildCodifyPrompt(args)

  if (!args.apply) {
    logger.log(
      `ai-codify DRY RUN — surface=${args.surface} tier=${tier} model=${model} effort=${effort}`,
    )
    logger.log('Prompt that WOULD be sent (pass --apply to author):')
    logger.log(prompt)
    return
  }

  if (!(await hasClaudeCli(REPO_ROOT))) {
    logger.warn(
      `Skipping ai-codify (claude CLI not on PATH). Surface ${args.surface} was not authored.`,
    )
    return
  }

  logger.log(`ai-codify authoring ${args.surface} (${tier}/${effort})…`)
  // AI_PROFILE.full: authoring a new hook/lint-rule/check is multi-file (Write
  // + Edit) AND must run the surface's own verifier (Bash: node/pnpm — the
  // profile's allowlist), so the agent can self-verify before stopping. The
  // four lockdown flags ride in via the profile spread per the
  // programmatic-Claude rule; spawnAiAgent adds --no-session-persistence + the
  // 529-overload retry.
  const result = await spawnAiAgent({
    ...AI_PROFILE.full,
    cwd: REPO_ROOT,
    effort,
    model,
    prompt,
    timeoutMs: 15 * 60 * 1000,
  })
  if (result.exitCode !== 0) {
    logger.warn(
      `ai-codify agent exited ${result.exitCode} for surface ${args.surface}: ${result.stderr.slice(0, 300)}`,
    )
    process.exitCode = 1
    return
  }
  logger.log(
    `ai-codify authored ${args.surface} in ${(result.durationMs / 1000).toFixed(0)}s (${result.attempts} attempt(s)). Review the diff, then cascade + run the surface's test.`,
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e: unknown) => {
    logger.error(`ai-codify: ${errorMessage(e)}`)
    process.exitCode = 1
  })
}
