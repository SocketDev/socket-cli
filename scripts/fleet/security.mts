/**
 * @file Canonical fleet scanning-security runner. Runs the two static-analysis
 *   tools the fleet uses for local security checks before push:
 *
 *   1. AgentShield — scans `.claude/` config for prompt-injection, leaked secrets,
 *      and overly-permissive tool permissions.
 *   2. zizmor — static analysis for `.github/workflows/*.yml` (unpinned actions,
 *      secret exposure, template injection, permission issues). Either tool
 *      missing prints a "run pnpm run setup-security-tools" hint (which
 *      downloads + verifies the pinned binary via the setup-security-tools hook
 *      + prompts for a Socket API token if none is stored) and skips that scan
 *      rather than failing the entire run. Cross-platform: uses `which` from
 *      `@socketsecurity/lib-stable/bin` for binary discovery (handles Windows
 *      .exe/.cmd resolution; returns null rather than throwing on miss) and
 *      `spawn` from `@socketsecurity/lib-stable/spawn` for proper async
 *      lifecycle. Wired in via `package.json`: "security": "node
 *      scripts/fleet/security.mts" Byte-identical across every fleet repo.
 *      Sync-scaffolding flags drift.
 */

import process from 'node:process'

import { which } from '@socketsecurity/lib-stable/bin/which'
import { WIN32 } from '@socketsecurity/lib-stable/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

const logger = getDefaultLogger()

async function hasExecutable(name: string): Promise<boolean> {
  // socket-lib's `which` returns null when the binary isn't on PATH
  // (no throw), so a simple truthy check suffices.
  return Boolean(await which(name))
}

export interface ToolRun {
  code: number
  stdout: string
}

// Run a tool, returning its exit code (default) — or, in capture mode, its exit
// code AND stdout/stderr text (for the --json envelope). Default mode inherits
// stdio so the byte-identical non-JSON behavior is unchanged across the fleet.
async function runTool(
  command: string,
  args: string[],
  capture: boolean,
): Promise<ToolRun> {
  try {
    const result = await spawn(command, args, {
      shell: WIN32,
      ...(capture ? { stdioString: true } : { stdio: 'inherit' }),
    })
    return {
      code: result.code ?? 1,
      stdout: capture ? `${result.stdout ?? ''}${result.stderr ?? ''}` : '',
    }
  } catch (e) {
    if (e && typeof e === 'object' && 'code' in e) {
      const code = (e as { code: unknown }).code
      const out = e as { stdout?: unknown; stderr?: unknown }
      return {
        code: typeof code === 'number' ? code : 1,
        stdout: capture
          ? `${typeof out.stdout === 'string' ? out.stdout : ''}${typeof out.stderr === 'string' ? out.stderr : ''}`
          : '',
      }
    }
    throw e
  }
}

export interface SecurityScanResult {
  agentshield: { code: number; output: string } | undefined
  zizmor: { code: number; output: string } | undefined
  skipped: string[]
}

async function main(): Promise<void> {
  const json = process.argv.includes('--json')
  const result: SecurityScanResult = {
    agentshield: undefined,
    skipped: [],
    zizmor: undefined,
  }

  if (!(await hasExecutable('agentshield'))) {
    result.skipped.push('agentshield')
    if (!json) {
      logger.info(
        'agentshield not installed; run "pnpm run setup-security-tools" to install',
      )
    }
  } else {
    const run = await runTool('agentshield', ['scan'], json)
    result.agentshield = { code: run.code, output: run.stdout }
    if (!json && run.code !== 0) {
      process.exitCode = run.code
      return
    }
  }

  if (!(await hasExecutable('zizmor'))) {
    result.skipped.push('zizmor')
    if (!json) {
      logger.info(
        'zizmor not installed; run "pnpm run setup-security-tools" to install',
      )
    }
  } else {
    const run = await runTool('zizmor', ['.github/'], json)
    result.zizmor = { code: run.code, output: run.stdout }
    if (!json && run.code !== 0) {
      process.exitCode = run.code
    }
  }

  if (json) {
    process.stdout.write(`${JSON.stringify(result, undefined, 2)}\n`)
  }
}

main().catch((e: unknown) => {
  logger.error(e)
  process.exitCode = 1
})
