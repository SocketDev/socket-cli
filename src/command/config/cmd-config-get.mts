import { createConfigCommand } from './config-command-factory.mts'
import { handleConfigGet } from './handle-config-get.mts'

export const cmdConfigGet = createConfigCommand({
  commandName: 'get',
  description: 'Get the value of a local CLI config item',
  hidden: false,
  helpUsage: 'KEY',
  helpDescription: `Retrieve the value for given KEY at this time. If you have overridden the
    config then the value will come from that override.

    KEY is an enum. Valid keys:`,
  helpExamples: ['defaultOrg'],
  handler: handleConfigGet,
})
