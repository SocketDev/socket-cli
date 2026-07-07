#!/usr/bin/env node
/*
 * @file Weekly dependency update — the PLAIN (non-gh-aw) runner. Runs the same
 *   update the gh-aw `weekly-update.lock.yml` runs, but as an ordinary process,
 *   so the update is reachable locally and as a plain CI job without the gh-aw
 *   runtime. gh-aw stays the primary scheduled path (it adds an AI-credit
 *   budget, a firewall egress allowlist, and a web-flow-signed safe-output PR);
 *   this is the escape hatch + the local-dev entry. Flow (mirrors the gh-aw
 *   .md):
 *
 *   1. check-updates gate — `pnpm outdated`, lockstep `--json` exit 2, and
 *      submodule-behind. No-op exit when nothing is actionable. Exposed as a
 *      standalone `--check-updates` mode (exit 0 = updates, 1 = none) so the
 *      gh-aw workflow's gate job calls THIS, not an inline bash port.
 *   2. deterministic chain (ALWAYS, IN ORDER) — lockstep version-pin auto-bumps,
 *      submodule remainder note, npm deps (`update.mts`), package-manager pins,
 *      gh-aw action pins. The judgment-free part — see
 *      `weekly-update/deterministic-chain.mts`.
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
import { runDeterministicChain } from './weekly-update/deterministic-chain.mts'

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
// or a submodule is behind its remote. This is the single source of the gate
// logic — the gh-aw `weekly-update.md` check-updates job calls
// `weekly-update.mts --check-updates`, not an inline bash port of it.
export async function hasActionableUpdates(): Promise<boolean> {
  // pnpm outdated exits non-zero WHEN there are outdated deps, so key on the
  // output, not the exit code.
  const outdated = await capture('pnpm', ['outdated'])
  if (outdated.out && !/No outdated/i.test(outdated.out)) {
    return true
  }
  const hasLockstep = existsSync(
    path.join(REPO_ROOT, '.config', 'lockstep.json'),
  )
  if (hasLockstep) {
    // lockstep --json exits 2 when manifests are behind.
    try {
      await spawn('pnpm', ['run', 'lockstep', '--json'], { cwd: REPO_ROOT })
    } catch (e) {
      if ((e as { code?: unknown | undefined }).code === 2) {
        return true
      }
    }
  }
  // A repo with submodules but NO lockstep manifest checks each submodule
  // against its remote default branch (mirrors the gh-aw gate's third branch;
  // lockstep-managed submodules are already covered by the exit-2 check above).
  if (!hasLockstep && existsSync(path.join(REPO_ROOT, '.gitmodules'))) {
    if (await anySubmoduleBehind()) {
      return true
    }
  }
  return false
}

// True when any `.gitmodules` submodule is behind its remote default branch.
// Best-effort: a fetch/rev-list failure on one submodule is treated as
// not-behind so a transient network error never fabricates work.
export async function anySubmoduleBehind(): Promise<boolean> {
  const config = await capture('git', [
    'config',
    '--file',
    '.gitmodules',
    '--get-regexp',
    'path',
  ])
  if (!config.ok) {
    return false
  }
  const paths = config.out
    .split('\n')
    .map(line => line.trim().split(/\s+/u)[1])
    .filter((sub): sub is string => Boolean(sub))
  for (let i = 0, { length } = paths; i < length; i += 1) {
    const sub = path.join(REPO_ROOT, paths[i]!)
    if (!existsSync(sub)) {
      continue
    }
    await run('git', ['-C', sub, 'fetch', 'origin', '--tags', '--quiet'])
    const behind = await capture('git', [
      '-C',
      sub,
      'rev-list',
      '--count',
      'HEAD..origin/HEAD',
    ])
    if (behind.ok && Number(behind.out.trim()) > 0) {
      return true
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

const UPDATING_PROMPT = `You are the fleet's weekly dependency-update agent, running outside gh-aw as a plain job. The deterministic chain has ALREADY run and committed the mechanical updates: npm dependencies (update.mts), lockstep version-pin auto-bumps, package-manager pins, and gh-aw action pins. Do NOT redo any of those.

Run the /updating umbrella skill ONLY for the advisory remainder that needs judgment: lockstep file-fork / feature-parity / spec-conformance / lang-parity rows, non-lockstep submodule bumps, open Dependabot security advisories, the coverage badge, model pricing, and GitHub settings drift. Work in CI mode: skip builds/tests during the update. Make atomic commits (one logical change per commit) so the PR history is reviewable. Do NOT push or open a PR — the runner handles that.`

async function main(): Promise<void> {
  // --check-updates: the deterministic gate as a standalone mode. Exits 0 when
  // there is actionable drift, 1 when there is not — so the gh-aw
  // `weekly-update.md` check-updates job runs `weekly-update.mts --check-updates`
  // instead of an inline bash port (one source of the gate logic).
  if (process.argv.includes('--check-updates')) {
    const actionable = await hasActionableUpdates()
    logger.info(
      `[weekly-update] check-updates: ${actionable ? 'updates available' : 'nothing actionable'}.`,
    )
    process.exitCode = actionable ? 0 : 1
    return
  }

  const opts = parseArgs(process.argv.slice(2))

  logger.info('[weekly-update] checking for actionable updates…')
  if (!(await hasActionableUpdates())) {
    logger.success('[weekly-update] nothing actionable — exiting (no-op).')
    return
  }

  // Deterministic chain — always, IN ORDER, before the AI advisory pass:
  // lockstep version-pin bumps → submodule remainder note → npm deps
  // (update.mts) → package-manager pins → gh-aw action pins. The chain is
  // best-effort: a non-zero step warns, the chain + run continue.
  logger.info('[weekly-update] running the deterministic chain…')
  await runDeterministicChain()

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
