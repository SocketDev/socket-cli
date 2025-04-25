import { logger } from '@socketsecurity/registry/lib/logger'
import { select } from '@socketsecurity/registry/lib/prompts'

import { isReadOnlyConfig, updateConfigValue } from '../../utils/config'
import { failMsgWithBadge } from '../../utils/fail-msg-with-badge'

import type { OutputKind } from '../../types'
import type { LocalConfig } from '../../utils/config'

export async function outputConfigAuto(
  key: keyof LocalConfig,
  {
    message,
    success,
    value
  }: {
    success: boolean
    value: unknown
    message: string
  },
  outputKind: OutputKind
) {
  if (outputKind === 'json') {
    logger.log(JSON.stringify({ success, message, result: { key, value } }))
  } else if (outputKind === 'markdown') {
    logger.log(`# Auto discover config value`)
    logger.log('')
    logger.log(
      `Attempted to automatically discover the value for config key: "${key}"`
    )
    logger.log('')
    if (success) {
      logger.log(`The discovered value is: "${value}"`)
      if (message) {
        logger.log('')
        logger.log(message)
      }
    } else {
      logger.log(`The discovery failed: ${message}`)
    }
    logger.log('')
  } else {
    if (message) {
      logger.log(message)
      logger.log('')
    }
    logger.log(`- ${key}: ${value}`)
    logger.log('')

    if (success) {
      if (isReadOnlyConfig()) {
        logger.log(
          '(Unable to persist this value because the config is in read-only mode, meaning it was overridden through env or flag.)'
        )
      } else if (key === 'defaultOrg') {
        const proceed = await select<string>({
          message:
            'Would you like to update the default org in local config to this value?',
          choices: (Array.isArray(value) ? value : [value])
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
            logger.log(
              failMsgWithBadge(updateResult.message, updateResult.data)
            )
          }
        } else {
          logger.log('OK. No changes made.')
        }
      } else if (key === 'enforcedOrgs') {
        const proceed = await select<string>({
          message:
            'Would you like to update the enforced orgs in local config to this value?',
          choices: (Array.isArray(value) ? value : [value])
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
            logger.log(
              failMsgWithBadge(updateResult.message, updateResult.data)
            )
          }
        } else {
          logger.log('OK. No changes made.')
        }
      }
    }
  }
}
