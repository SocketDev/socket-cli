// CLI output formatting: multi-line user-facing messages where embedded \n
// produces the intended layout. Splitting into logger.log("") + logger.log(...)
// pairs is the canonical rewrite but doesnt preserve the visual flow for these
// specific outputs.
/* oxlint-disable-next-line socket/no-file-scope-oxlint-disable -- legitimate file-scope: domain-grouped layout or test fixture; per-call would produce many redundant disables. */
/* oxlint-disable socket/no-logger-newline-literal -- intended layout */
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { select } from '@socketsecurity/lib-stable/stdio/prompts'

import { isConfigFromFlag, updateConfigValue } from '../../util/config.mts'
import { failMsgWithBadge } from '../../util/error/fail-msg-with-badge.mts'
import { mdHeader } from '../../util/output/markdown.mts'
import { serializeResultJson } from '../../util/output/result-json.mjs'

import type { CResult, OutputKind } from '../../types.mts'
import type { LocalConfig } from '../../util/config.mts'
const logger = getDefaultLogger()

export async function outputConfigAuto(
  key: keyof LocalConfig,
  result: CResult<unknown>,
  outputKind: OutputKind,
) {
  if (!result.ok) {
    process.exitCode = result.code ?? 1
  }

  if (outputKind === 'json') {
    logger.log(serializeResultJson(result))
    return
  }
  if (!result.ok) {
    logger.fail(failMsgWithBadge(result.message, result.cause))
    return
  }

  if (outputKind === 'markdown') {
    logger.log(mdHeader('Auto discover config value'))
    logger.log('')
    logger.log(
      `Attempted to automatically discover the value for config key: "${key}"`,
    )
    logger.log('')
    if (result.ok) {
      logger.log(`The discovered value is: "${String(result.data)}"`)
      if (result.message) {
        logger.log('')
        logger.log(result.message)
      }
    }
    logger.log('')
    return
  }
  await outputDiscoveredConfigText(key, result.data, result.message)
}

export async function outputDiscoveredConfigText(
  key: keyof LocalConfig,
  data: unknown,
  message: string | undefined,
): Promise<void> {
  if (message) {
    logger.log(message)
    logger.log('')
  }
  logger.log(`- ${key}: ${String(data)}`)
  logger.log('')
  if (isConfigFromFlag()) {
    logger.log(
      '(Unable to persist this value because the config is in read-only mode, meaning it was overridden through env or flag.)',
    )
    return
  }
  if (key === 'defaultOrg') {
    await persistDefaultOrg(data)
  } else if (key === 'enforcedOrgs') {
    await persistEnforcedOrgs(data)
  }
}

export async function persistDefaultOrg(data: unknown): Promise<void> {
  const proceed = await select({
    message:
      'Would you like to update the default org in local config to this value?',
    choices: (Array.isArray(data) ? data : [data])
      .map(slug => ({
        __proto__: null,
        name: `Yes [${slug}]`,
        value: slug,
        description: `Use "${slug}" as the default organization`,
      }))
      .concat({
        __proto__: null,
        name: 'No',
        value: '',
        description: 'Do not use any of these organizations',
      }),
  })
  if (!proceed) {
    logger.log('OK. No changes made.')
    return
  }
  logger.log(`Setting defaultOrg to "${proceed}"...`)
  const updateResult = updateConfigValue('defaultOrg', proceed)
  logger.log(
    updateResult.ok
      ? `OK. Updated defaultOrg to "${proceed}".\nYou should no longer need to add the org to commands that normally require it.`
      : failMsgWithBadge(updateResult.message, updateResult.cause),
  )
}

export async function persistEnforcedOrgs(data: unknown): Promise<void> {
  const proceed = await select({
    message:
      'Would you like to update the enforced orgs in local config to this value?',
    choices: (Array.isArray(data) ? data : [data])
      .map(slug => ({
        __proto__: null,
        name: `Yes [${slug}]`,
        value: slug,
        description: `Enforce the security policy of "${slug}" on this machine`,
      }))
      .concat({
        __proto__: null,
        name: 'No',
        value: '',
        description: 'Do not use any of these organizations',
      }),
  })
  if (!proceed) {
    logger.log('OK. No changes made.')
    return
  }
  logger.log(`Setting enforcedOrgs key to "${proceed}"...`)
  const updateResult = updateConfigValue('defaultOrg', proceed)
  logger.log(
    updateResult.ok
      ? `OK. Updated enforcedOrgs to "${proceed}".`
      : failMsgWithBadge(updateResult.message, updateResult.cause),
  )
}
