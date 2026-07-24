/**
 * @file Prepares the `@socketsecurity/cli.exe.<triplet>` tail packages for a
 *   staged publish. Sets version + buildMethod and strips the private field;
 *   the binary must already be in place from the SEA build. Publishes go
 *   through the staged npm-publish pipeline — this script never publishes.
 *
 *   Usage:
 *     node scripts/repo/prepublish-cli-exe.mts --version=3.0.0 --all
 *     node scripts/repo/prepublish-cli-exe.mts --version=3.0.0 --triplet=darwin-arm64
 */

import { existsSync } from 'node:fs'

import { parseArgs } from '@socketsecurity/lib-stable/argv/parse'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  CLI_EXE_TRIPLETS,
  isCliExeTriplet,
} from 'package-builder/scripts/cli-exe-targets.mts'
import type { CliExeTriplet } from 'package-builder/scripts/cli-exe-targets.mts'
import {
  getCliExeBinaryPath,
  getCliExePackageDir,
} from 'package-builder/scripts/paths.mts'
import { preparePackageForPublish } from 'package-builder/scripts/util/prepare-package.mts'

const logger = getDefaultLogger()

interface PrepublishCliExeArgs {
  all?: boolean | undefined
  dev?: boolean | undefined
  method: string
  prod?: boolean | undefined
  triplet?: string | undefined
  version?: string | undefined
}

const { values } = parseArgs<PrepublishCliExeArgs>({
  options: {
    all: { type: 'boolean' },
    dev: { type: 'boolean' },
    method: { default: 'sea', type: 'string' },
    prod: { type: 'boolean' },
    triplet: { type: 'string' },
    version: { type: 'string' },
  },
})

const { all, method: buildMethod, triplet, version: providedVersion } = values

function prepareTriplet(t: CliExeTriplet, version: string): boolean {
  const packageDir = getCliExePackageDir(t)

  if (!existsSync(packageDir)) {
    logger.error(`Package directory not found: ${packageDir}`)
    logger.error(
      'Generate the tail packages first: pnpm --filter package-builder run generate:cli-exe',
    )
    return false
  }

  // Verify the binary exists — stamped by the SEA build.
  const binaryPath = getCliExeBinaryPath(t)
  if (!existsSync(binaryPath)) {
    logger.error(`Binary not found at ${binaryPath}`)
    logger.error('Run the SEA build first: pnpm run build:sea')
    return false
  }

  const { name } = preparePackageForPublish(packageDir, {
    buildMethod,
    version,
  })
  logger.log(`  ${name}@${version} ready at ${packageDir}`)
  return true
}

if (!all && !triplet) {
  logger.error(
    'Usage: prepublish-cli-exe.mts --version=3.0.0 [--all | --triplet=darwin-arm64] [--method=sea]',
  )
  process.exitCode = 1
} else if (!providedVersion) {
  logger.error('--version is required')
  process.exitCode = 1
} else if (triplet && !isCliExeTriplet(triplet)) {
  logger.error(
    `Unknown triplet "${triplet}" — expected one of: ${CLI_EXE_TRIPLETS.join(', ')}`,
  )
  process.exitCode = 1
} else {
  const version = providedVersion.replace(/^v/, '')
  const triplets: readonly CliExeTriplet[] = all
    ? CLI_EXE_TRIPLETS
    : [triplet as CliExeTriplet]

  let ok = true
  for (let i = 0, { length } = triplets; i < length; i += 1) {
    ok = prepareTriplet(triplets[i]!, version) && ok
  }

  if (!ok) {
    process.exitCode = 1
  } else {
    logger.log('')
    logger.success(
      `${triplets.length} cli.exe tail package${triplets.length > 1 ? 's' : ''} ready for the staged publish pipeline`,
    )
  }
}
