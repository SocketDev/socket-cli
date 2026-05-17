#!/usr/bin/env node
/**
 * @fileoverview Watch a repo's GitHub Actions CI run, surface the first
 * failure log, and exit. The fix-and-push loop is driven by the human
 * (or the agent invoking this skill) — this runner is the eyes.
 *
 * Three modes the skill orchestrator picks between:
 *
 *   1. `--mode=fast` (default for ci.yml)
 *      Poll every 30s. Stop on first failure or first success.
 *      Use when watching a freshly-pushed commit's CI on main / PR.
 *
 *   2. `--mode=release`
 *      Poll every 30s until the FIRST job either fails or succeeds.
 *      Release matrices (curl, lief, binsuite, node-smol, …) fail fast
 *      in one matrix slot before others finish — we want that signal as
 *      soon as possible. Once any slot succeeds, the next poll cools
 *      down to 120s for the rest of the matrix.
 *
 *   3. `--mode=cool`
 *      Poll every 120s. Use after `release` has reported a first
 *      success — the rest of the matrix is just confirmation.
 *
 * Output (always JSON on the last line, prose above for humans):
 *
 *   {
 *     "status": "completed" | "in_progress" | "queued" | "failure",
 *     "conclusion": "success" | "failure" | "cancelled" | "skipped" | null,
 *     "runId": <number>,
 *     "url": "https://github.com/<owner>/<repo>/actions/runs/<id>",
 *     "failedJobs": [{ "name": "...", "logTailPath": "..." }],
 *     "elapsedSec": <number>
 *   }
 *
 * The orchestrator (SKILL.md prompt) reads the JSON, decides whether to
 * fix and push, then invokes this runner again. The log tail is dumped
 * to a tmp file so the orchestrator can Read it without re-spending the
 * `gh run view --log-failed` budget on every retry.
 */

import { mkdtempSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

type Mode = 'fast' | 'release' | 'cool'

interface CliArgs {
  repo: string
  workflow: string | undefined
  branch: string | undefined
  mode: Mode
  // Wall-clock cap on the whole watch loop. Default: 30min for fast,
  // 60min for release/cool. Beyond this, exit with the latest status
  // and let the orchestrator decide whether to re-invoke.
  budgetSec: number
  // Poll interval in seconds (override; otherwise derived from mode).
  pollSec: number | undefined
}

function parseArgs(argv: readonly string[]): CliArgs {
  let repo = ''
  let workflow: string | undefined
  let branch: string | undefined
  let mode: Mode = 'fast'
  let budgetSec = 1800
  let pollSec: number | undefined
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const a = argv[i]!
    if (a === '--repo') {
      repo = argv[++i]!
    } else if (a === '--workflow') {
      workflow = argv[++i]
    } else if (a === '--branch') {
      branch = argv[++i]
    } else if (a === '--mode') {
      const v = argv[++i]
      if (v !== 'fast' && v !== 'release' && v !== 'cool') {
        throw new Error(`--mode must be one of fast|release|cool (got: ${v})`)
      }
      mode = v
    } else if (a === '--budget-sec') {
      budgetSec = Number(argv[++i])
    } else if (a === '--poll-sec') {
      pollSec = Number(argv[++i])
    } else if (a === '-h' || a === '--help') {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${a}`)
    }
  }
  if (!repo) {
    throw new Error(
      'Missing --repo <owner/name>. Example: --repo SocketDev/socket-btm',
    )
  }
  return { repo, workflow, branch, mode, budgetSec, pollSec }
}

function printHelp(): void {
  logger.info(
    `Usage: node run.mts --repo <owner/name> [--workflow ci.yml] [--branch main]
                    [--mode fast|release|cool] [--budget-sec N] [--poll-sec N]

Watches a GH Actions run, surfaces the first failure log to a tmp file,
prints a JSON result on the final line. The fix-and-push loop is driven
by the caller (skill orchestrator / human).

Modes:
  fast     (default) 30s poll, stop on first failure OR first success.
           For ci.yml watching a single-job-set workflow.
  release  30s poll, stop on first failure OR first matrix-slot success.
           For build-server matrices (curl/lief/binsuite/node-smol).
           Returns as soon as ONE slot has reported either outcome.
  cool     120s poll. Use after release reported a first success — the
           remaining matrix is just confirmation, no need to fast-poll.

Examples:
  node run.mts --repo SocketDev/socket-btm --workflow ci.yml
  node run.mts --repo SocketDev/socket-btm --workflow build-curl.yml --mode release
  node run.mts --repo SocketDev/socket-btm --workflow build-curl.yml --mode cool`,
  )
}

interface GhRun {
  databaseId: number
  status: 'queued' | 'in_progress' | 'completed'
  conclusion: 'success' | 'failure' | 'cancelled' | 'skipped' | null
  url: string
  workflowName: string
  headBranch: string
  headSha: string
  createdAt: string
}

async function gh(args: readonly string[]): Promise<string> {
  // Bound every gh call at 60s — the GH API is usually <1s but a hung
  // request shouldn't park the watch loop. The caller already has its
  // own loop cadence, so a single slow gh call timing out and being
  // retried on the next tick is benign.
  const r = await spawn('gh', args as string[], {
    stdio: 'pipe',
    stdioString: true,
    timeout: 60_000,
  })
  return String(r.stdout ?? '').trim()
}

async function fetchLatestRun(args: CliArgs): Promise<GhRun | undefined> {
  const ghArgs: string[] = [
    'run',
    'list',
    '--repo',
    args.repo,
    '--limit',
    '1',
    '--json',
    'databaseId,status,conclusion,url,workflowName,headBranch,headSha,createdAt',
  ]
  if (args.workflow) {
    ghArgs.push('--workflow', args.workflow)
  }
  if (args.branch) {
    ghArgs.push('--branch', args.branch)
  }
  const raw = await gh(ghArgs)
  const list = JSON.parse(raw) as GhRun[]
  return list[0]
}

interface GhJob {
  databaseId: number
  name: string
  status: 'queued' | 'in_progress' | 'completed'
  conclusion: 'success' | 'failure' | 'cancelled' | 'skipped' | null
}

async function fetchJobs(args: CliArgs, runId: number): Promise<GhJob[]> {
  const raw = await gh([
    'run',
    'view',
    String(runId),
    '--repo',
    args.repo,
    '--json',
    'jobs',
  ])
  const obj = JSON.parse(raw) as { jobs: GhJob[] }
  return obj.jobs
}

/**
 * Dump the failed-job log tail to a tmp file so the orchestrator can
 * Read it without re-spending `gh run view --log-failed` budget on
 * every retry. The tail is the last ~400 lines — enough to catch the
 * error band without flooding context.
 */
async function dumpFailedLog(
  args: CliArgs,
  runId: number,
  tempDir: string,
): Promise<string> {
  const raw = await gh([
    'run',
    'view',
    String(runId),
    '--repo',
    args.repo,
    '--log-failed',
  ])
  const lines = raw.split('\n')
  const tail = lines.slice(-400).join('\n')
  const file = path.join(tempDir, `run-${runId}-failed.log`)
  await fs.writeFile(file, tail)
  return file
}

interface WatchResult {
  status: GhRun['status'] | 'failure'
  conclusion: GhRun['conclusion']
  runId: number
  url: string
  failedJobs: { name: string; logTailPath: string }[]
  elapsedSec: number
}

function pickPollSec(mode: Mode, override: number | undefined): number {
  if (override !== undefined) {
    return override
  }
  if (mode === 'cool') {
    return 120
  }
  // fast + release both poll at 30s; release stops earlier on first
  // matrix-slot outcome, but the cadence is the same.
  return 30
}

/**
 * Decide whether this poll's snapshot is a stopping point.
 *
 * Returns:
 *   - 'stop'    : terminal — caller reports + exits.
 *   - 'continue': loop again after pollSec.
 *
 * fast: stop when the run is completed (success OR failure) OR when any
 *       job has conclusion === failure (so we surface a failing job
 *       before the whole run finishes).
 *
 * release: stop when ANY job has either conclusion === failure or
 *          conclusion === success. The matrix runs in parallel; one
 *          slot landing is enough signal to know whether to start
 *          fixing or to cool down.
 *
 * cool: stop only on a fully-completed run. The caller is just waiting
 *       out the rest of the matrix.
 */
function decide(mode: Mode, run: GhRun, jobs: GhJob[]): 'stop' | 'continue' {
  if (mode === 'cool') {
    return run.status === 'completed' ? 'stop' : 'continue'
  }
  if (mode === 'fast') {
    if (run.status === 'completed') {
      return 'stop'
    }
    if (jobs.some(j => j.conclusion === 'failure')) {
      return 'stop'
    }
    return 'continue'
  }
  // release
  if (run.status === 'completed') {
    return 'stop'
  }
  if (
    jobs.some(j => j.conclusion === 'failure' || j.conclusion === 'success')
  ) {
    return 'stop'
  }
  return 'continue'
}

async function sleep(sec: number): Promise<void> {
  await new Promise<void>(r => {
    setTimeout(r, sec * 1000)
  })
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const pollSec = pickPollSec(args.mode, args.pollSec)
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'greening-ci.'))
  const started = Date.now()

  logger.info(
    `Watching ${args.repo}${args.workflow ? ` workflow=${args.workflow}` : ''}` +
      `${args.branch ? ` branch=${args.branch}` : ''} mode=${args.mode}` +
      ` poll=${pollSec}s budget=${args.budgetSec}s`,
  )
  logger.info(`Log tail will be written under: ${tempDir}`)

  let lastResult: WatchResult | undefined
  let lastRun: GhRun | undefined
  for (;;) {
    const elapsedSec = (Date.now() - started) / 1000
    if (elapsedSec > args.budgetSec) {
      logger.warn(
        `Wall-clock budget (${args.budgetSec}s) exceeded; returning latest snapshot.`,
      )
      if (lastRun) {
        lastResult = {
          status: lastRun.status,
          conclusion: lastRun.conclusion,
          runId: lastRun.databaseId,
          url: lastRun.url,
          failedJobs: [],
          elapsedSec: Math.round(elapsedSec),
        }
      }
      break
    }
    const run = await fetchLatestRun(args)
    if (!run) {
      logger.warn(
        `No runs found for ${args.repo}${args.workflow ? `/${args.workflow}` : ''}; ` +
          'is the workflow filename correct and has a run been triggered?',
      )
      await sleep(pollSec)
      continue
    }
    lastRun = run
    const jobs = await fetchJobs(args, run.databaseId)
    const failed = jobs.filter(j => j.conclusion === 'failure')
    logger.info(
      `[t+${Math.round(elapsedSec)}s] run=${run.databaseId} status=${run.status}` +
        ` conclusion=${run.conclusion ?? '-'} ` +
        `jobs: ${jobs.length} total, ${failed.length} failed`,
    )

    const verdict = decide(args.mode, run, jobs)
    if (verdict === 'stop') {
      const failedJobs: WatchResult['failedJobs'] = []
      if (failed.length > 0) {
        const logPath = await dumpFailedLog(args, run.databaseId, tempDir)
        for (let i = 0, { length } = failed; i < length; i += 1) {
          const j = failed[i]!
          failedJobs.push({ name: j.name, logTailPath: logPath })
        }
      }
      lastResult = {
        status: run.conclusion === 'failure' ? 'failure' : run.status,
        conclusion: run.conclusion,
        runId: run.databaseId,
        url: run.url,
        failedJobs,
        elapsedSec: Math.round(elapsedSec),
      }
      break
    }
    await sleep(pollSec)
  }

  if (!lastResult) {
    // Budget-exceeded path: emit a placeholder with whatever we last
    // saw so the orchestrator gets *something* parseable.
    lastResult = {
      status: 'in_progress',
      conclusion: null,
      runId: 0,
      url: '',
      failedJobs: [],
      elapsedSec: Math.round((Date.now() - started) / 1000),
    }
  }

  logger.info('')
  logger.info(`Run URL: ${lastResult.url || '(none)'}`)
  if (lastResult.failedJobs.length > 0) {
    logger.info(
      `Failed jobs (${lastResult.failedJobs.length}):` +
        ` ${lastResult.failedJobs.map(j => j.name).join(', ')}`,
    )
    logger.info(`Failure log tail: ${lastResult.failedJobs[0]!.logTailPath}`)
  }
  // Final line is JSON — the orchestrator parses this.
  logger.info(JSON.stringify(lastResult))
}

main().catch(e => {
  logger.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
})
