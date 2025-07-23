import { debugDir } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'

import { npmFix } from './npm-fix.mts'
import { outputFixResult } from './output-fix-result.mts'
import { pnpmFix } from './pnpm-fix.mts'
import { CMD_NAME } from './shared.mts'
import constants from '../../constants.mts'
import { handleApiCall } from '../../utils/api.mts'
import { cmdFlagValueToArray } from '../../utils/cmd.mts'
import { spawnCoana } from '../../utils/coana.mts'
import { detectAndValidatePackageEnvironment } from '../../utils/package-environment.mts'
import { getPackageFilesForScan } from '../../utils/path-resolve.mts'
import { setupSdk } from '../../utils/sdk.mts'
import { fetchSupportedScanFileNames } from '../scan/fetch-supported-scan-file-names.mts'

import type { FixConfig } from './agent-fix.mts'
import type { CResult, OutputKind } from '../../types.mts'
import type { Remap } from '@socketsecurity/registry/lib/objects'

export type HandleFixConfig = Remap<
  FixConfig & {
    ghsas: string[]
    orgSlug: string
    outputKind: OutputKind
    unknownFlags: string[]
  }
>

export async function handleFix({
  autoMerge,
  cwd,
  ghsas,
  limit,
  minSatisfying,
  orgSlug,
  outputKind,
  prCheck,
  purls,
  rangeStyle,
  spinner,
  test,
  testScript,
  unknownFlags,
}: HandleFixConfig) {
  if (ghsas.length === 1 && ghsas[0] === 'auto') {
    let lastCResult: CResult<any>
    const sockSdkCResult = await setupSdk()

    lastCResult = sockSdkCResult
    const sockSdk = sockSdkCResult.ok ? sockSdkCResult.data : undefined

    const supportedFilesCResult = sockSdk
      ? await fetchSupportedScanFileNames()
      : undefined

    if (supportedFilesCResult) {
      lastCResult = supportedFilesCResult
    }

    const supportedFiles = supportedFilesCResult?.ok
      ? supportedFilesCResult.data
      : undefined

    const packagePaths = supportedFiles
      ? await getPackageFilesForScan(['.'], supportedFiles!, {
          cwd,
        })
      : []

    const uploadCResult = sockSdk
      ? await handleApiCall(
          sockSdk?.uploadManifestFiles(orgSlug, packagePaths),
          {
            desc: 'upload manifests',
          },
        )
      : undefined

    if (uploadCResult) {
      lastCResult = uploadCResult
    }

    const tarHash = uploadCResult?.ok ? (uploadCResult as any).data.tarHash : ''

    const idsOutputCResult = tarHash
      ? await spawnCoana(
          [
            'compute-fixes-and-upgrade-purls',
            cwd,
            '--manifests-tar-hash',
            tarHash,
          ],
          { cwd, spinner, env: { SOCKET_ORG_SLUG: orgSlug } },
        )
      : undefined

    if (idsOutputCResult) {
      lastCResult = idsOutputCResult
    }

    const idsOutput = idsOutputCResult?.ok
      ? (idsOutputCResult.data as string)
      : ''

    const ids = cmdFlagValueToArray(
      /(?<=Vulnerabilities found: )[^\n]+/.exec(idsOutput)?.[0],
    )

    const fixCResult = ids.length
      ? await spawnCoana(
          [
            'compute-fixes-and-upgrade-purls',
            cwd,
            '--manifests-tar-hash',
            tarHash,
            '--apply-fixes-to',
            ...ids,
            ...unknownFlags,
          ],
          { cwd, spinner, env: { SOCKET_ORG_SLUG: orgSlug } },
        )
      : undefined

    if (fixCResult) {
      lastCResult = fixCResult
    }
    // const fixCResult = await spawnCoana(
    //   [
    //     cwd,
    //     '--socket-mode',
    //     DOT_SOCKET_DOT_FACTS_JSON,
    //     '--manifests-tar-hash',
    //     tarHash,
    //     ...unknownFlags,
    //   ],
    //   { cwd, spinner, env: { SOCKET_ORG_SLUG: orgSlug } },
    // )
    debugDir('inspect', { lastCResult })

    if (!lastCResult.ok) {
      await outputFixResult(lastCResult, outputKind)
      return
    }

    await outputFixResult(
      {
        ok: true,
        data: '',
      },
      outputKind,
    )
    return
  }

  const pkgEnvCResult = await detectAndValidatePackageEnvironment(cwd, {
    cmdName: CMD_NAME,
    logger,
  })
  if (!pkgEnvCResult.ok) {
    await outputFixResult(pkgEnvCResult, outputKind)
    return
  }

  const { data: pkgEnvDetails } = pkgEnvCResult
  if (!pkgEnvDetails) {
    await outputFixResult(
      {
        ok: false,
        message: 'No package found.',
        cause: `No valid package environment found for project path: ${cwd}`,
      },
      outputKind,
    )
    return
  }

  // Lazily access constants.
  const { NPM, PNPM } = constants
  const { agent, agentVersion } = pkgEnvDetails
  if (agent !== NPM && agent !== PNPM) {
    await outputFixResult(
      {
        ok: false,
        message: 'Not supported.',
        cause: `${agent} v${agentVersion} is not supported by this command.`,
      },
      outputKind,
    )
    return
  }

  logger.info(`Fixing packages for ${agent} v${agentVersion}.\n`)

  const fixer = agent === NPM ? npmFix : pnpmFix
  await outputFixResult(
    await fixer(pkgEnvDetails, {
      autoMerge,
      cwd,
      limit,
      minSatisfying,
      prCheck,
      purls,
      rangeStyle,
      spinner,
      test,
      testScript,
    }),
    outputKind,
  )
}
