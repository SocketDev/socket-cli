#!/usr/bin/env node
/*
 * @file AI-assisted lint fix step. Runs after `pnpm run lint --fix` (oxlint +
 *   oxfmt deterministic autofix) to handle the lint findings that aren't safely
 *   mechanically fixable. The CLAUDE.md "Lint rules" guidance is to autofix
 *   when the rewrite is unambiguous; what's left after the deterministic pass
 *   is by definition the judgment-call set. Pipeline:
 *
 *   1. Run `pnpm run lint --json` to capture remaining violations.
 *   2. If there are any findings the AI step is allowed to handle, build a
 *      per-file batch and spawn a headless `claude --print` with Sonnet, the
 *      four lockdown flags, and a tight tool list (Read, Edit, Grep, Glob).
 *      Each spawn handles one file's worth of findings to keep the context
 *      window predictable.
 *   3. After all spawns finish, re-run `pnpm run lint` (without --fix) to verify
 *      nothing got worse. If the count went up, log a warning and exit
 *      non-zero. Skipped silently:
 *
 *   - When the `claude` CLI isn't on PATH.
 *   - When `SKIP_AI_FIX=1` is set (CI sets this; AI-fix runs locally).
 *   - When `--no-ai` is passed. The four lockdown flags per CLAUDE.md
 *     "Programmatic Claude calls":
 *   - tools / allowedTools / disallowedTools / permissionMode. Cost / safety:
 *   - Sonnet 4.6, not Opus — judgment work but not architecturally deep;
 *     cost-tier-appropriate.
 *   - Per-file batches with a 5-minute timeout — bounds runaway loops.
 *   - Tools restricted to Read/Edit/Grep/Glob — no Bash, no Write of new files.
 *     The AI can only edit files that already exist.
 *   - permissionMode `acceptEdits` so Edit calls don't deadlock on the missing
 *     AskUserQuestion surface. Modules: ./ai-lint-fix/oxlint-json.mts (lint data
 *     + runner), ./ai-lint-fix/prompt.mts (per-file prompt corpus),
 *     ./ai-lint-fix/claude.mts (headless spawn), ./ai-lint-fix/rule-guidance.mts
 *     (which rules the AI handles + per-rule guidance + model tiers).
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { hasClaudeCli, runClaudeFix } from './ai-lint-fix/claude.mts'
import { runLintJson } from './ai-lint-fix/oxlint-json.mts'
import { bucketFindings, buildPrompt } from './ai-lint-fix/prompt.mts'
import {
  escalateTier,
  TIER_EFFORT,
  TIER_MODEL,
} from './ai-lint-fix/rule-guidance.mts'

const logger = getDefaultLogger()

interface CliArgs {
  noAi: boolean
  staged: boolean
  all: boolean
  passthrough: string[]
}

function parseArgs(argv: readonly string[]): CliArgs {
  const passthrough: string[] = []
  let noAi = false
  let staged = false
  let all = false
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const arg = argv[i]!
    if (arg === '--no-ai') {
      noAi = true
      continue
    }
    if (arg === '--staged') {
      staged = true
      passthrough.push(arg)
      continue
    }
    if (arg === '--all') {
      all = true
      passthrough.push(arg)
      continue
    }
    passthrough.push(arg)
  }
  return { all, noAi, passthrough, staged }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (args.noAi) {
    return
  }
  if (process.env['SKIP_AI_FIX'] === '1') {
    return
  }
  if (!existsSync('.config/fleet/oxlintrc.json')) {
    return
  }

  const files = await runLintJson(args.passthrough)
  const byFile = bucketFindings(files)
  if (byFile.size === 0) {
    return
  }

  // oxlint-disable-next-line socket/no-process-cwd-in-scripts-hooks -- relative path for log output; user invokes `pnpm run fix` from their cwd and expects paths relative to where they ran.
  const cwd = process.cwd()

  if (!(await hasClaudeCli(cwd))) {
    const total = [...byFile.values()].reduce((n, m) => n + m.length, 0)
    logger.warn(
      `${total} AI-handled lint findings remain in ${byFile.size} files; skipping AI-fix step (claude CLI not on PATH).`,
    )
    return
  }

  let totalEdits = 0
  let totalErrors = 0
  // Per-file progress counter. A long residue (dozens of files) emits one
  // `[i/N]` line per file so the run never reads as "nothing happening" — a
  // long-running step must surface incremental progress as it goes, not only
  // at the start and end.
  let fileIndex = 0
  const fileCount = byFile.size

  for (const [filePath, findings] of byFile) {
    fileIndex += 1
    const rel = path.relative(cwd, filePath)
    // Pick the model AND effort from the highest-tier rule in this file's
    // batch. Pure-Haiku files (identifier renames, null→undefined, etc.) run
    // cheap on low effort; any caller-chain rewrite escalates to Sonnet on
    // medium; a `socket/max-file-lines` finding escalates to Opus on high.
    // Effort tracks the tier per the CLAUDE.md token-spend rule.
    const ruleIds = findings
      .map(f => f.ruleId)
      .filter((r): r is string => typeof r === 'string')
    const tier = escalateTier(ruleIds)
    const model = TIER_MODEL[tier]
    const effort = TIER_EFFORT[tier]
    logger.log(
      `AI-fix [${fileIndex}/${fileCount}] ${rel} (${findings.length} findings, ${tier}/${effort})…`,
    )
    const prompt = buildPrompt(filePath, findings)
    const { exitCode, stderr } = await runClaudeFix(prompt, cwd, model, effort)
    if (exitCode === 0) {
      totalEdits += findings.length
      continue
    }
    totalErrors++
    logger.warn(`AI-fix exited ${exitCode} for ${rel}: ${stderr.slice(0, 200)}`)
  }

  // Verification — re-run lint and count remaining AI-handled
  // findings. Per CLAUDE.md / Anthropic best practices, "give Claude
  // a way to verify its work" is the highest-leverage thing; we do
  // it at the script level since the AI subprocesses don't have Bash.
  const beforeCount = [...byFile.values()].reduce((n, m) => n + m.length, 0)
  const afterFiles = await runLintJson(args.passthrough)
  const afterByFile = bucketFindings(afterFiles)
  const afterCount = [...afterByFile.values()].reduce((n, m) => n + m.length, 0)

  if (totalErrors > 0) {
    logger.warn(
      `AI-fix finished with ${totalErrors} subprocess errors. ${afterCount}/${beforeCount} findings remain. Re-run \`pnpm run lint\` to see what survived.`,
    )
    process.exitCode = 1
    return
  }
  if (afterCount > beforeCount) {
    logger.warn(
      `AI-fix introduced regressions: ${beforeCount} → ${afterCount} findings. Inspect the changes.`,
    )
    process.exitCode = 1
    return
  }
  logger.log(
    `AI-fix attempted ${totalEdits} findings across ${byFile.size} files (${beforeCount} → ${afterCount} remaining).`,
  )
}

main().catch((e: unknown) => {
  const msg = errorMessage(e)
  logger.error(`ai-lint-fix: ${msg}`)
  process.exitCode = 1
})
