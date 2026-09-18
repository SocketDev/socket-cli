import { readFileSync } from 'node:fs'
import path from 'node:path'

import { getEnvValue } from '@socketsecurity/lib-stable/env/rewire'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { parseVersion } from '@socketsecurity/lib-stable/versions/parse'

import { REPO_ROOT } from '../../fleet/paths.mts'
import { isMainModule } from '../../fleet/process/is-main-module.mts'
import { runMain } from '../../fleet/process/run-main.mts'

import type { ScriptMeta } from '../../fleet/process/run-main.mts'

const logger = getDefaultLogger()

// 2.x core, prerelease marker, UTC date, and seven lowercase SHA characters.
const RELEASE_VERSION_PATTERN =
  /^2\.\d+\.\d+-prerelease\.(\d{8})-([0-9a-f]{7})$/

export interface CliPackageShape {
  name?: string | undefined
  private?: boolean | undefined
  version?: string | undefined
}

export function checkCliReleaseVersion(config: {
  date: string
  distTag: string
  sha: string
  version: string
}): string[] {
  const findings: string[] = []
  const match = RELEASE_VERSION_PATTERN.exec(config.version)
  if (!match) {
    findings.push(
      'Release version must match 2.X.Y-prerelease.YYYYMMDD-SHA with a seven-character lowercase commit SHA.',
    )
  } else if (match[1] !== config.date || match[2] !== config.sha.slice(0, 7)) {
    findings.push(
      `Release version must end in prerelease.${config.date}-${config.sha.slice(0, 7)}.`,
    )
  }
  if (config.distTag !== 'prerelease') {
    findings.push('Socket CLI 2.x releases must use the prerelease dist-tag.')
  }
  return findings
}

export function checkCliPackageShape(
  manifest: CliPackageShape,
  publishedPackages: readonly string[],
): string[] {
  const findings: string[] = []
  if (manifest.name !== '@socketsecurity/cli' || manifest.private === true) {
    findings.push(
      'Root package must be the publishable @socketsecurity/cli package.',
    )
  }
  const version = manifest.version ? parseVersion(manifest.version) : undefined
  if (version?.major !== 2 || !version.prerelease.length) {
    findings.push('Root package version must identify a 2.x prerelease.')
  }
  if (
    publishedPackages.length !== 1 ||
    publishedPackages[0] !== '@socketsecurity/cli'
  ) {
    findings.push(
      'Release configuration must publish only @socketsecurity/cli.',
    )
  }
  return findings
}

export function main(): void {
  const manifest = JSON.parse(
    readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'),
  )
  const config = JSON.parse(
    readFileSync(
      path.join(REPO_ROOT, '.config', 'repo', 'socket-wheelhouse.json'),
      'utf8',
    ),
  )
  const findings = checkCliPackageShape(
    manifest,
    config.release?.publishedPackages ?? [],
  )
  const releaseVersionIndex = process.argv.indexOf('--release-version')
  if (releaseVersionIndex !== -1) {
    const releaseVersion = process.argv[releaseVersionIndex + 1] ?? ''
    const date = getEnvValue('SOCKET_RELEASE_DATE') ?? ''
    const distTag = getEnvValue('SOCKET_RELEASE_DIST_TAG') ?? ''
    const sha = getEnvValue('SOCKET_RELEASE_SHA') ?? ''
    findings.push(
      ...checkCliReleaseVersion({
        date,
        distTag,
        sha,
        version: releaseVersion,
      }),
    )
  }
  if (process.argv.includes('--json')) {
    logger.stdout.write(
      JSON.stringify({ ok: findings.length === 0, findings }) + '\n',
    )
  } else {
    for (const finding of findings) {
      logger.error(finding)
    }
  }
  if (findings.length) {
    process.exitCode = 1
  }
}

const SCRIPT_META: ScriptMeta = {
  describe: 'checks the single-package CLI layout and 2.x prerelease identity',
  help: 'Usage: pnpm run check:cli-package [--json] [--release-version VERSION]',
  json: 'native',
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
