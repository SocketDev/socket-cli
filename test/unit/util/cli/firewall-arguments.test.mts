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
  it.each(['--version', '-v', '--verbose'])(
    'preserves handoff child flag %s',
    flag => {
      expect(
        splitFirewallArguments([flag, '--dry-run'], { explicitCommand: false }),
      ).toEqual({ wrapperArgs: [], commandArgs: [flag, '--dry-run'] })
    },
  )
  it.each(['--help', '-h'])('handles bare handoff help %s locally', flag => {
    expect(splitFirewallArguments([flag], { explicitCommand: false })).toEqual({
      wrapperArgs: [flag],
      commandArgs: [],
    })
  })
  it.each([true, false])(
    'forwards help and child flags after the separator with dry-run support %s',
    supportDryRun => {
      expect(
        splitFirewallArguments(['--', '--help', '--version', '--verbose'], {
          explicitCommand: false,
          supportDryRun,
        }),
      ).toEqual({
        wrapperArgs: [],
        commandArgs: ['--help', '--version', '--verbose'],
      })
    },
  )
  it.each(['--help', '-h'])(
    'handles handoff help %s with trailing wrapper flags locally',
    flag => {
      expect(
        splitFirewallArguments([flag, '--config', '{}'], {
          explicitCommand: false,
        }),
      ).toEqual({
        wrapperArgs: [flag, '--config', '{}'],
        commandArgs: [],
      })
    },
  )
  it('keeps mixed leading help flags in local wrapper arguments', () => {
    expect(
      splitFirewallArguments(['--help', '--version', '--verbose'], {
        explicitCommand: false,
      }),
    ).toEqual({
      wrapperArgs: ['--help', '--version', '--verbose'],
      commandArgs: [],
    })
  })
  it('leaves unsupported wrapper modes for runtime rejection', () => {
    expect(
      splitFirewallArguments(['--service'], { explicitCommand: true }),
    ).toEqual({ wrapperArgs: [], commandArgs: ['--service'] })
  })
})
