import { describe, expect, it } from 'vitest'

import { cleanOutput } from './utils.mts'

describe('cleanOutput banner normalization', () => {
  it('normalizes compact and full banners to the same output', () => {
    const compact =
      'CLI: v1.2.3 | cmd: socket scan | org: example | token: secret'
    const full = [
      '   _____         _       _        /---------------',
      '  |   __|___ ___| |_ ___| |_      | CLI: v1.2.3',
      "  |__   | * |  _| '_| -_|  _|     | token: secret, org: example",
      '  |_____|___|___|_,_|___|_|.dev   | Command: `socket scan`, cwd: /tmp',
    ].join('\n')

    expect(cleanOutput(`\n   ${compact}`)).toBe(cleanOutput(full))
  })
})
