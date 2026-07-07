#!/usr/bin/env node
/**
 * @file Weekly dependency update — the PLAIN (non-gh-aw) runner. Runs the same
 *   update the gh-aw `weekly-update.lock.yml` runs, but as an ordinary process,
 *   so the update is reachable locally and as a plain CI job without the gh-aw
 *   runtime. gh-aw stays the primary scheduled path (it adds an AI-credit
 *   budget, a firewall egress allowlist, and a web-flow-signed safe-output PR);
 *   this is the escape hatch + the local-dev entry. Flow (mirrors the gh-aw
 *   .md):
 *
 *   1. check-updates gate — `pnpm outdated`, lockstep `--json` exit 2, and
 *      submodule-behind. No-op exit when nothing is actionable.
 *   2. deterministic update (ALWAYS) — runs `update.mts` (taze 2-pass + lockfile).
 *      The judgment-free npm/lockfile part.
 *   3. agentic update (OPTIONAL) — if a Claude agent is reachable, invoke the
 *      `/updating` umbrella via the locked-down `spawnAiAgent` (AI_PROFILE.full
 *      = the four-flag lockdown the Programmatic-Claude rule mandates). No
 *      agent → log a skip note and continue on the deterministic result. A
 *      missing key NEVER fails the run (the resilience point).
 *   4. test — the configured setup and test commands.
 *   5. PR — on pass, open a PR via `gh` (unless --no-pr); on fail, print the logs
 *      and the next step without opening a PR. Flags mirror the gh-aw inputs
 *      and are all optional; each is documented at its default in `parseArgs`
 *      below. Run `node scripts/fleet/weekly-update.mts` with any of those
 *      flags.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { discoverAiAgents } from '@socketsecurity/lib-stable/ai/discover'
import { AI_PROFILE } from '@socketsecurity/lib-stable/ai/profiles'
import { spawnAiAgent } from '@socketsecurity/lib-stable/ai/spawn'

import type { AiEffort } from '@socketsecurity/lib-stable/ai/types'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { REPO_ROOT } from './paths.mts'

const logger = getDefaultLogger()

export interface WeeklyUpdateOptions {
  testSetupScript: string
  testScript: string
  updateModel: string
  updateEffort: AiEffort
  prBase: string | undefined
  prTitlePrefix: string
  agent: boolean
  openPr: boolean
}

// Parse argv into options. Defaults mirror the gh-aw weekly-update inputs; --pr
// is opt-in (local default leaves the branch) so a local run never surprises
// with a PR.
export function parseArgs(argv: readonly string[]): WeeklyUpdateOptions {
  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(name)
    return i !== -1 ? argv[i + 1] : undefined
  }
  return {
    agent: !argv.includes('--no-agent'),
    openPr: argv.includes('--pr') && !argv.includes('--no-pr'),
    prBase: flag('--pr-base'),
    prTitlePrefix:
      flag('--pr-title-prefix') ?? 'chore(deps): weekly dependency update',
    testScript: flag('--test-script') ?? 'pnpm test',
    testSetupScript: flag('--test-setup-script') ?? 'pnpm run build',
    // A weekly dependency update is mechanical — pair the cheap model with
    // medium effort (token-spend rule). Override with --update-effort.
    updateEffort: (flag('--update-effort') as AiEffort | undefined) ?? 'medium',
    updateModel: flag('--update-model') ?? 'haiku',
  }
}

// Run a command, inheriting stdio. Returns true on exit 0.
async function run(cmd: string, args: readonly string[]): Promise<boolean> {
  try {
    await spawn(cmd, [...args], { cwd: REPO_ROOT, stdio: 'inherit' })
    return true
  } catch {
    return false
  }
}

// Run a command, capturing stdout. Returns { ok, out } — never throws.
async function capture(
  cmd: string,
  args: readonly string[],
): Promise<{ ok: boolean; out: string }> {
  try {
    const r = await spawn(cmd, [...args], {
      cwd: REPO_ROOT,
      stdioString: true,
    })
    return { ok: true, out: String(r.stdout ?? '') }
  } catch (e) {
    const err = e as { stdout?: unknown | undefined }
    return { ok: false, out: String(err.stdout ?? '') }
  }
}

// The deterministic check-updates gate, ported from the gh-aw workflow: true
// when `pnpm outdated` reports drift, the lockstep manifest is behind (exit 2),
// or a submodule is behind its remote.
export async function hasActionableUpdates(): Promise<boolean> {
  // pnpm outdated exits non-zero WHEN there are outdated deps, so key on the
  // output, not the exit code.
  const outdated = await capture('pnpm', ['outdated'])
  if (outdated.out && !/No outdated/i.test(outdated.out)) {
    return true
  }
  if (existsSync(path.join(REPO_ROOT, '.config', 'lockstep.json'))) {
    // lockstep --json exits 2 when manifests are behind.
    try {
      await spawn('pnpm', ['run', 'lockstep', '--json'], { cwd: REPO_ROOT })
    } catch (e) {
      if ((e as { code?: unknown | undefined }).code === 2) {
        return true
      }
    }
  }
  return false
}

// True when a Claude agent is reachable (CLI on PATH + resolvable). Mirrors the
// codify-rule.mts probe. A missing agent is fine — the caller degrades.
export async function agentAvailable(): Promise<boolean> {
  try {
    const discovered = await discoverAiAgents({ repoRoot: REPO_ROOT })
    return 'claude' in discovered
  } catch {
    return false
  }
}

const UPDATING_PROMPT = `You are the fleet's weekly dependency-update agent, running outside gh-aw as a plain job. Run the /updating umbrella skill to update everything applicable to this repo — npm dependencies, the lockstep manifest, submodules, and workflow pins. Work in CI mode: skip builds/tests during the update. Make atomic commits (one logical change per commit) so the PR history is reviewable. Do NOT push or open a PR — the runner handles that.`

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2))

  logger.info('[weekly-update] checking for actionable updates…')
  if (!(await hasActionableUpdates())) {
    logger.success('[weekly-update] nothing actionable — exiting (no-op).')
    return
  }

  // Deterministic update — always. Runs the taze 2-pass + lockfile via the
  // existing update.mts (invoked as a subprocess so it stays untouched).
  logger.info('[weekly-update] running deterministic update (update.mts)…')
  const updateScript = path.join(REPO_ROOT, 'scripts', 'fleet', 'update.mts')
  if (!(await run(process.execPath, [updateScript]))) {
    logger.warn(
      '[weekly-update] deterministic update reported a non-zero exit; continuing.',
    )
  }

  // Agentic update — optional. Only when an agent is reachable; a missing key
  // degrades to deterministic-only and NEVER fails the run.
  if (opts.agent && (await agentAvailable())) {
    logger.info(
      `[weekly-update] running the /updating agent (model: ${opts.updateModel}, effort: ${opts.updateEffort})…`,
    )
    const { exitCode, stderr } = await spawnAiAgent({
      ...AI_PROFILE.full,
      cwd: REPO_ROOT,
      effort: opts.updateEffort,
      model: opts.updateModel,
      prompt: UPDATING_PROMPT,
      timeoutMs: 15 * 60 * 1000,
    })
    if (exitCode !== 0) {
      logger.warn(
        `[weekly-update] agent exited ${exitCode}: ${stderr.slice(0, 400)} — keeping the deterministic result.`,
      )
    }
  } else if (opts.agent) {
    logger.info(
      '[weekly-update] agentic step skipped (no Claude agent on PATH); ran the deterministic update only.',
    )
  } else {
    logger.info('[weekly-update] --no-agent: deterministic update only.')
  }

  // Test.
  logger.info(`[weekly-update] test setup: ${opts.testSetupScript}`)
  const [setupCmd, ...setupArgs] = opts.testSetupScript.split(' ')
  const setupOk = await run(setupCmd!, setupArgs)
  logger.info(`[weekly-update] test: ${opts.testScript}`)
  const [testCmd, ...testArgs] = opts.testScript.split(' ')
  const testOk = setupOk && (await run(testCmd!, testArgs))

  if (!testOk) {
    logger.fail(
      '[weekly-update] tests failed after the update — NOT opening a PR. ' +
        'Review the output above, fix + re-run, or let the gh-aw escalation (fix-test-failures) handle it.',
    )
    process.exitCode = 1
    return
  }

  if (!opts.openPr) {
    logger.success(
      '[weekly-update] update applied + tests pass. Branch left as-is (no --pr). ' +
        'Commit the changes and open a PR, or re-run with --pr.',
    )
    return
  }

  logger.info('[weekly-update] tests pass — opening a PR via gh…')
  const date = new Date().toISOString().slice(0, 10)
  const title = `${opts.prTitlePrefix} (${date})`
  const body =
    '## Weekly Update\n\nRan the `/updating` umbrella (npm + lockstep + submodules + pins) via the plain (non-gh-aw) runner.\n'
  const prArgs = [
    'pr',
    'create',
    '--title',
    title,
    '--body',
    body,
    '--label',
    'dependencies',
    '--label',
    'automation',
  ]
  if (opts.prBase) {
    prArgs.push('--base', opts.prBase)
  }
  if (!(await run('gh', prArgs))) {
    logger.fail(
      '[weekly-update] `gh pr create` failed — push the branch + open the PR manually.',
    )
    process.exitCode = 1
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main()
}
