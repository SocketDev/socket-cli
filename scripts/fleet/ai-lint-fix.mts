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
 *      four lockdown flags, and a tight tool list, Read, Edit, Grep, Glob.
 *      Each spawn handles one file's worth of findings to keep the context
 *      window predictable.
 *   3. After all spawns finish, re-run `pnpm run lint` (without --fix) to verify
 *      nothing got worse. If the count went up, log a warning and exit
 *      non-zero. Skipped silently ONLY on the two explicit opt-outs:
 *
 *   - When `SKIP_AI_FIX=1` is set (CI sets this; AI-fix runs locally).
 *   - When `--no-ai` is passed.
 *   - When no AI agent CLI resolves to a runnable binary at all (the fleet
 *     has fallbacks beyond claude — codex, opencode, gemini — so "no client
 *     resolved" is an environment gap, not a findings-owner failure; residue
 *     is re-evaluated on the next `pnpm run fix` once a client is available).
 *
 *   Once a probe finds a runnable client, environmental per-spawn failures
 *   workspace trust, broken launcher, tool-policy mismatch, silent exits
 *   are classified (./ai-lint-fix/health.mts), and two consecutive ones abort
 *   the remaining files — each spawn would fail identically and a long
 *   residue would otherwise burn a 5-minute timeout per file. A spawn that
 *   exits 0 with findings to fix but leaves its target file byte-identical is
 *   a NO-OP FAILURE (a `claude --print` session blocked from editing still
 *   exits 0): two consecutive no-ops abort the batch with the captured spawn
 *   argv + output, and any no-op fails the run's final verdict. The four
 *   lockdown flags per
 *   CLAUDE.md "Programmatic Claude calls":
 *   - tools / allowedTools / disallowedTools / permissionMode. Cost / safety:
 *   - Sonnet 4.6, not Opus — judgment work but not architecturally deep;
 *     cost-tier-appropriate.
 *   - Per-file batches with a 5-minute timeout — bounds runaway loops.
 *   - Tools restricted to Read/Edit/Grep/Glob — no Bash, no Write of new files.
 *     The AI can only edit files that already exist.
 *   - permissionMode `acceptEdits` so Edit calls don't deadlock on the missing
 *     AskUserQuestion surface. Modules: ./ai-lint-fix/oxlint-json.mts (lint data
 *     + runner), ./ai-lint-fix/prompt.mts, per-file prompt corpus,
 *     ./ai-lint-fix/claude.mts, headless spawn, ./ai-lint-fix/rule-guidance.mts
 *     (which rules the AI handles + per-rule guidance + model tiers).
 *
 *   Teardown: `installChildTeardown()` (_shared/process-lifecycle.mts) wires
 *   SIGINT/SIGTERM/exit so this process can never end while its own `claude`
 *   child is still running — a killed or abandoned run takes the spawn with
 *   it instead of leaving it orphaned.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { joinAnd } from '@socketsecurity/lib-stable/arrays/join'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { runClaudeFix } from './ai-lint-fix/claude.mts'
import {
  buildNoOpAbortMessage,
  classifyAiFailure,
  createNoOpTracker,
  fileDigest,
  NO_OP_ABORT_THRESHOLD,
  probeAiCli,
} from './ai-lint-fix/health.mts'
import { bucketRulesFor, runOdaiLintFix } from './ai-lint-fix/odai-fix.mts'
import { runLintJson } from './ai-lint-fix/oxlint-json.mts'
import { bucketFindings, buildPrompt } from './ai-lint-fix/prompt.mts'
import {
  escalateTier,
  TIER_EFFORT,
  TIER_MODEL,
} from './ai-lint-fix/rule-guidance.mts'
import { isMainModule } from './_shared/is-main-module.mts'
import { installChildTeardown } from './_shared/process-lifecycle.mts'
import { runMain } from './_shared/run-main.mts'
import type { ScriptMeta } from './_shared/run-main.mts'

import type { AiCliProbe } from './ai-lint-fix/health.mts'

const logger = getDefaultLogger()

/**
 * Build the informational skip line for "no AI client resolved". Pulled out
 * as a pure function so the skip decision (a clean return, never
 * `process.exitCode = 1`) is unit-testable without spawning `main()`'s full
 * lint + probe pipeline.
 */
export function buildAiSkipMessage(
  probe: AiCliProbe,
  totalFindings: number,
  fileCount: number,
): string {
  const tried =
    probe.tried && probe.tried.length > 0
      ? joinAnd(probe.tried)
      : 'none on PATH'
  return (
    `ai-lint-fix: no runnable AI client (tried: ${tried}); skipping the AI residue leg — ` +
    `${totalFindings} finding(s) across ${fileCount} file(s) remain for a run with an AI client available.`
  )
}

export interface CliArgs {
  noAi: boolean
  staged: boolean
  all: boolean
  passthrough: string[]
}

