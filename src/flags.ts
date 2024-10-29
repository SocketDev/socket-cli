export const commonFlags = {
  help: {
    type: 'boolean',
    default: false,
    shortFlag: 'h',
    description: 'Print this help.'
  }
}

export const commandFlags = {
  enable: {
    type: 'boolean',
    default: false,
    description: 'Enables the Socket npm/npx wrapper'
  },
  disable: {
    type: 'boolean',
    default: false,
    description: 'Disables the Socket npm/npx wrapper'
  }
}

export const outputFlags = {
  json: {
    type: 'boolean',
    shortFlag: 'j',
    default: false,
    description: 'Output result as json'
  },
  markdown: {
    type: 'boolean',
    shortFlag: 'm',
    default: false,
    description: 'Output result as markdown'
  }
}

export const validationFlags = {
  all: {
    type: 'boolean',
    default: false,
    description: 'Include all issues'
  },
  strict: {
    type: 'boolean',
    default: false,
    description: 'Exits with an error code if any matching issues are found'
  }
}
