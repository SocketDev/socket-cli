import path from 'node:path'

import { debugDir } from '@socketsecurity/lib-stable/debug/output'

import { runCiCoanaFix } from './coana-fix-ci.mts'
import { runLocalCoanaFix } from './coana-fix-local.mts'
import { getFixEnv } from './env-helpers.mts'
import { DOT_SOCKET_DOT_FACTS_JSON } from '../../constants/paths.mts'
import { findSocketYmlSync } from '../../util/config.mts'
import { getPackageFilesForScan } from '../../util/fs/path-resolve.mjs'
import { handleApiCall } from '../../util/socket/api.mjs'
import { setupSdk } from '../../util/socket/sdk.mjs'
import { fetchSupportedScanFileNames } from '../scan/fetch-supported-scan-file-names.mts'

import type { FixConfig } from './types.mts'
import type { CResult } from '../../types.mts'
import type { GhsaFixResult } from './coana-fix-ci.mts'

export type { GhsaFixResult } from './coana-fix-ci.mts'

export async function coanaFix(
  fixConfig: FixConfig,
): Promise<CResult<{ fixedAll: boolean; ghsaDetails: GhsaFixResult[] }>> {
  const { all, cwd, ghsas, orgSlug, outputKind, spinner } = fixConfig

  // Under json/markdown mode we route coana's chatter away from our
  // stdout (its JSON report comes from --output-file, not stdout, so
  // coana stdout is entirely informational). 'ignore' drops it; that
  // was the previous behavior and it remains safe. When interactive we
  // inherit so the user sees coana progress in real-time.
  const coanaStdio = outputKind === 'json' ? 'ignore' : 'inherit'
  // Ask coana to silence its own Winston logger under json mode. Belt
  // and braces with stdio:'ignore' and harmless if coana ignores the
  // flag.
  const coanaSilenceArgs = outputKind === 'json' ? ['--silent'] : []

  const fixEnv = await getFixEnv()
  debugDir({ fixEnv })

  spinner?.start()

  const sockSdkCResult = await setupSdk()
  if (!sockSdkCResult.ok) {
    return sockSdkCResult
  }

  const sockSdk = sockSdkCResult.data

  const supportedFilesCResult = await fetchSupportedScanFileNames({ spinner })
  if (!supportedFilesCResult.ok) {
    return supportedFilesCResult
  }

  const supportedFiles = supportedFilesCResult.data

  // Load socket.yml so projectIgnorePaths is respected when collecting files.
  const socketYmlResult = findSocketYmlSync(cwd)
  const socketConfig = socketYmlResult.ok
    ? socketYmlResult.data?.parsed
    : undefined

  const scanFilepaths = await getPackageFilesForScan(['.'], supportedFiles, {
    config: socketConfig,
    cwd,
  })

  // Exclude any .socket.facts.json files that happen to be in the scan
  // folder before the analysis was run.
  const filepathsToUpload = scanFilepaths.filter(
    p => path.basename(p).toLowerCase() !== DOT_SOCKET_DOT_FACTS_JSON,
  )
  const uploadCResult = (await handleApiCall(
    sockSdk.uploadManifestFiles(orgSlug, filepathsToUpload, {
      pathsRelativeTo: cwd,
    }),
    {
      commandPath: 'socket fix',
      description: 'upload manifests',
      spinner,
    },
  )) as CResult<{ tarHash?: string | undefined }>

  if (!uploadCResult.ok) {
    return uploadCResult
  }

  const tarHash: string | undefined = uploadCResult.data.tarHash
  if (!tarHash) {
    spinner?.stop()
    return {
      ok: false,
      message:
        'No tar hash returned from Socket API upload-manifest-files endpoint',
      data: uploadCResult.data,
    }
  }

  const shouldDiscoverGhsaIds =
    all || !ghsas.length || (ghsas.length === 1 && ghsas[0] === 'all')

  const shouldOpenPrs = fixEnv.isCi && fixEnv.repoInfo

  if (!shouldOpenPrs) {
    return await runLocalCoanaFix(fixConfig, {
      coanaSilenceArgs,
      coanaStdio,
      shouldDiscoverGhsaIds,
      tarHash,
    })
  }

  return await runCiCoanaFix(fixConfig, {
    coanaSilenceArgs,
    coanaStdio,
    fixEnv,
    scanFilepaths,
    shouldDiscoverGhsaIds,
    tarHash,
  })
}
