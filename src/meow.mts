/**
 * Simplified meow-like CLI helper for Socket CLI.
 * Uses socket-registry's parseArgs for argument parsing.
 */

import { readPackageJsonSync } from '@socketsecurity/registry/lib/packages'
import { parseArgs } from '@socketsecurity/registry/lib/parse-args'

import type { ParseArgsConfig } from '@socketsecurity/registry/lib/parse-args'

export interface MeowFlag {
  readonly type?: 'string' | 'boolean' | 'number'
  readonly shortFlag?: string
  readonly alias?: string | readonly string[]
  readonly aliases?: readonly string[]
  readonly default?: unknown
  readonly isRequired?:
    | boolean
    | ((flags: any, input: readonly string[]) => boolean)
  readonly isMultiple?: boolean
}

export type MeowFlags = Record<string, MeowFlag>

export interface MeowOptions {
  readonly argv?: readonly string[]
  readonly description?: string | false
  readonly help?: string
  readonly flags?: MeowFlags
  readonly importMeta?: ImportMeta
  readonly autoHelp?: boolean
  readonly autoVersion?: boolean
  readonly allowUnknownFlags?: boolean
  readonly collectUnknownFlags?: boolean
  readonly booleanDefault?: boolean | null | undefined
  readonly hardRejection?: boolean
  readonly helpIndent?: number
}

export interface MeowResult<T = Record<string, unknown>> {
  readonly input: readonly string[]
  readonly flags: T
  readonly unknownFlags: readonly string[]
  readonly unnormalizedFlags?: T
  readonly pkg: Record<string, any>
  readonly help: string
  showHelp: (exitCode?: number) => void
  showVersion: () => void
}

// Type aliases for compatibility.
export type Flag = MeowFlag
export type Options = MeowOptions
export type Result<T = Record<string, unknown>> = MeowResult<T>

/**
 * Parse command-line arguments meow-style.
 */
export default function meow<
  T extends Record<string, unknown> = Record<string, unknown>,
>(options: MeowOptions = {}): MeowResult<T> {
  const {
    argv = process.argv.slice(2),
    autoHelp = false,
    autoVersion = false,
    booleanDefault,
    collectUnknownFlags = false,
    description,
    flags = {},
    help: helpText = '',
    helpIndent = 2,
    importMeta,
  } = options

  // Read package.json.
  let pkg: Record<string, any> = {}
  if (importMeta?.url) {
    try {
      const url = new URL(importMeta.url)
      const packageJsonPath = url.pathname.replace(/\/[^/]+$/, '/package.json')
      pkg = readPackageJsonSync(packageJsonPath) || {}
    } catch {
      // Fallback to empty object.
    }
  }

  // Convert meow flags to parseArgs options.
  const parseArgsOptions: Record<string, any> = {}
  for (const [name, flag] of Object.entries(flags)) {
    const type = flag.type === 'number' ? 'string' : flag.type || 'boolean'
    parseArgsOptions[name] = {
      type,
      short: flag.shortFlag,
      default: flag.default,
      multiple: flag.isMultiple,
    }

    // Handle aliases.
    const aliases = flag.aliases || (flag.alias ? [flag.alias].flat() : [])
    for (const alias of aliases) {
      parseArgsOptions[alias as string] = {
        type,
        default: flag.default,
      }
    }
  }

  // Parse arguments.
  const config: ParseArgsConfig = {
    args: argv as string[],
    options: parseArgsOptions,
    strict: !collectUnknownFlags,
    allowPositionals: true,
  }

  const parsed = parseArgs(config)
  const input = parsed.positionals
  const flagValues = parsed.values as T

  // Convert number flags.
  for (const [name, flag] of Object.entries(flags)) {
    if (
      flag.type === 'number' &&
      typeof flagValues[name as keyof T] === 'string'
    ) {
      const numValue = Number(flagValues[name as keyof T])
      if (!Number.isNaN(numValue)) {
        ;(flagValues as any)[name] = numValue
      }
    }
  }

  // Handle boolean defaults.
  if (booleanDefault !== undefined) {
    for (const [name, flag] of Object.entries(flags)) {
      if (flag.type === 'boolean' && !(name in flagValues)) {
        ;(flagValues as any)[name] = booleanDefault
      }
    }
  }

  // Build help text.
  let fullHelp = ''
  if (description !== false && description) {
    fullHelp += `\n${description}\n`
  }
  if (helpText) {
    const trimmed = helpText.trim()
    if (trimmed.includes('\n')) {
      fullHelp +=
        '\n' +
        trimmed
          .split('\n')
          .map(line => ' '.repeat(helpIndent) + line)
          .join('\n')
    } else {
      fullHelp += `\n${trimmed}`
    }
  }
  fullHelp += '\n'

  // Collect unknown flags.
  const unknownFlags: string[] = []
  if (collectUnknownFlags) {
    for (const arg of argv) {
      if (typeof arg === 'string' && arg.startsWith('-')) {
        const flagName = arg.replace(/^-+/, '').split('=')[0]
        if (flagName && !(flagName in flags)) {
          unknownFlags.push(arg)
        }
      }
    }
  }

  const showHelp = (exitCode: number = 2) => {
    console.log(fullHelp)
    // eslint-disable-next-line n/no-process-exit -- Required for CLI exit behavior.
    process.exit(exitCode)
  }

  const showVersion = () => {
    console.log(pkg['version'] || '0.0.0')
    // eslint-disable-next-line n/no-process-exit -- Required for CLI exit behavior.
    process.exit(0)
  }

  // Auto help/version.
  if (input.length === 0 && argv.length === 1) {
    if (flagValues['version' as keyof T] === true && autoVersion) {
      showVersion()
    } else if (flagValues['help' as keyof T] === true && autoHelp) {
      showHelp(0)
    }
  }

  return {
    flags: flagValues,
    help: fullHelp,
    input,
    pkg,
    showHelp,
    showVersion,
    unknownFlags,
  }
}
