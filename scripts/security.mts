/**
 * @fileoverview Canonical fleet security-scan runner.
 *
 * Runs the two static-analysis tools the fleet uses for local security
 * checks before push:
 *
 *   1. AgentShield — scans `.claude/` config for prompt-injection,
 *      leaked secrets, and overly-permissive tool permissions.
 *   2. zizmor      — static analysis for `.github/workflows/*.yml`
 *      (unpinned actions, secret exposure, template injection,
 *      permission issues).
 *
 * Either tool missing prints a "run pnpm run setup" hint (which
 * downloads + verifies the pinned binary via the setup-security-tools
 * hook) and skips that scan rather than failing the entire run.
 *
 * Cross-platform: uses `which` from `@socketsecurity/lib/bin` for
 * binary discovery (handles Windows .exe/.cmd resolution; returns null
 * rather than throwing on miss) and `spawn` from
 * `@socketsecurity/lib/spawn` for proper async lifecycle.
 *
 * Wired in via `package.json`:
 *
 *   "security": "node scripts/security.mts"
 *
 * Byte-identical across every fleet repo. Sync-scaffolding flags
 * drift.
 */

import process from 'node:process'

import { which } from '@socketsecurity/lib/bin'
import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

async function hasExecutable(name: string): Promise<boolean> {
  // socket-lib's `which` returns null when the binary isn't on PATH
  // (no throw), so a simple truthy check suffices.
  return Boolean(await which(name))
}

async function runTool(command: string, args: string[]): Promise<number> {
  try {
    const result = await spawn(command, args, {
      stdio: 'inherit',
      shell: WIN32,
    })
    return result.code ?? 1
  } catch (e) {
    if (e && typeof e === 'object' && 'code' in e) {
      const code = (e as { code: unknown }).code
      return typeof code === 'number' ? code : 1
    }
    throw e
  }
}

async function main(): Promise<void> {
  if (!(await hasExecutable('agentshield'))) {
    logger.info('agentshield not installed; run "pnpm run setup" to install')
  } else {
    const agentshieldCode = await runTool('agentshield', ['scan'])
    if (agentshieldCode !== 0) {
      process.exitCode = agentshieldCode
      return
    }
  }

  if (!(await hasExecutable('zizmor'))) {
    logger.info('zizmor not installed; run "pnpm run setup" to install')
    return
  }

  const zizmorCode = await runTool('zizmor', ['.github/'])
  if (zizmorCode !== 0) {
    process.exitCode = zizmorCode
  }
}

main().catch((e: unknown) => {
  logger.error(e)
  process.exitCode = 1
})
