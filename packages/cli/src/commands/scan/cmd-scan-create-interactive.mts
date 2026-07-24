import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { outputCreateNewScan } from './output-create-new-scan.mts'
import { suggestOrgSlug } from './suggest-org-slug.mts'
import { suggestTarget } from './suggest_target.mts'
import { SOCKET_JSON } from '../../constants.mts'
import { detectManifestActions } from '../manifest/detect-manifest-actions.mts'

import type { SocketJson } from '../../util/socket/json.mts'
import type { OutputKind } from '../../types.mjs'

const logger = getDefaultLogger()

export interface ScanCreateTargetsAndOrgInput {
  autoManifest: boolean | undefined
  cli: { input: readonly string[] }
  cwd: string
  dryRun: boolean
  hasApiToken: boolean
  interactive: boolean
  orgSlug: string
  outputKind: OutputKind
  sockJson: SocketJson
}

export interface ScanCreateTargetsAndOrgResult {
  canceled: boolean
  orgSlug: string
  targets: string[]
}

/**
 * Resolve interactive target/org suggestions for `socket scan create` and
 * print the "repeat this command" hint when the user answered a prompt.
 *
 * Returns `canceled: true` when the org selector prompt was dismissed —
 * the caller should stop the command in that case.
 */
export async function resolveScanCreateTargetsAndOrg(
  config: ScanCreateTargetsAndOrgInput,
): Promise<ScanCreateTargetsAndOrgResult> {
  const {
    autoManifest,
    cli,
    cwd,
    dryRun,
    hasApiToken,
    interactive,
    orgSlug,
    outputKind,
    sockJson,
  } = { __proto__: null, ...config } as typeof config

  let updatedInput = false

  // Accept zero or more paths. Default to cwd() if none given.
  let targets = cli.input.length ? [...cli.input] : [cwd]

  /* c8 ignore start - defensive: targets always has at least [cwd] from the line above */
  if (!targets.length && !dryRun && interactive) {
    targets = await suggestTarget()
    updatedInput = true
  }
  /* c8 ignore stop */

  let resolvedOrgSlug = orgSlug

  // If the current cwd is unknown and is used as a repo slug anyways, we will
  // first need to register the slug before we can use it.
  // Only do suggestions with an apiToken and when not in dryRun mode
  if (hasApiToken && !dryRun && interactive) {
    if (!resolvedOrgSlug) {
      const suggestion = await suggestOrgSlug()
      if (suggestion === undefined) {
        await outputCreateNewScan(
          {
            ok: false,
            message: 'Canceled by user',
            cause: 'Org selector was canceled by user',
          },
          {
            interactive: false,
            outputKind,
          },
        )
        return { canceled: true, orgSlug: resolvedOrgSlug, targets }
      }
      if (suggestion) {
        resolvedOrgSlug = suggestion
      }
      updatedInput = true
    }
  }

  const detected = await detectManifestActions(sockJson, cwd)
  if (detected.count > 0 && !autoManifest) {
    logger.info(
      `Detected ${detected.count} manifest targets we could try to generate. Please set the --auto-manifest flag if you want to include languages covered by \`socket manifest auto\` in the Scan.`,
    )
  }

  if (updatedInput && resolvedOrgSlug && targets.length) {
    logger.info(
      'Note: You can invoke this command next time to skip the interactive questions:',
    )
    logger.error('```')
    logger.error(
      `    socket scan create [other flags...] ${resolvedOrgSlug} ${targets.join(' ')}`,
    )
    logger.error('```')
    logger.error('')
    logger.info(
      `You can also run \`socket scan setup\` to persist these flag defaults to a ${SOCKET_JSON} file.`,
    )
    logger.error('')
  }

  return { canceled: false, orgSlug: resolvedOrgSlug, targets }
}
