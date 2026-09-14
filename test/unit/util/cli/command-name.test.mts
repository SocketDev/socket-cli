import { describe, expect, it } from 'vitest'

import { isCliCommandName } from '../../../../src/util/cli/command-name.mts'
import { getHelpListOutput } from '../../../../src/util/output/formatting.mts'

describe('command name boundaries', () => {
  it.each(['scan', 'package:score', 'dryRun', 'dry-run'])(
    'accepts command %s',
    value => {
      expect(isCliCommandName(value)).toBe(true)
    },
  )

  it.each(['-scan', '9scan', '_scan', ''])(
    'rejects command %s and its help entry',
    value => {
      expect(isCliCommandName(value)).toBe(false)
      const entries = Object.fromEntries([
        [value, { description: 'Invalid command fixture' }],
      ])
      expect(() => getHelpListOutput(entries)).toThrow(TypeError)
    },
  )
})
