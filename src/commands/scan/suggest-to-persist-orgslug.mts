import { logger } from '@socketsecurity/registry/lib/logger'
import { select } from '@socketsecurity/registry/lib/prompts'

import { getConfigValue, updateConfigValue } from '../../utils/config.mts'

export async function suggestToPersistOrgSlug(orgSlug: string): Promise<void> {
  const skipAsk = getConfigValue('skipAskToPersistDefaultOrg')
  if (!skipAsk.ok || skipAsk.data) {
    // Don't ask to store it when disabled before, or when reading config fails.
    return
  }

  const result = await select<string>({
    message: `Would you like to use this org (${orgSlug}) as the default org for future calls?`,
    choices: [
      {
        name: 'Yes',
        value: 'yes',
        description: 'Stores it in your config',
      },
      {
        name: 'No',
        value: 'no',
        description: 'Do not persist this org as default org',
      },
      {
        name: "No and don't ask again",
        value: 'sush',
        description:
          'Do not store as default org and do not ask again to persist it',
      },
    ],
  })
  if (result === 'yes') {
    const updateResult = updateConfigValue('defaultOrg', orgSlug)
    if (updateResult.ok) {
      logger.success('Updated default org config to:', orgSlug)
    } else {
      logger.fail(
        '(Non blocking) Failed to update default org in config:',
        updateResult.cause,
      )
    }
  } else if (result === 'sush') {
    const updateResult = updateConfigValue('skipAskToPersistDefaultOrg', true)
    if (updateResult.ok) {
      logger.info('Default org not changed. Will not ask to persist again.')
    } else {
      logger.fail(
        `(Non blocking) Failed to store preference; will ask to persist again next time. Reason: ${updateResult.cause}`,
      )
    }
  }
}
