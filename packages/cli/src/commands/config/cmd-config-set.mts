import { createConfigCommand } from './config-command-factory.mts'
import { handleConfigSet } from './handle-config-set.mts'

export const CMD_NAME = 'set'

export const cmdConfigSet = createConfigCommand({
  commandName: CMD_NAME,
  description: 'Update the value of a local CLI config item',
  hidden: false,
  needsValue: true,
  helpUsage: '<KEY> <VALUE>',
  helpDescription: `This is a crude way of updating the local configuration for this CLI tool.

    Note that updating a value here is nothing more than updating a key/value
    store entry. No validation is happening. The server may reject your values
    in some cases. Use at your own risk.

    Note: use \`socket config unset\` to restore to defaults. Setting a key
    to \`undefined\` will not allow default values to be set on it.

    Keys:`,
  helpExamples: ['apiProxy https://example.com'],
  handler: handleConfigSet,
})
