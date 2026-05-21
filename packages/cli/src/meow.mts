/**
 * Simplified meow-like CLI helper for Socket CLI. Uses socket-registry's
 * parseArgs for argument parsing.
 */

import { parseArgs } from '@socketsecurity/lib-stable/argv/parse'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger'
import { readPackageJsonSync } from '@socketsecurity/lib-stable/packages'

import type {
  ParseArgsConfig,
  ParseArgsOptionsConfig,
} from '@socketsecurity/lib-stable/argv/parse'

const logger = getDefaultLogger()

export interface MeowFlag {
  readonly type?: 'string' | 'boolean' | 'number' | undefined
  readonly shortFlag?: string | undefined
  readonly alias?: string | readonly string[] | undefined
  readonly aliases?: readonly string[] | undefined
  readonly default?: unknown | undefined
  readonly isRequired?:
    | boolean
    | ((flags: Record<string, unknown>, input: readonly string[]) => boolean)
    | undefined
  readonly isMultiple?: boolean | undefined
}

export type MeowFlags = Record<string, MeowFlag>

// Identity helper that preserves the literal flag-schema type so callers
// can write a plain object literal (no `as const`) and still benefit
// from the type narrowing in `InferFlagValues`. The constraint also
// catches typos at the schema definition site.
//
// Usage:
//   const flags = defineFlags({
//     http: { type: 'boolean', default: false, description: '…' },
//     port: { type: 'number',  default: 3000,  description: '…' },
//   })
//   // …pass `flags` into the command config; cli.flags.http is `boolean`,
//   // cli.flags.port is `number`, no casts.
export function defineFlags<const F extends MeowFlags>(flags: F): F {
  return flags
}

// Map a flag's schema entry to the runtime value type for that flag.
// - `type: 'boolean'` → boolean
// - `type: 'string'`  → string
// - `type: 'number'`  → number
// - `isMultiple: true` → array of the above
// - `default` set     → value is required (no `| undefined`)
// - otherwise         → value | undefined
//
// Using mapped + conditional types lets each callsite write
// `cli.flags.http` and get back `boolean` (not `MeowFlag | undefined`)
// without any String() / Boolean() / cast machinery.
// When `type` is not narrowed (e.g. the wide default `MeowFlag`), fall
// through to `unknown` rather than `boolean` so callers reading
// `cli.flags.someFlag` from a wide-typed result don't get the wrong
// runtime shape narrowed away. Concrete schemas with literal `type`
// strings still resolve to the precise primitive.
type ValueOfFlagType<F extends MeowFlag> = F['type'] extends 'string'
  ? string
  : F['type'] extends 'number'
    ? number
    : F['type'] extends 'boolean'
      ? boolean
      : unknown
type ValueOrArray<F extends MeowFlag, V> = F['isMultiple'] extends true
  ? V[]
  : V
type ValueOrUndefined<F extends MeowFlag, V> = F['default'] extends undefined
  ? V | undefined
  : F extends { default: infer D }
    ? D extends undefined
      ? V | undefined
      : V
    : V | undefined
export type InferFlagValue<F extends MeowFlag> = ValueOrUndefined<
  F,
  ValueOrArray<F, ValueOfFlagType<F>>
>
// The known-key map from the schema, plus a `[unknown]: unknown` index
// signature so callers can still bracket-access flags that aren't in the
// schema (e.g. `cli.flags['json']` on a command whose schema only spreads
// `commonFlags`). The index signature returns `unknown`, preserving the
// old runtime behavior; the known-key entries get the precise primitive.
export type InferFlagValues<F extends MeowFlags> = {
  [K in keyof F]: InferFlagValue<F[K]>
} & {
  [extraKey: string]: unknown
}

