import { logger } from '@socketsecurity/registry/lib/logger'
import { select } from '@socketsecurity/registry/lib/prompts'

import { isReadOnlyConfig, updateConfigValue } from '../../utils/config'
import { failMsgWithBadge } from '../../utils/fail-msg-with-badge'
import { serializeResultJson } from '../../utils/serialize-result-json'

import type { CResult, OutputKind } from '../../types'
import type { LocalConfig } from '../../utils/config'

export async function outputConfigAuto(
  key: keyof LocalConfig,
  result: CResult<unknown>,
  outputKind: OutputKind
) {
  if (!result.ok) {
    process.exitCode = result.code ?? 1
  }

  if (outputKind === 'json') {
    logger.log(serializeResultJson(result))
  }
  if (outputKind !== 'markdown' && !result.ok) {
    logger.fail(failMsgWithBadge(result.message, result.cause))
  } else if (outputKind === 'markdown') {
    logger.log(`# Auto discover config value`)
    logger.log('')
    logger.log(
      `Attempted to automatically discover the value for config key: "${key}"`
    )
    logger.log('')
    if (result.ok) {
      logger.log(`The discovered value is: "${result.data}"`)
      if (result.message) {
        logger.log('')
        logger.log(result.message)
      }
    }
    logger.log('')
  } else {
    if (result.message) {
      logger.log(result.message)
      logger.log('')
    }
    logger.log(`- ${key}: ${result.data}`)
    logger.log('')

    if (isReadOnlyConfig()) {
      logger.log(
        '(Unable to persist this value because the config is in read-only mode, meaning it was overridden through env or flag.)'
      )
    } else if (key === 'defaultOrg') {
      const proceed = await select<string>({
        message:
          'Would you like to update the default org in local config to this value?',
        choices: (Array.isArray(result.data) ? result.data : [result.data])
          .map(slug => ({
            name: 'Yes [' + slug + ']',
            value: slug,
            description: `Use "${slug}" as the default organization`
          }))
          .concat({
            name: 'No',
            value: '',
            description: 'Do not use any of these organizations'
          })
      })
      if (proceed) {
        logger.log(`Setting defaultOrg to "${proceed}"...`)
        const updateResult = updateConfigValue('defaultOrg', proceed)
        if (updateResult.ok) {
          logger.log(
            `OK. Updated defaultOrg to "${proceed}".\nYou should no longer need to add the org to commands that normally require it.`
          )
        } else {
          logger.log(failMsgWithBadge(updateResult.message, updateResult.cause))
        }
      } else {
        logger.log('OK. No changes made.')
      }
    } else if (key === 'enforcedOrgs') {
      const proceed = await select<string>({
        message:
          'Would you like to update the enforced orgs in local config to this value?',
        choices: (Array.isArray(result.data) ? result.data : [result.data])
          .map(slug => ({
            name: 'Yes [' + slug + ']',
            value: slug,
            description: `Enforce the security policy of "${slug}" on this machine`
          }))
          .concat({
            name: 'No',
            value: '',
            description: 'Do not use any of these organizations'
          })
      })
      if (proceed) {
        logger.log(`Setting enforcedOrgs key to "${proceed}"...`)
        const updateResult = updateConfigValue('defaultOrg', proceed)
        if (updateResult.ok) {
          logger.log(`OK. Updated enforcedOrgs to "${proceed}".`)
        } else {
          logger.log(failMsgWithBadge(updateResult.message, updateResult.cause))
        }
      } else {
        logger.log('OK. No changes made.')
      }
    }
  }
}
