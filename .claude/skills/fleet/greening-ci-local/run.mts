#!/usr/bin/env node
/*
 * @file Drive a workflow through Agent-CI in LOCAL Docker containers and surface
 *   the first paused step — the local twin of greening-ci/run.mts. This runner
 *   is eyes-only: it launches agent-ci with `--pause-on-failure`, watches for
 *   the launcher's exit-77 (a step paused) or a clean exit (green), dumps the
 *   paused-runner log tail to a tmp file, classifies the failure as a code/config
 *   defect vs. a local env-gap (Docker base image missing a runner-only lib,
 *   Depot/OIDC unavailable, a macOS leg skipped for no tart), and prints a JSON
 *   verdict on its final line. The fix-and-retry loop is driven by the calling
 *   agent (SKILL.md): on a code/config pause it reads the log tail, fixes the
 *   checkout, then re-invokes this runner with `--retry <runner-name>` to resume
 *   the SAME paused runner — never a full pipeline restart.
 *
 *   Where greening-ci watches GitHub Actions remotely and fixes-then-pushes,
 *   this runs in local containers and fixes-then-retries in place — no push, no
 *   remote runner minutes.
 *
 *   Output (always JSON on the last line, prose above for humans):
 *     { "status": "green" | "paused" | "error",
 *       "runnerName": "<paused runner>" | null,
 *       "retryCmd": "agent-ci retry --name <runner>" | null,
 *       "classification": "code" | "env-gap" | null,
 *       "envGapReason": "<which boundary>" | null,
 *       "logTailPath": "<tmp file>" | null,
 *       "elapsedSec": <number> }
 *
 *   `status: "green"` — every leg that can run locally passed; done.
 *   `status: "paused"` + `classification: "code"` — read logTailPath, fix, then
 *     re-invoke `--retry <runnerName>`.
 *   `status: "paused"` + `classification: "env-gap"` — the local boundary, not a
 *     defect; abort the runner and report "<leg> needs a real runner."
 */

import { mkdtempSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

const logger = getDefaultLogger()

// The agent-ci launcher exits 77 the instant a step pauses (stdout not a TTY).
const PAUSE_EXIT_CODE = 77

// Wrapper that guards gh-aw .lock.yml inputs; drop-in for the agent-ci binary.
const AGENT_CI_WRAPPER = 'scripts/fleet/agent-ci-skip-locks.mts'

interface CliArgs {
  // Single workflow to validate (e.g. .github/workflows/build-curl.yml). When
  // omitted, runs all PR/push workflows for the branch (--all).
  workflow: string | undefined
  // Collapse a matrix to one representative leg for a fast first pass.
  noMatrix: boolean
  // Runner name from a prior `status: "paused"` verdict; present → resume that
  // runner after a local fix rather than launch a fresh run.
  retry: string | undefined
  // With --retry: resume from this step index (skip earlier passing steps).
  fromStep: number | undefined
  // GitHub token for fetching the SocketDev/socket-registry reusable workflow.
  // Bare (true) → agent-ci resolves via `gh auth token`; a string overrides.
  githubToken: boolean | string
  // Wall-clock cap on the whole run. Default 600s (single non-matrix workflow);
  // bump for a full local matrix (Docker image pulls + per-leg builds).
  budgetSec: number
}

// Patterns in a paused runner's log tail that mean "the local container can't
// reproduce this leg" — a boundary, not a code defect. Each maps to a
// human-readable reason the orchestrator relays. Ordered most-specific first.
const ENV_GAP_PATTERNS: ReadonlyArray<{ re: RegExp; reason: string }> = [
  {
    re: /libatomic\.so|libstdc\+\+\.so|GLIBC_\d|version `GLIBC/u,
    reason: 'Docker base image is missing a runner-only system library',
  },
  {
    re: /\/var\/run\/docker\.sock|Cannot connect to the Docker daemon/u,
    reason:
      'Docker daemon is not reachable (start OrbStack, confirm docker info)',
  },
  {
    re: /id-token|OIDC|depot\.dev|DEPOT_TOKEN|oidc-token/iu,
    reason: 'Depot/OIDC is unavailable locally — needs a real runner',
  },
  {
    re: /tart|sshpass|macOS runner|requires a macOS/iu,
    reason: 'macOS leg skipped locally (no tart/sshpass on this host)',
  },
]

export function classifyFailure(logTail: string): {
  classification: 'code' | 'env-gap'
  envGapReason: string | undefined
} {
  for (let i = 0, { length } = ENV_GAP_PATTERNS; i < length; i += 1) {
    const entry = ENV_GAP_PATTERNS[i]!
    if (entry.re.test(logTail)) {
      return { classification: 'env-gap', envGapReason: entry.reason }
    }
  }
  return { classification: 'code', envGapReason: undefined }
}

// Read the launcher's `run.paused` event (NDJSON on stdout) for the paused
// runner name and its retry command. Returns undefined fields when absent — the
// orchestrator then reads the human log tail to find the runner.
export function parsePausedRunner(output: string): {
  runnerName: string | undefined
  retryCmd: string | undefined
} {
  const lines = output.split('\n')
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]!.trim()
    if (!line.startsWith('{') || !line.includes('run.paused')) {
      continue
    }
    try {
      const obj = JSON.parse(line) as {
        event?: string | undefined
        name?: string | undefined
        runner?: string | undefined
        retry_cmd?: string | undefined
      }
      if (obj.event === 'run.paused') {
        return {
          retryCmd: obj.retry_cmd,
          runnerName: obj.runner ?? obj.name,
        }
      }
    } catch {
      // Not the JSON line we want; keep scanning upward.
    }
  }
  return { retryCmd: undefined, runnerName: undefined }
}

export function buildAgentCiArgs(args: CliArgs): string[] {
  const ciArgs: string[] = [AGENT_CI_WRAPPER]
  if (args.retry !== undefined) {
    ciArgs.push('retry', '--name', args.retry)
    if (args.fromStep !== undefined) {
      ciArgs.push('--from-step', String(args.fromStep))
    }
  } else if (args.workflow) {
    ciArgs.push('run', '--workflow', args.workflow)
  } else {
    ciArgs.push('run', '--all')
  }
  ciArgs.push('--quiet', '--pause-on-failure')
  if (args.noMatrix) {
    ciArgs.push('--no-matrix')
  }
  if (args.githubToken === true) {
    ciArgs.push('--github-token')
  } else if (typeof args.githubToken === 'string') {
    ciArgs.push('--github-token', args.githubToken)
  }
  return ciArgs
}

export function parseArgs(argv: readonly string[]): CliArgs {
  let workflow: string | undefined
  let noMatrix = false
  let retry: string | undefined
  let fromStep: number | undefined
  let githubToken: boolean | string = true
  let budgetSec = 600
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const a = argv[i]!
    if (a === '--workflow') {
      workflow = argv[++i]
    } else if (a === '--no-matrix') {
      noMatrix = true
    } else if (a === '--retry') {
      retry = argv[++i]
    } else if (a === '--from-step') {
      fromStep = Number(argv[++i])
    } else if (a === '--github-token') {
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        githubToken = next
        i += 1
      } else {
        githubToken = true
      }
    } else if (a === '--budget-sec') {
      budgetSec = Number(argv[++i])
    } else if (a === '--help' || a === '-h') {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${a}`)
    }
  }
  return { budgetSec, fromStep, githubToken, noMatrix, retry, workflow }
}

interface RunResult {
  status: 'green' | 'paused' | 'error'
  runnerName: string | undefined
  retryCmd: string | undefined
  classification: 'code' | 'env-gap' | undefined
  envGapReason: string | undefined
  logTailPath: string | undefined
  elapsedSec: number
}

