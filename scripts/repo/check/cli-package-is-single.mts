import { readFileSync } from 'node:fs'
import path from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { parseVersion } from '@socketsecurity/lib-stable/versions/parse'

import { REPO_ROOT } from '../../fleet/paths.mts'
import { isMainModule } from '../../fleet/process/is-main-module.mts'
import { runMain } from '../../fleet/process/run-main.mts'

const logger = getDefaultLogger()

export interface CliPackageShape {
  name?: string | undefined
  private?: boolean | undefined
  version?: string | undefined
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

if (isMainModule(import.meta.url)) {
  runMain(main, {
    describe:
      'checks the single-package CLI layout and 2.x prerelease identity',
    help: 'Usage: pnpm run check:cli-package [--json]',
  })
}
