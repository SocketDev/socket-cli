#!/usr/bin/env node
/**
 * @file Full repo setup wizard — runs the fleet steps in order, then any
 *   repo-owned steps discovered in scripts/repo/setup/. Each fleet step is also
 *   runnable independently via pnpm run setup:<name>. Usage: pnpm setup-all
 *   pnpm setup-all --rotate pnpm setup-all --skip-tools.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { parseCanonicalMcpConfig, writeCodexAdapters } from '../mcp-config.mts'
import { discoverRepoSetup } from '../_shared/repo-setup.mts'
import { REPO_ROOT } from '../paths.mts'
import { setupBrew } from './setup-brew.mts'
import { setupDeveloperTools } from './setup-developer-tools.mts'
import { setupGo } from './setup-go.mts'
import { setupMcp } from './setup-mcp.mts'
import { setupPython } from './setup-python.mts'
import { setupRefero } from './setup-refero.mts'
import { setupRust } from './setup-rust.mts'

import type { EcosystemStepResult } from './ecosystems.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const logger = getDefaultLogger()

// The per-ecosystem provisioning steps, alphabetical. Each self-detects and
// no-ops (skips) when its ecosystem or platform does not apply, so the whole
// list runs unconditionally. Also runnable standalone via pnpm run setup:<eco>.
const ECOSYSTEM_STEPS: ReadonlyArray<
  readonly [string, () => Promise<EcosystemStepResult>]
> = [
  ['setup:brew', setupBrew],
  ['setup:developer-tools', setupDeveloperTools],
  ['setup:go', setupGo],
  ['setup:mcp', setupMcp],
  ['setup:python', setupPython],
  ['setup:refero', setupRefero],
  ['setup:rust', setupRust],
]

export function run(script: string, extraArgs: string[] = []): boolean {
  const r = spawnSync(
    'node',
    ['--experimental-strip-types', script, ...extraArgs],
    { cwd: REPO_ROOT, stdio: 'inherit' },
  )
  return r.status === 0
}

// Parse the setup-all CLI flags: --rotate (rotate the API token) and
// --skip-tools (skip package-manager/security-tool/ecosystem installs).
export function parseSetupArgs(argv: string[]): {
  rotate: boolean
  skipTools: boolean
} {
  return {
    rotate: argv.includes('--rotate'),
    skipTools: argv.includes('--skip-tools'),
  }
}

// True only when every named step succeeded.
export function allStepsOk(
  results: ReadonlyArray<readonly [string, boolean]>,
): boolean {
  return results.every(([, ok]) => ok)
}

// Render the "=== Summary ===" checklist lines for the setup results.
export function formatSummaryLines(
  results: ReadonlyArray<readonly [string, boolean]>,
): string[] {
  return results.map(([name, ok]) => `  ${ok ? '✓' : '✗'} ${name}`)
}

// Generate the gitignored, generated-untracked `.codex` adapters from the
// committed `.mcp.json`. A pure repo-local projection (writes files, installs
// nothing), so it runs UNCONDITIONALLY — never behind `--skip-tools`, like the
// Claude-config step — otherwise `setup-all --skip-tools` would leave a member
// with no Codex MCP config or PreToolUse guard. A missing `.mcp.json` is not a
// failure (nothing to project). See docs/agents.md/fleet/release-vs-cascade.md.
export function generateCodexAdapters(): boolean {
  const canonicalPath = path.join(REPO_ROOT, '.mcp.json')
  if (!existsSync(canonicalPath)) {
    return true
  }
  try {
    writeCodexAdapters(
      REPO_ROOT,
      parseCanonicalMcpConfig(readFileSync(canonicalPath, 'utf8')),
    )
    return true
  } catch (e) {
    logger.error(`Codex adapters — ${errorMessage(e)}`)
    return false
  }
}

async function main(): Promise<void> {
  const { rotate, skipTools } = parseSetupArgs(process.argv.slice(2))

  const results: Array<[string, boolean]> = []

  logger.log('=== Socket Repo Setup ===')
  logger.log('')

  if (!skipTools) {
    logger.log('── Tools (pnpm + sfw + bootstrap) ─────────')
    results.push(['Tools', run(path.join(__dirname, 'setup-tools.mjs'))])
    logger.log('')
  }

  logger.log('── Token ──────────────────────────────────')
  results.push([
    'Token',
    run(path.join(__dirname, 'token.mts'), rotate ? ['--rotate'] : []),
  ])
  logger.log('')

  logger.log('── Claude config ──────────────────────────')
  results.push([
    'Claude config',
    run(path.join(__dirname, 'claude-config.mts')),
  ])
  logger.log('')

  // Pure repo-local projection (.mcp.json → .codex) — always-run, never gated
  // by --skip-tools; the kimi-CLI user merge (setup:mcp) stays tools-gated.
  logger.log('── Codex adapters ─────────────────────────')
  results.push(['Codex adapters', generateCodexAdapters()])
  logger.log('')

  if (!skipTools) {
    logger.log('── Security Tools ─────────────────────────')
    results.push([
      'Security tools',
      run(
        path.join(
          REPO_ROOT,
          '.claude',
          'hooks',
          'fleet',
          'setup-security-tools',
          'install.mts',
        ),
      ),
    ])
    logger.log('')
  }

  // Per-ecosystem provisioning (local == CI): brew / go / python / rust, each
  // self-detecting and installing only through the locked/soaked artifact.
  // Gated by --skip-tools like the other install steps (each still no-ops when
  // its ecosystem/platform is absent, so a repo without them sees clean skips).
  if (!skipTools) {
    for (const [name, step] of ECOSYSTEM_STEPS) {
      logger.log(`── ${name} ─────────────────────────────────`)
      const result = await step()
      results.push([name, result.ok])
      logger.log('')
    }
  }

  // Repo-owned setup steps (scripts/repo/setup/*.mts) — the fleet/repo seam.
  // Absent in most members; the wheelhouse ships the native-host + extension
  // steps here. Ordered by filename (see discoverRepoSetup).
  for (const rel of discoverRepoSetup(REPO_ROOT)) {
    const name = path.basename(rel, '.mts')
    logger.log(`── ${name} ─────────────────────────────────`)
    results.push([name, run(path.join(REPO_ROOT, rel))])
    logger.log('')
  }

  logger.log('=== Summary ===')
  for (const line of formatSummaryLines(results)) {
    logger.log(line)
  }

  if (!allStepsOk(results)) {
    logger.error('')
    logger.warn('Some steps failed — see above.')
    process.exitCode = 1
  } else {
    logger.log('')
    logger.log('All setup steps complete.')
  }
}

if (isMainModule(import.meta.url)) {
  main().catch((e: unknown) => {
    logger.error(e)
    process.exitCode = 1
  })
}
