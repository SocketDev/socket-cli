#!/usr/bin/env node
/**
 * @file Code-as-law for the release-version discipline: a PUBLISHABLE lib's
 *   package.json version must be a `X.Y.Z-prerelease` HINT on the dev branch —
 *   the agent NEVER hand-sets a bare release version; the publish/release
 *   script owns the bare `X.Y.Z` (it strips the `-prerelease` suffix at
 *   publish). This pairs the fleet memory "agent triggers releases via the
 *   gated publish script; the script owns the bump" with an enforcer.
 *   Enrollment: a publishable manifest — `private` is not true AND
 *   `publishConfig` is declared (the fleet's publishable-manifest marker).
 *   Non-publishable repos (apps, tools, the wheelhouse itself) no-op. PASS
 *   when: not enrolled; OR the version carries a prerelease/build suffix (the
 *   hint); OR the version is bare BUT HEAD is the release-bump commit (`chore:
 *   bump version to <version>`) — the transient released state. FAIL when:
 *   enrolled + a bare version on a non-release commit (a hand-bump, or a
 *   missing `-prerelease` hint). Fail-OPEN when git can't be read (a bare
 *   version we can't attribute to a release commit is not asserted a
 *   violation). Usage: node
 *   scripts/fleet/check/publishable-version-is-prerelease-hint.mts [--quiet]
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

export interface VersionHintInput {
  hasPublishConfig: boolean
  headSubject: string | undefined
  isPrivate: boolean
  version: string
}

export interface VersionHintResult {
  ok: boolean
  reason: string
}

/**
 * A prerelease/build-suffixed version (`6.1.0-prerelease`, `1.2.3-rc.1`) — the
 * dev-cycle hint. A bare `X.Y.Z` is not a hint.
 */
export function isPrereleaseHint(version: string): boolean {
  return version.includes('-') || version.includes('+')
}

/**
 * True when `subject` is the canonical release-bump commit for `version`
 * (`chore: bump version to <version>`) — the one place a bare version is valid.
 */
export function isReleaseBumpSubject(
  subject: string,
  version: string,
): boolean {
  return subject.trim() === `chore: bump version to ${version}`
}

/**
 * Pure evaluator (the testable core). See the @file header for the PASS/FAIL
 * matrix. Fail-open: a bare version with no readable HEAD subject is not
 * asserted a violation.
 */
export function evaluateVersionHint(
  input: VersionHintInput,
): VersionHintResult {
  const { hasPublishConfig, headSubject, isPrivate, version } = {
    __proto__: null,
    ...input,
  } as VersionHintInput
  if (isPrivate || !hasPublishConfig) {
    return { ok: true, reason: 'not a publishable manifest — skipped' }
  }
  if (isPrereleaseHint(version)) {
    return { ok: true, reason: `-prerelease hint present (${version})` }
  }
  if (headSubject === undefined) {
    return { ok: true, reason: 'bare version but HEAD unreadable — fail-open' }
  }
  if (isReleaseBumpSubject(headSubject, version)) {
    return { ok: true, reason: 'bare version on the release-bump commit' }
  }
  return {
    ok: false,
    reason:
      `bare version "${version}" on a non-release commit — set ` +
      `"${version}-prerelease" (the publish/release script owns the bare bump).`,
  }
}

function readHeadSubject(repoRoot: string): string | undefined {
  const r = spawnSync('git', ['log', '-1', '--format=%s'], {
    cwd: repoRoot,
    stdio: 'pipe',
    stdioString: true,
    timeout: 5000,
  })
  const out = String(r.stdout ?? '').trim()
  return r.status === 0 && out ? out : undefined
}

function main(): void {
  const quiet = process.argv.includes('--quiet')
  let pkg: { private?: unknown; publishConfig?: unknown; version?: unknown }
  try {
    pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'))
  } catch {
    // No/unreadable package.json — nothing publishable to check.
    return
  }
  const version = typeof pkg.version === 'string' ? pkg.version : ''
  if (!version) {
    return
  }
  const result = evaluateVersionHint({
    hasPublishConfig: Boolean(pkg.publishConfig),
    headSubject: readHeadSubject(REPO_ROOT),
    isPrivate: pkg.private === true,
    version,
  })
  if (result.ok) {
    if (!quiet) {
      logger.success(
        `[publishable-version-is-prerelease-hint] ${result.reason}`,
      )
    }
    return
  }
  logger.error(
    `[publishable-version-is-prerelease-hint] ${result.reason}\n` +
      '  Why: the agent never hand-bumps to a bare release version — the ' +
      'publish/release script strips the -prerelease hint at publish.',
  )
  process.exitCode = 1
}

if (isMainModule(import.meta.url)) {
  main()
}
