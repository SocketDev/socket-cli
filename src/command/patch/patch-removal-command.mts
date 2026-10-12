import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import {
  getDefaultFormatting,
  stringifyWithFormatting,
} from '@socketsecurity/lib-stable/json/format'

import { getPatchManifestPaths } from '../../core/patch/manifest.mts'
import {
  planPatchRemoval,
  removePatchRecords,
} from '../../core/patch/remove.mts'
import { parsePatchLocalOptions, reportPatchError } from './local-options.mts'

const logger = getDefaultLogger()

export type PatchRemoveAction = 'apply' | 'preview'

export type PatchRemoveOutcome =
  | { status: 'manifest-not-found'; manifestPath: string }
  | { status: 'not-found'; identifier: string }
  | { status: 'removed'; removed: string[] }

export async function getPatchRemovalOutcome(
  projectRoot: string,
  identifier: string,
  action: PatchRemoveAction,
): Promise<PatchRemoveOutcome> {
  const plan = await planPatchRemoval(projectRoot, identifier)
  if (!plan.manifestFound) {
    const { manifestPath } = getPatchManifestPaths(projectRoot)
    return { status: 'manifest-not-found', manifestPath }
  }
  if (plan.removed.length === 0) {
    return { status: 'not-found', identifier }
  }

  const removed =
    action === 'preview'
      ? plan.removed
      : (await removePatchRecords(projectRoot, identifier)).removed
  if (removed.length === 0) {
    return { status: 'not-found', identifier }
  }
  return { status: 'removed', removed }
}

export async function runPatchRemove(
  args: readonly string[],
  action: PatchRemoveAction,
): Promise<void> {
  const options = parsePatchLocalOptions(args, 'remove')
  if (options.help) {
    logger.log('Remove a patch record without rolling back files.')
    logger.log('')
    logger.log(
      'Usage: socket patch remove <PURL-or-UUID> --skip-rollback [--cwd <directory>] [--json]',
    )
    process.exitCode = 0
    return
  }
  if (options.error || !options.identifier) {
    reportPatchError(
      options.json ? 'json' : 'text',
      'invalid_arguments',
      options.error || 'A patch PURL or UUID is required',
    )
    process.exitCode = 2
    return
  }

  try {
    const outcome = await getPatchRemovalOutcome(
      options.projectRoot,
      options.identifier,
      action,
    )
    if (outcome.status === 'manifest-not-found') {
      reportPatchError(
        options.json ? 'json' : 'text',
        'manifest_not_found',
        `Manifest not found at ${outcome.manifestPath}`,
      )
      process.exitCode = 1
      return
    }
    if (outcome.status === 'not-found') {
      reportPatchError(
        options.json ? 'json' : 'text',
        'not_found',
        `No patch found for ${outcome.identifier}`,
      )
      process.exitCode = 1
      return
    }

    process.exitCode = 0
    writePatchRemovalResult(
      outcome.removed,
      options.json ? 'json' : 'text',
      action,
    )
  } catch (error) {
    reportPatchError(
      options.json ? 'json' : 'text',
      'manifest_invalid',
      errorMessage(error),
    )
    process.exitCode = 1
  }
}

export function writePatchRemovalResult(
  removed: string[],
  output: 'json' | 'text',
  action: PatchRemoveAction,
): void {
  if (output === 'json') {
    const serialized = stringifyWithFormatting(
      {
        __proto__: null,
        status: 'success',
        dryRun: action === 'preview',
        removed,
      },
      getDefaultFormatting(),
    )
    logger.log(serialized.endsWith('\n') ? serialized.slice(0, -1) : serialized)
  } else {
    const verb = action === 'preview' ? 'Would remove' : 'Removed'
    const count = removed.length
    logger.log(
      `${verb} ${count} ${count === 1 ? 'patch' : 'patches'} from the manifest; files were not rolled back.`,
    )
  }
}
