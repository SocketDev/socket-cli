import { describe, expect, it } from 'vitest'

import { splitFirewallArguments } from '../../../../src/util/cli/firewall-arguments.mts'

describe('firewall wrapper argument boundaries', () => {
  it('consumes wrapper flags and their values before the executable', () => {
    expect(
      splitFirewallArguments(
        ['--config', '{}', '--dry-run', 'npm', '--config', 'child.json'],
        { explicitCommand: true },
      ),
    ).toEqual({
      wrapperArgs: ['--config', '{}', '--dry-run'],
      commandArgs: ['npm', '--config', 'child.json'],
    })
  })
  it('supports equals-style wrapper flags', () => {
    expect(
      splitFirewallArguments(['--config={}', 'npm'], { explicitCommand: true }),
    ).toEqual({ wrapperArgs: ['--config={}'], commandArgs: ['npm'] })
  })
  it('ends wrapper parsing at the explicit separator', () => {
    expect(
      splitFirewallArguments(['--', 'npm', '--help'], {
        explicitCommand: true,
      }),
    ).toEqual({ wrapperArgs: [], commandArgs: ['npm', '--help'] })
  })
  it.each(['--help', '-h', '--version', '-v', '--verbose'])(
    'preserves handoff child flag %s',
    flag => {
      expect(
        splitFirewallArguments([flag, '--dry-run'], { explicitCommand: false }),
      ).toEqual({ wrapperArgs: [], commandArgs: [flag, '--dry-run'] })
    },
  )
  it('leaves unsupported wrapper modes for runtime rejection', () => {
    expect(
      splitFirewallArguments(['--service'], { explicitCommand: true }),
    ).toEqual({ wrapperArgs: [], commandArgs: ['--service'] })
  })
})
