import { prepareFlags } from '../utils/flags.js'

export const outputFlags = prepareFlags({
  json: {
    type: 'boolean',
    shortFlag: 'j',
    default: false,
  description: 'Output result as json',
  },
  markdown: {
    type: 'boolean',
    shortFlag: 'm',
    default: false,
  description: 'Output result as markdown',
  },
})
