import { describe, expect, it } from 'vitest'

import { buildHelp } from '../../../../src/util/cli/define-handoff.mts'

describe('handoff help', () => {
  it('renders command, examples, and additional notes', () => {
    const help = buildHelp(
      {
        name: 'cargo',
        description: 'Run cargo',
        examples: ['build', 'install ripgrep'],
        helpNotes: ['Wrapper note here.'],
      },
      'socket',
    )('socket cargo')
    expect(help).toContain('socket cargo')
    expect(help).toContain('$ socket cargo build')
    expect(help).toContain('$ socket cargo install ripgrep')
    expect(help).toContain('Wrapper note here.')
  })
  it('renders the wrapper hint only when requested', () => {
    const options = { name: 'yarn', description: 'Run yarn', examples: [] }
    expect(
      buildHelp({ ...options, wrapperHint: true }, 'socket')('socket yarn'),
    ).toContain('socket wrapper on')
    expect(buildHelp(options, 'socket')('socket yarn')).not.toContain(
      'socket wrapper on',
    )
  })
})
