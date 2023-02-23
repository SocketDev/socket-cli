import { prepareFlags } from '../utils/flags.js'

export const outputFlags = prepareFlags({
  json: {
    type: 'boolean',
    alias: 'j',
    default: false,
  description: 'Output result as json',
  },
  markdown: {
    type: 'boolean',
    alias: 'm',
    default: false,
  description: 'Output result as markdown',
  },
})
