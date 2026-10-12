import { createConfigCommand } from './config-command-factory.mts'
import { handleConfigSet } from './config-set-command.mts'
import { CONFIG_KEY_API_TOKEN } from '../../constants/config.mts'
import {
  createRetiredSocketApiTokenFailure,
  isRetiredSocketApiToken,
} from '../../util/socket/retired-api-token.mts'

export const CMD_NAME = 'set'

export const cmdConfigSet = createConfigCommand({
  commandName: CMD_NAME,
  description: 'Update the value of a local CLI config item',
  hidden: false,
  needsValue: true,
  helpUsage: '<KEY> <VALUE>',
  helpDescription: `This is a crude way of updating the local configuration for this CLI tool.

    The CLI checks API tokens locally for one retired token. Other values may
    be rejected by the server. Use at your own risk.

    Note: use \`socket config unset\` to restore to defaults. Setting a key
    to \`undefined\` will not allow default values to be set on it.

    Keys:`,
  helpExamples: ['apiProxy https://example.com'],
  validate: ({ input }) => {
    const [key = '', ...rest] = input
    const value = rest.join(' ')
    if (key !== CONFIG_KEY_API_TOKEN || !isRetiredSocketApiToken(value)) {
      return []
    }
    const failure = createRetiredSocketApiTokenFailure<undefined>()
    const message = failure.ok
      ? 'The selected Socket API token is retired.'
      : (failure.cause ?? 'The selected Socket API token is retired.')
    return [
      {
        nook: true,
        test: false,
        message,
        fail: 'retired Socket API token',
      },
    ]
  },
  handler: handleConfigSet,
})
