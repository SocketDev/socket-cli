#!/usr/bin/env node
/**
 * @file `check --all` gate: assert no tracked shell / script / config file
 *   fetches from an off-allowlist CDN / host. The point-of-use
 *   `cdn-allowlist-guard` blocks a Claude `curl`/`wget` at Bash time; this is
 *   the commit-time twin that catches a fetch baked into a committed file
 *   (a setup script, a CI step, a Dockerfile RUN). Both read the same
 *   `_shared/cdn-allowlist.mts` so the allowlist never drifts (code is law,
 *   DRY).
 *
 *   Scans tracked text files for `http(s)://` URLs sitting on a fetch tool
 *   (`curl`/`wget`/`fetch`) and flags any whose host isn't allowlisted. The
 *   allowlist holds PUBLIC registries / CDNs only — an internal
 *   `*.svc.cluster.local` host is never on it, so a committed fetch to one is
 *   flagged (route it through the service client, don't allowlist it).
 *
 *   Exit codes: 0 — every committed fetch targets an allowlisted host (or none
 *   found); 1 — at least one off-allowlist fetch is committed.
 */

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { readFileSync } from 'node:fs'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { findDisallowedCdn } from '../../../.claude/hooks/fleet/_shared/cdn-allowlist.mts'

const logger = getDefaultLogger()

// Tracked text files worth scanning for a committed fetch. Shell / CI /
// container build steps are where a baked-in download lives.
const SCAN_GLOBS = [
  '*.sh',
  '*.bash',
  '*.zsh',
  '*.mts',
  '*.ts',
  '*.mjs',
  '*.js',
  '*.yml',
  '*.yaml',
  'Dockerfile',
  '*.Dockerfile',
]

function trackedFiles(): string[] {
  const args = ['ls-files', '--', ...SCAN_GLOBS]
  const result = spawnSync('git', args, { stdio: 'pipe' })
  if (result.status !== 0) {
    return []
  }
  const out =
    typeof result.stdout === 'string' ? result.stdout : String(result.stdout)
  return out.split('\n').filter(Boolean)
}

const offenders: Array<{ file: string; host: string; url: string }> = []
const files = trackedFiles()
for (let i = 0, { length } = files; i < length; i += 1) {
  const file = files[i]!
  let text = ''
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    continue
  }
  // Scan per line so a fetch command + its URL are seen together.
  const lines = text.split('\n')
  for (let j = 0, llen = lines.length; j < llen; j += 1) {
    const hit = findDisallowedCdn(lines[j]!)
    if (hit) {
      offenders.push({ file, host: hit.host, url: hit.url })
    }
  }
}

if (offenders.length === 0) {
  logger.log('cdn-allowlist: every committed fetch targets an allowlisted host.')
  process.exitCode = 0
} else {
  logger.error('')
  logger.error(
    `[cdn-allowlist] ${offenders.length} committed fetch(es) to off-allowlist hosts:`,
  )
  for (let i = 0, { length } = offenders; i < length; i += 1) {
    const o = offenders[i]!
    logger.error(`  ✗ ${o.file}: ${o.host} (${o.url})`)
  }
  logger.error('')
  logger.error(
    '  Fetch from an allowlisted public registry/CDN, or add the host to',
  )
  logger.error(
    '  ALLOWED_CDN_HOSTS in .claude/hooks/fleet/_shared/cdn-allowlist.mts',
  )
  logger.error('  (public hosts only — never an internal *.svc.cluster.local).')
  process.exitCode = 1
}