export function parseArgs(argv: readonly string[]): CliArgs {
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

export async function main(): Promise<void> {
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

  // No resolvable AI client, claude or a fallback agent, is a clean skip,
  // not a failure — the fleet has fallbacks, so this is an environment gap
  // rather than a findings-owner failure. The residue re-evaluates on the
  // next `pnpm run fix` once a client is available.
  const probe = await probeAiCli(cwd)
  if (!probe.ok) {
    const total = [...byFile.values()].reduce((n, m) => n + m.length, 0)
    // No keyed client — but the haiku-bucket rules (mechanical rewrites) can
    // still be fixed keyless by routing odai's patch task to a local reasoning
    // backend. Every richer rule waits for a keyed run. Fail-open: the first
    // skip (no bin / no local backend) means every remaining file skips the
    // same way, so stop the loop there.
    let keylessFixed = 0
    for (const [filePath, findings] of byFile) {
      const ruleIds = findings
        .map(f => f.ruleId)
        .filter((r): r is string => typeof r === 'string')
      if (bucketRulesFor(ruleIds).length === 0) {
        continue
      }
      const result = await runOdaiLintFix(filePath, ruleIds, cwd)
      if (result.outcome === 'fixed') {
        keylessFixed += 1
        continue
      }
      if (result.outcome === 'skipped') {
        break
      }
      logger.warn(
        `ai-lint-fix: keyless fix failed for ${path.relative(cwd, filePath)}: ${result.reason}`,
      )
    }
    if (keylessFixed > 0) {
      // Same verify-then-reject contract as the keyed path: a keyless diff that
      // made lint worse fails the run for a human to inspect.
      const afterFiles = await runLintJson(args.passthrough)
      const after = [...bucketFindings(afterFiles).values()].reduce(
        (n, m) => n + m.length,
        0,
      )
      if (after > total) {
        logger.warn(
          `ai-lint-fix: keyless fixes regressed lint (${total} → ${after}); inspect the changes.`,
        )
        process.exitCode = 1
        return
      }
      logger.log(
        `ai-lint-fix: keyless on-device fixed findings in ${keylessFixed} file(s) (${total} → ${after} remaining).`,
      )
    }
    logger.info(buildAiSkipMessage(probe, total, byFile.size))
    return
  }

  let totalEdits = 0
  let totalErrors = 0
  let totalNoOps = 0
  // Consecutive classified environmental failures (workspace trust, broken
  // launcher, tool-policy, silent exits). Two in a row means every remaining
  // spawn fails identically — abort instead of burning a 5-minute timeout
  // per remaining file. File-specific failures reset the streak.
  let envFailureStreak = 0
  // Consecutive completed-but-zero-diff spawns. A spawn that exits 0 with
  // findings to fix but leaves its target byte-identical is a NO-OP FAILURE,
  // not a success — the incident shape is a repo hook denying every Edit
  // while `claude --print` still exits 0. Two in a row abort the batch with
  // the captured spawn output; a real edit resets the streak.
  const noOpTracker = createNoOpTracker()
  // Per-file progress counter. A long residue, dozens of files, emits one
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
    const beforeDigest = fileDigest(filePath)
    const { argv, exitCode, stderr, stdout } = await runClaudeFix(
      prompt,
      cwd,
      model,
      effort,
    )
    if (exitCode === 0) {
      const afterDigest = fileDigest(filePath)
      if (afterDigest !== beforeDigest) {
        totalEdits += findings.length
        envFailureStreak = 0
        noOpTracker.recordEdit()
        continue
      }
      // Completed with findings and a zero diff: a no-op failure, never a
      // success — count it and abort loud on a streak.
      totalNoOps += 1
      const streak = noOpTracker.recordNoOp({
        argv,
        exitCode,
        file: rel,
        findings: findings.length,
        stderr,
        stdout,
      })
      logger.warn(
        `AI-fix no-op for ${rel}: spawn completed (exit 0) but the file is unchanged.`,
      )
      if (streak >= NO_OP_ABORT_THRESHOLD) {
        const remaining = fileCount - fileIndex
        logger.error(buildNoOpAbortMessage(noOpTracker.receipts(), remaining))
        process.exitCode = 1
        return
      }
      continue
    }
    totalErrors++
    const classified = classifyAiFailure(stdout, stderr)
    if (!classified) {
      envFailureStreak = 0
      logger.warn(
        `AI-fix exited ${exitCode} for ${rel}: ${stderr.slice(0, 200)}`,
      )
      continue
    }
    envFailureStreak += 1
    logger.warn(`AI-fix ${classified.kind} for ${rel}: ${classified.remedy}`)
    if (envFailureStreak >= 2) {
      const remaining = fileCount - fileIndex
      logger.error(
        `AI-fix aborting: 2 consecutive ${classified.kind} failures — every remaining spawn would fail the same way (${remaining} files unattempted). ${classified.remedy}`,
      )
      break
    }
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
  // A batch that reached the end with any no-op spawn never reports as a
  // completed pass — the findings it "handled" are all still there.
  if (totalNoOps > 0) {
    logger.warn(
      `AI-fix finished with ${totalNoOps} no-op spawn(s) — completed spawns that changed nothing. ${afterCount}/${beforeCount} findings remain. Read the no-op warnings above for the captured spawn output.`,
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

const SCRIPT_META: ScriptMeta = {
  describe:
    'AI-fix the lint findings left after the deterministic oxlint/oxfmt autofix pass',
  help: `Usage: node scripts/fleet/ai-lint-fix.mts [flags]

  --no-ai   skip the AI leg entirely (CI sets SKIP_AI_FIX=1 for the same effect)
  --staged  lint the staged scope (forwarded to the lint runner)
  --all     lint the whole tree (forwarded to the lint runner)

Other flags pass through to \`pnpm run lint --json\` unchanged.`,
}

if (isMainModule(import.meta.url)) {
  // Wired here (not only in the parent fix.mts) so this process — spawned as
  // its own `node ai-lint-fix.mts` child — kills its OWN in-flight `claude`
  // grandchild if IT is killed or exits early. See _shared/process-lifecycle.mts.
  installChildTeardown()
  runMain(main, SCRIPT_META)
}
