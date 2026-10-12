import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  formatPatchListJson,
  formatPatchListText,
} from '../../core/patch/list.mts'
import {
  getPatchManifestPaths,
  readPatchManifest,
} from '../../core/patch/manifest.mts'
import { parsePatchLocalOptions, reportPatchError } from './local-options.mts'

const logger = getDefaultLogger()

export async function runPatchList(args: readonly string[]): Promise<void> {
  const options = parsePatchLocalOptions(args, 'list')
  if (options.help) {
    logger.log('List patches in the local manifest.')
    logger.log('')
    logger.log('Usage: socket patch list [--cwd <directory>] [--json]')
    process.exitCode = 0
    return
  }
  if (options.error) {
    reportPatchError(
      options.json ? 'json' : 'text',
      'invalid_arguments',
      options.error,
    )
    process.exitCode = 2
    return
  }

  try {
    const manifest = await readPatchManifest(options.projectRoot)
    if (!manifest) {
      const { manifestPath } = getPatchManifestPaths(options.projectRoot)
      reportPatchError(
        options.json ? 'json' : 'text',
        'manifest_not_found',
        `Manifest not found at ${manifestPath}`,
      )
      process.exitCode = 1
      return
    }

    process.exitCode = 0
    const output = options.json
      ? formatPatchListJson(manifest)
      : formatPatchListText(manifest)
    logger.log(output.endsWith('\n') ? output.slice(0, -1) : output)
  } catch (error) {
    reportPatchError(
      options.json ? 'json' : 'text',
      'manifest_invalid',
      errorMessage(error),
    )
    process.exitCode = 1
  }
}