export function printHelp(): void {
  logger.info(
    // oxlint-disable-next-line socket/no-logger-newline-literal -- CLI help text is intentionally a single multi-line block; splitting would garble the columnar formatting users expect.
    `Usage: node run.mts [--workflow .github/workflows/<wf>.yml] [--no-matrix]
                    [--retry <runner-name> [--from-step N]] [--github-token [T]]
                    [--budget-sec N]

Drives Agent-CI in local Docker containers, surfaces the first paused step to a
tmp log tail, classifies it (code vs env-gap), and prints a JSON verdict on the
final line. The fix-and-retry loop is driven by the caller (skill / human).

  --workflow     A single workflow to validate; omit to run all PR/push workflows.
  --no-matrix    Collapse a matrix to one representative leg (fast first pass).
  --retry        Resume a previously-paused runner after a local fix (by name).
  --from-step    With --retry: resume from step index N (skip passing steps).
  --github-token Bare → agent-ci resolves via 'gh auth token'; or pass a token.
  --budget-sec   Wall-clock cap (default 600; raise for a full local matrix).

Examples:
  node run.mts --workflow .github/workflows/build-curl.yml --no-matrix
  node run.mts                       (all PR/push workflows for the branch)
  node run.mts --retry build-curl-linux-x64   (after fixing the paused leg)`,
  )
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'greening-ci-local.'))
  const started = Date.now()
  const ciArgs = buildAgentCiArgs(args)

  logger.info(
    `Running Agent-CI locally: node ${ciArgs.join(' ')}` +
      ` budget=${args.budgetSec}s`,
  )
  logger.info(`Log tail will be written under: ${tempDir}`)

  let result: RunResult
  try {
    // The wrapper passes through to agent-ci; capture stdout/stderr so we can
    // parse the run.paused NDJSON event and dump the human log tail. The
    // launcher exits PAUSE_EXIT_CODE (77) on a pause — lib spawn rejects on a
    // non-zero exit carrying {code, stdout, stderr}, so a pause arrives as a
    // rejection, not a resolution.
    const r = await spawn('node', ciArgs, {
      stdio: 'pipe',
      stdioString: true,
      timeout: args.budgetSec * 1000,
    })
    // Clean exit → every local leg passed.
    result = {
      classification: undefined,
      elapsedSec: Math.round((Date.now() - started) / 1000),
      envGapReason: undefined,
      logTailPath: undefined,
      retryCmd: undefined,
      runnerName: undefined,
      status: 'green',
    }
    void r
  } catch (e) {
    const err = e as {
      code?: number | string | undefined
      stdout?: string | undefined
      stderr?: string | undefined
    }
    const out = `${String(err.stdout ?? '')}\n${String(err.stderr ?? '')}`
    if (err.code === PAUSE_EXIT_CODE) {
      const { retryCmd, runnerName } = parsePausedRunner(out)
      const tail = out.split('\n').slice(-400).join('\n')
      const logTailPath = path.join(tempDir, 'paused-step.log')
      await fs.writeFile(logTailPath, tail)
      const { classification, envGapReason } = classifyFailure(tail)
      result = {
        classification,
        elapsedSec: Math.round((Date.now() - started) / 1000),
        envGapReason,
        logTailPath,
        retryCmd:
          retryCmd ??
          (runnerName ? `agent-ci retry --name ${runnerName}` : undefined),
        runnerName,
        status: 'paused',
      }
    } else {
      // A non-pause, non-zero exit: agent-ci itself errored (bad args, daemon
      // down before any step ran, workflow parse error). Surface the tail so
      // the orchestrator can read the real cause.
      const tail = out.split('\n').slice(-400).join('\n')
      const logTailPath = path.join(tempDir, 'agent-ci-error.log')
      await fs.writeFile(logTailPath, tail)
      result = {
        classification: undefined,
        elapsedSec: Math.round((Date.now() - started) / 1000),
        envGapReason: undefined,
        logTailPath,
        retryCmd: undefined,
        runnerName: undefined,
        status: 'error',
      }
    }
  }

  logger.info('')
  if (result.status === 'green') {
    logger.info('Locally green — every leg that can run locally passed.')
  } else if (result.status === 'paused') {
    logger.info(
      `Paused at runner=${result.runnerName ?? '(unknown)'}` +
        ` classification=${result.classification}` +
        `${result.envGapReason ? ` (${result.envGapReason})` : ''}`,
    )
    logger.info(`Paused-step log tail: ${result.logTailPath}`)
    if (result.retryCmd) {
      logger.info(
        `After fixing, resume with: node ${AGENT_CI_WRAPPER} ` +
          result.retryCmd.replace(/^agent-ci /u, ''),
      )
    }
  } else {
    logger.warn('Agent-CI errored before reaching a pausable step.')
    logger.info(`Error log tail: ${result.logTailPath}`)
  }
  // Final line is JSON — the orchestrator parses this.
  logger.info(JSON.stringify(result))
}

main().catch(e => {
  logger.error(errorMessage(e))
  process.exit(1)
})
