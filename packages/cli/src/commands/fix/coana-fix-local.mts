import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { joinAnd } from '@socketsecurity/lib-stable/arrays/join'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { checkCiEnvVars, getCiEnvInstructions } from './env-helpers.mts'
import { FLAG_DRY_RUN } from '../../constants/cli.mts'
import { spawnCoanaDlx } from '../../util/dlx/spawn.mjs'

import type { GhsaFixResult } from './coana-fix-ci.mts'
import type { FixConfig } from './types.mts'
import type { CResult } from '../../types.mts'
const logger = getDefaultLogger()

export async function runLocalCoanaFix(
  fixConfig: FixConfig,
  context: {
    coanaSilenceArgs: string[]
    coanaStdio: 'ignore' | 'inherit'
    shouldDiscoverGhsaIds: boolean
    tarHash: string
  },
): Promise<CResult<{ fixedAll: boolean; ghsaDetails: GhsaFixResult[] }>> {
  const {
    all,
    applyFixes,
    coanaVersion,
    cwd,
    debug: debugFlag,
    disableExternalToolChecks,
    disableMajorUpdates,
    ecosystems,
    exclude,
    ghsas,
    include,
    minimumReleaseAge,
    outputFile,
    prLimit,
    showAffectedDirectDependencies,
    spinner,
  } = fixConfig
  const { coanaSilenceArgs, coanaStdio, shouldDiscoverGhsaIds, tarHash } =
    context

  // In local mode, if neither --all nor --id is provided, show deprecation warning.
  if (shouldDiscoverGhsaIds && !all) {
    logger.warn(
      'Implicit --all is deprecated in local mode and will be removed in a future release. Please use --all explicitly.',
    )
  }

  // Inform user about local mode when fixes will be applied.
  if (applyFixes && ghsas.length) {
    const envCheck = checkCiEnvVars()
    if (envCheck.present.length) {
      // Some CI vars are set but not all - show what's missing.
      if (envCheck.missing.length) {
        logger.info(
          'Running in local mode - fixes will be applied directly to your working directory.\n' +
            `Missing environment variables for PR creation: ${joinAnd(envCheck.missing)}`,
        )
      }
    } else {
      // No CI vars are present - show general local mode message.
      logger.info(
        'Running in local mode - fixes will be applied directly to your working directory.\n' +
          getCiEnvInstructions(),
      )
    }
  }

  // In local mode, apply limit to provided IDs.
  const idsToProcess = shouldDiscoverGhsaIds ? ['all'] : ghsas.slice(0, prLimit)
  if (!idsToProcess.length) {
    spinner?.stop()
    return { ok: true, data: { fixedAll: false, ghsaDetails: [] } }
  }

  // Create a temporary file for the output.
  const tmpDir = os.tmpdir()
  const tmpFile = path.join(tmpDir, `socket-fix-${Date.now()}.json`)

  try {
    const fixCResult = await spawnCoanaDlx(
      [
        ...coanaSilenceArgs,
        'compute-fixes-and-upgrade-purls',
        cwd,
        '--manifests-tar-hash',
        tarHash,
        '--apply-fixes-to',
        ...idsToProcess,
        ...(fixConfig.rangeStyle
          ? ['--range-style', fixConfig.rangeStyle]
          : []),
        ...(minimumReleaseAge
          ? ['--minimum-release-age', minimumReleaseAge]
          : []),
        ...(include.length ? ['--include', ...include] : []),
        ...(exclude.length ? ['--exclude', ...exclude] : []),
        ...(ecosystems.length ? ['--purl-types', ...ecosystems] : []),
        ...(!applyFixes ? [FLAG_DRY_RUN] : []),
        '--output-file',
        tmpFile,
        ...(debugFlag ? ['--debug'] : []),
        ...(disableExternalToolChecks
          ? ['--disable-external-tool-checks']
          : []),
        ...(disableMajorUpdates ? ['--disable-major-updates'] : []),
        ...(showAffectedDirectDependencies
          ? ['--show-affected-direct-dependencies']
          : []),
        ...fixConfig.unknownFlags,
      ],
      fixConfig.orgSlug,
      { coanaVersion, cwd, spinner, stdio: coanaStdio },
    )

    spinner?.stop()

    if (!fixCResult.ok) {
      return fixCResult
    }

    // Copy to outputFile if provided.
    if (outputFile) {
      // Status message — belongs on stderr so stdout stays payload-only
      // when a consumer is piping `socket fix --json`.
      logger.error(`Copying fixes result to ${outputFile}`)
      const tmpContent = await fs.readFile(tmpFile, 'utf8')
      await fs.writeFile(outputFile, tmpContent, 'utf8')
    }

    return {
      ok: true,
      data: {
        fixedAll: true,
        ghsaDetails: idsToProcess.map(id => ({
          ghsaId: id,
          fixed: true,
        })),
      },
    }
  } finally {
    // Clean up the temporary file.
    await safeDelete(tmpFile, { force: true })
  }
}
