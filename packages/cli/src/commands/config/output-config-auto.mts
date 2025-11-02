import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { select } from '@socketsecurity/lib/stdio/prompts'

import { isConfigFromFlag, updateConfigValue } from '../../utils/config.mts'
import { failMsgWithBadge } from '../../utils/error/fail-msg-with-badge.mts'
import { mdHeader } from '../../utils/output/markdown.mts'
import { serializeResultJson } from '../../utils/output/result-json.mjs'

import type { CResult, OutputKind } from '../../types.mts'
import type { LocalConfig } from '../../utils/config.mts'

export async function outputConfigAuto(
  key: keyof LocalConfig,
  result: CResult<unknown>,
  outputKind: OutputKind,
) {
  if (!result.ok) {
    process.exitCode = result.code ?? 1
  }

  if (outputKind === 'json') {
    getDefaultLogger().log(serializeResultJson(result))
    return
  }
  if (!result.ok) {
    getDefaultLogger().fail(failMsgWithBadge(result.message, result.cause))
    return
  }

  if (outputKind === 'markdown') {
    getDefaultLogger().log(mdHeader('Auto discover config value'))
    getDefaultLogger().log('')
    getDefaultLogger().log(
      `Attempted to automatically discover the value for config key: "${key}"`,
    )
    getDefaultLogger().log('')
    if (result.ok) {
      getDefaultLogger().log(`The discovered value is: "${result.data}"`)
      if (result.message) {
        getDefaultLogger().log('')
        getDefaultLogger().log(result.message)
      }
    }
    getDefaultLogger().log('')
  } else {
    if (result.message) {
      getDefaultLogger().log(result.message)
      getDefaultLogger().log('')
    }
    getDefaultLogger().log(`- ${key}: ${result.data}`)
    getDefaultLogger().log('')

    if (isConfigFromFlag()) {
      getDefaultLogger().log(
        '(Unable to persist this value because the config is in read-only mode, meaning it was overridden through env or flag.)',
      )
    } else if (key === 'defaultOrg') {
      const proceed = await select({
        message:
          'Would you like to update the default org in local config to this value?',
        choices: (Array.isArray(result.data) ? result.data : [result.data])
          .map(slug => ({
            name: `Yes [${slug}]`,
            value: slug,
            description: `Use "${slug}" as the default organization`,
          }))
          .concat({
            name: 'No',
            value: '',
            description: 'Do not use any of these organizations',
          }),
      })
      if (proceed) {
        getDefaultLogger().log(`Setting defaultOrg to "${proceed}"...`)
        const updateResult = updateConfigValue('defaultOrg', proceed)
        if (updateResult.ok) {
          getDefaultLogger().log(
            `OK. Updated defaultOrg to "${proceed}".\nYou should no longer need to add the org to commands that normally require it.`,
          )
        } else {
          getDefaultLogger().log(
            failMsgWithBadge(updateResult.message, updateResult.cause),
          )
        }
      } else {
        getDefaultLogger().log('OK. No changes made.')
      }
    } else if (key === 'enforcedOrgs') {
      const proceed = await select({
        message:
          'Would you like to update the enforced orgs in local config to this value?',
        choices: (Array.isArray(result.data) ? result.data : [result.data])
          .map(slug => ({
            name: `Yes [${slug}]`,
            value: slug,
            description: `Enforce the security policy of "${slug}" on this machine`,
          }))
          .concat({
            name: 'No',
            value: '',
            description: 'Do not use any of these organizations',
          }),
      })
      if (proceed) {
        getDefaultLogger().log(`Setting enforcedOrgs key to "${proceed}"...`)
        const updateResult = updateConfigValue('defaultOrg', proceed)
        if (updateResult.ok) {
          getDefaultLogger().log(`OK. Updated enforcedOrgs to "${proceed}".`)
        } else {
          getDefaultLogger().log(
            failMsgWithBadge(updateResult.message, updateResult.cause),
          )
        }
      } else {
        getDefaultLogger().log('OK. No changes made.')
      }
    }
  }
}
