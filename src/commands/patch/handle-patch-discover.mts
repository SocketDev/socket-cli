import { promises as fs } from 'node:fs'
import path from 'node:path'

import { UTF8 } from '@socketsecurity/registry/constants/encoding'
import { logger } from '@socketsecurity/registry/lib/logger'
import { normalizePath } from '@socketsecurity/registry/lib/path'
import { pluralize } from '@socketsecurity/registry/lib/words'

import { outputPatchDiscoverResult } from './output-patch-discover-result.mts'
import { getErrorCause } from '../../utils/error/errors.mjs'

import type { OutputKind } from '../../types.mts'
import type { Spinner } from '@socketsecurity/registry/lib/spinner'

export interface DiscoveredPatch {
  description: string | undefined
  license: string | undefined
  purl: string
  tier: string | undefined
  uuid: string | undefined
  vulnerabilities: Array<{
    cve?: string
    severity?: string
  }>
}

export interface HandlePatchDiscoverConfig {
  cwd: string
  outputKind: OutputKind
  spinner: Spinner
}

export async function handlePatchDiscover({
  cwd,
  outputKind,
  spinner,
}: HandlePatchDiscoverConfig): Promise<void> {
  try {
    spinner.start('Reading package dependencies')

    // Read package.json to get dependencies.
    const packageJsonPath = normalizePath(path.join(cwd, 'package.json'))
    const packageJsonContent = await fs.readFile(packageJsonPath, UTF8)
    const packageJson = JSON.parse(packageJsonContent)

    // Extract all dependencies.
    const dependencies = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
      ...packageJson.optionalDependencies,
    }

    const packageNames = Object.keys(dependencies)

    if (packageNames.length === 0) {
      spinner.stop()
      logger.log('No dependencies found in package.json')
      await outputPatchDiscoverResult(
        {
          ok: true,
          data: { patches: [] },
        },
        outputKind,
      )
      return
    }

    spinner.start(
      `Checking ${packageNames.length} ${pluralize('package', { count: packageNames.length })} for available patches`,
    )

    // TODO: Query Socket API for available patches.
    // This requires a new SDK endpoint to be implemented first.
    // For now, return empty results as a placeholder.
    const patches: DiscoveredPatch[] = []

    // Future implementation:
    // const apiKey = await getDefaultKey()
    // const sdk = createSocketSdk(apiKey)
    // const patches = await sdk.getAvailablePatches(packageNames)

    spinner.stop()

    if (patches.length === 0) {
      logger.log('No patches available for installed dependencies')
    } else {
      logger.log(
        `Found ${patches.length} available ${pluralize('patch', { count: patches.length })}`,
      )
    }

    await outputPatchDiscoverResult(
      {
        ok: true,
        data: { patches },
      },
      outputKind,
    )
  } catch (e) {
    spinner.stop()

    let message = 'Failed to discover patches'
    let cause = getErrorCause(e)

    if (e instanceof SyntaxError) {
      message = 'Invalid JSON in package.json'
      cause = e.message
    }

    await outputPatchDiscoverResult(
      {
        ok: false,
        code: 1,
        message,
        cause,
      },
      outputKind,
    )
  }
}
