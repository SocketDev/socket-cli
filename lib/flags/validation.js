import { prepareFlags } from '../utils/flags.js'

export const validationFlags = prepareFlags({
  all: {
    type: 'boolean',
    default: false,
  description: 'Include all issues',
  },
  strict: {
    type: 'boolean',
    default: false,
  description: 'Exits with an error code if any matching issues are found',
  },
})
