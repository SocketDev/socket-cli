import { camelToKebab } from '../data/strings.mts'

import { commonFlags } from '../../flags.mts'

export function getFirewallWrapperFlags(): Map<string, string> {
  const flags = new Map<string, string>()
  for (const [name, flag] of Object.entries(commonFlags)) {
    flags.set(`--${camelToKebab(name)}`, flag.type)
    if ('shortFlag' in flag && flag.shortFlag) {
      flags.set(`-${flag.shortFlag}`, flag.type)
    }
    if (name === 'banner' || name === 'spinner') {
      flags.set(`--no-${name}`, 'boolean')
    }
  }
  return flags
}

export function splitFirewallArguments(
  args: readonly string[],
  config: { explicitCommand: boolean; supportDryRun?: boolean | undefined },
): { wrapperArgs: string[]; commandArgs: string[] } {
  const flags = getFirewallWrapperFlags()
  let offset = 0
  while (offset < args.length) {
    const argument = args[offset]!
    if (argument === '--') {
      return {
        wrapperArgs: args.slice(0, offset),
        commandArgs: args.slice(offset + 1),
      }
    }
    const name = argument.split('=', 1)[0]!
    if (
      !config.explicitCommand &&
      ['--help', '-h', '--version', '-v', '--verbose'].includes(name)
    ) {
      break
    }
    if (name === '--dry-run' && config.supportDryRun === false) {
      break
    }
    const type = flags.get(name)
    if (!type) {
      break
    }
    offset += type !== 'boolean' && !argument.includes('=') ? 2 : 1
  }
  return { wrapperArgs: args.slice(0, offset), commandArgs: args.slice(offset) }
}