export interface MeowOptions<F extends MeowFlags = MeowFlags> {
  readonly argv?: readonly string[] | undefined
  readonly description?: string | false | undefined
  readonly help?: string | undefined
  readonly flags?: F | undefined
  readonly importMeta?: ImportMeta | undefined
  readonly autoHelp?: boolean | undefined
  readonly autoVersion?: boolean | undefined
  readonly allowUnknownFlags?: boolean | undefined
  readonly collectUnknownFlags?: boolean | undefined
  readonly booleanDefault?: boolean | null | undefined
  readonly hardRejection?: boolean | undefined
  readonly helpIndent?: number | undefined
}

export interface MeowResult<F extends MeowFlags = MeowFlags> {
  readonly input: readonly string[]
  readonly flags: InferFlagValues<F>
  readonly unknownFlags: readonly string[]
  readonly unnormalizedFlags?: InferFlagValues<F> | undefined
  readonly pkg: Record<string, unknown>
  readonly help: string
  showHelp: (exitCode?: number) => void
  showVersion: () => void
}

// Type aliases for compatibility.
export type Flag = MeowFlag
export type Options<F extends MeowFlags = MeowFlags> = MeowOptions<F>
export type Result<F extends MeowFlags = MeowFlags> = MeowResult<F>

/**
 * Parse command-line arguments meow-style.
 */
export function meow<const F extends MeowFlags = MeowFlags>(
  options: MeowOptions<F> = {},
): MeowResult<F> {
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
  let pkg: Record<string, unknown> = {}
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
  const parseArgsOptions: Record<string, ParseArgsOptionsConfig> = {}
  const flagEntries = Object.entries(flags as MeowFlags)
  // oxlint-disable-next-line socket/prefer-cached-for-loop -- loop variable is destructured
  for (const [name, flag] of flagEntries) {
    const type = flag.type === 'number' ? 'string' : flag.type || 'boolean'
    parseArgsOptions[name] = {
      type,
      short: flag.shortFlag,
      default: flag.default,
      multiple: flag.isMultiple,
    }

    // Handle aliases.
    const aliases = flag.aliases || (flag.alias ? [flag.alias].flat() : [])
    for (let i = 0, { length } = aliases; i < length; i += 1) {
      const alias = aliases[i]
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
  const flagValues = parsed.values as InferFlagValues<F>

  // Convert number flags.
  // oxlint-disable-next-line socket/prefer-cached-for-loop -- loop variable is destructured
  for (const [name, flag] of flagEntries) {
    if (
      flag.type === 'number' &&
      typeof flagValues[name as keyof InferFlagValues<F>] === 'string'
    ) {
      const numValue = Number(flagValues[name as keyof InferFlagValues<F>])
      if (!Number.isNaN(numValue)) {
        ;(flagValues as Record<string, unknown>)[name] = numValue
      }
    }
  }

  // Handle boolean defaults.
  if (booleanDefault !== undefined) {
    // oxlint-disable-next-line socket/prefer-cached-for-loop -- loop variable is destructured
    for (const [name, flag] of flagEntries) {
      if (flag.type === 'boolean' && !(name in flagValues)) {
        ;(flagValues as Record<string, unknown>)[name] = booleanDefault
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
    for (let i = 0, { length } = argv; i < length; i += 1) {
      const arg = argv[i]
      if (typeof arg === 'string' && arg.startsWith('-')) {
        const flagName = arg.replace(/^-+/, '').split('=')[0] || ''
        if (flagName && !(flagName in flags)) {
          unknownFlags.push(arg)
        }
      }
    }
  }

  const showHelp = (exitCode = 2) => {
    logger.log(fullHelp)
    // eslint-disable-next-line n/no-process-exit -- Required for CLI exit behavior.
    process.exit(exitCode)
  }

  const showVersion = () => {
    logger.log(pkg['version'] || '0.0.0')
    // eslint-disable-next-line n/no-process-exit -- Required for CLI exit behavior.
    process.exit(0)
  }

  // Auto help/version.
  if (!input.length && argv.length === 1) {
    if (
      flagValues['version' as keyof InferFlagValues<F>] === true &&
      autoVersion
    ) {
      showVersion()
    } else if (
      flagValues['help' as keyof InferFlagValues<F>] === true &&
      autoHelp
    ) {
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
