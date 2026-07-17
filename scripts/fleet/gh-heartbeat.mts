// Fleet tool — re-stamp the gh token-freshness heartbeat so long-running
// gh loops (PR scanning, CI watching) don't trip the token-age rotation
// mid-loop (docs/agents.md/fleet/gh-token-hygiene.md).
//
// The gh-token-hygiene system tracks token age via a heartbeat stamp file;
// once the stamp exceeds the TTL the token is treated as stale and rotated
// (logged out), which strands any recurring gh loop between ticks. A loop
// that is ACTIVELY and successfully using the token is proof of liveness,
// so each tick re-stamps — but only after PROBING that the token actually
// works. Stamping a dead token fresh would mask a real expiry, so the probe
// gates the stamp (fail closed: no probe pass, no stamp).
//
// Usage: node scripts/fleet/gh-heartbeat.mts [--quiet]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
// oxlint-disable-next-line socket/prefer-async-spawn -- single bounded probe in a tiny CLI; sync keeps the exit-code contract trivial.
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { isMainModule } from './_shared/is-main-module.mts'

const logger = getDefaultLogger()

export interface HeartbeatOptions {
  readonly homeDir?: string | undefined
  readonly probe?: (() => boolean) | undefined
}

export function heartbeatStampPath(homeDir: string): string {
  return path.join(homeDir, '.claude', 'gh-token-issued-at')
}

// Liveness probe — the same shape the hygiene guard uses: one cheap
// authenticated API call, timeout-bounded so a network blackout can't hang
// the caller.
export function probeGhToken(): boolean {
  const result = spawnSync('gh', ['api', 'user', '--jq', '.login'], {
    stdio: 'pipe',
    timeout: 5000,
  })
  return result.status === 0
}

export interface HeartbeatResult {
  readonly reason: string
  readonly stamped: boolean
}

// Re-stamp the heartbeat when (and only when) the token demonstrably works.
export function refreshGhHeartbeat(
  options?: HeartbeatOptions | undefined,
): HeartbeatResult {
  const opts = { __proto__: null, ...options }
  const homeDir = opts.homeDir ?? os.homedir()
  const probe = opts.probe ?? probeGhToken
  if (!probe()) {
    return {
      reason:
        'gh token probe failed — not stamping. Where: gh api user. Saw: non-zero exit; wanted: authenticated 200. Fix: re-auth with `gh auth login -h github.com -w`, then re-run.',
      stamped: false,
    }
  }
  const stampFile = heartbeatStampPath(homeDir)
  const previous = existsSync(stampFile)
    ? Number(readFileSync(stampFile, 'utf8'))
    : undefined
  mkdirSync(path.dirname(stampFile), { recursive: true })
  writeFileSync(stampFile, String(Date.now()))
  const age =
    previous !== undefined && Number.isFinite(previous)
      ? `${Math.round((Date.now() - previous) / 60_000)}min old`
      : 'absent'
  return { reason: `stamp refreshed (was ${age})`, stamped: true }
}

function main(): void {
  const quiet = process.argv.includes('--quiet')
  const result = refreshGhHeartbeat()
  if (!result.stamped) {
    logger.fail(`[gh-heartbeat] ${result.reason}`)
    process.exitCode = 1
    return
  }
  if (!quiet) {
    logger.success(`[gh-heartbeat] ${result.reason}`)
  }
}

if (isMainModule(import.meta.url)) {
  main()
}
