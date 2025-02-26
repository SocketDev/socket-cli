import type { Flag } from 'meow'

// TODO: not sure if I'm missing something but meow doesn't seem to expose this?
type StringFlag = Flag<'string', string> | Flag<'string', string[], true>
type BooleanFlag = Flag<'boolean', boolean> | Flag<'boolean', boolean[], true>
type NumberFlag = Flag<'number', number> | Flag<'number', number[], true>
type AnyFlag = StringFlag | BooleanFlag | NumberFlag

// Note: we use this description in getFlagListOutput, meow doesn't care
export type MeowFlags = Record<string, AnyFlag & { description: string }>

export const commonFlags: MeowFlags = {
  help: {
    type: 'boolean',
    default: false,
    shortFlag: 'h',
    description: 'Print this help.'
  },
  dryRun: {
    type: 'boolean',
    default: false,
    description: 'Do input validation for a command and exit 0 when input is ok'
  }
}

export const outputFlags: MeowFlags = {
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

export const validationFlags: MeowFlags = {
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
