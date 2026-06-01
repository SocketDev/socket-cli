import { createConfigCommand } from './config-command-factory.mts'
import { handleConfigUnset } from './handle-config-unset.mts'

export const CMD_NAME = 'unset'

export const cmdConfigUnset = createConfigCommand({
  commandName: CMD_NAME,
  description: 'Clear the value of a local CLI config item',
  hidden: false,
  helpUsage: '<KEY> <VALUE>',
  helpDescription: `Removes a value from a config key, allowing the default value to be used
    for it instead.

    Keys:`,
  helpExamples: ['defaultOrg'],
  handler: handleConfigUnset,
})
