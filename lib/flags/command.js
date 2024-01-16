import { prepareFlags } from '../utils/flags.js'

export const commandFlags = prepareFlags({
  enable: {
    type: 'boolean',
    default: false,
    description: 'Enables the Socket npm/npx wrapper',
  },
  disable: {
    type: 'boolean',
    default: false,
    description: 'Disables the Socket npm/npx wrapper',
  }
})
