/**
 * Simplified meow-like CLI helper for Socket CLI.
 */

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { readPackageJsonSync } from '@socketsecurity/lib-stable/packages/read'

import { getPackageJsonPath } from './constants/paths.mts'
import { parseCliArgs } from './util/cli/parse-args.mts'

import type {
  ParseArgsConfig,
  ParseArgsOptionsConfig,
} from '@socketsecurity/lib-stable/exe/argv/parse'

const logger = getDefaultLogger()

export function collectMeowUnknownFlags(
  argv: readonly string[],
  flags: MeowFlags,
): string[] {
  // Collect unknown flags.
  const unknownFlags: string[] = []
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const arg = argv[i]
    if (typeof arg === 'string' && arg.startsWith('-')) {
      const flagName = arg.replace(/^-+/, '').split('=')[0] || ''
      if (flagName && !(flagName in flags)) {
        unknownFlags.push(arg)
      }
    }
  }
  return unknownFlags
}

export function createMeowHelp(
  description: string | false | undefined,
  helpText: string,
  helpIndent: number,
): string {
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
          .split(/\r?\n/)
          .map(line => ' '.repeat(helpIndent) + line)
          .join('\n')
    } else {
      fullHelp += `\n${trimmed}`
    }
  }
  fullHelp += '\n'

  return fullHelp
}

export function createMeowParseOptions(
  flagEntries: Array<[string, MeowFlag]>,
  flags: MeowFlags,
): ParseArgsConfig['options'] {
  const parseArgsOptions = new Map<string, ParseArgsOptionsConfig>()
  for (const [name, flag] of flagEntries) {
    const type = flag.type === 'number' ? 'string' : flag.type || 'boolean'
    parseArgsOptions.set(name, {
      type,
      short: flag.shortFlag,
      default: flag.default,
      multiple: flag.isMultiple,
    })

    // Register the kebab-case spelling as a declared option too. yargs only
    // camel-expands input it recognizes; an undeclared `--ignore-unresolved`
    // for a declared `ignoreUnresolved` boolean otherwise consumes the next
    // positional as its value and parses false.
    const kebabName = name.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`)
    if (kebabName !== name && !(kebabName in flags)) {
      parseArgsOptions.set(kebabName, {
        type,
        default: flag.default,
        multiple: flag.isMultiple,
      })
    }

    // Handle aliases.
    const aliases = flag.aliases || (flag.alias ? [flag.alias].flat() : [])
    for (let i = 0, { length } = aliases; i < length; i += 1) {
      const alias = aliases[i]
      parseArgsOptions.set(alias as string, {
        type,
        default: flag.default,
      })
    }
  }

  return Object.fromEntries(parseArgsOptions)
}

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

export interface MeowFlags {
  [flagName: string]: MeowFlag
}

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

// Map a flag's schema entry to its runtime value type, so a callsite can write
// `cli.flags.http` and get back `boolean` rather than `MeowFlag | undefined`,
// with no String() / Boolean() / cast machinery.
//
// Two results are deliberately wider than they look. A `number` flag maps to
// `number | string`, because the parse layer only converts when `Number(raw)`
// is not NaN, so `--page=invalid` arrives as the raw STRING; consumers coerce
// and validate, keeping the string for error messages. A flag whose `type` is
// not narrowed falls through to `unknown` rather than `boolean`, so reading one
// off a wide-typed result cannot quietly claim the wrong runtime shape.
export type ValueOfFlagType<F extends MeowFlag> = F['type'] extends 'string'
  ? string
  : F['type'] extends 'number'
    ? number | string
    : F['type'] extends 'boolean'
      ? boolean
      : unknown
export type ValueOrArray<F extends MeowFlag, V> = F['isMultiple'] extends true
  ? V[]
  : V
export type ValueOrUndefined<
  F extends MeowFlag,
  V,
> = F['default'] extends undefined
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
  showHelp: (exitCode?: number | undefined) => void
  showVersion: () => void
}

/**
 * Parse command-line arguments meow-style.
 */
export function meow<const F extends MeowFlags = MeowFlags>(
  options: MeowOptions<F> = {},
): MeowResult<F> {
  const {
    argv = process.argv.slice(2),
    autoHelp,
    autoVersion,
    booleanDefault,
    collectUnknownFlags = false,
    description,
    help: helpText = '',
    helpIndent = 2,
    importMeta,
  } = options

  const pkg = readMeowPackage(importMeta)

  const flags: MeowFlags = options.flags ?? {}
  const flagEntries = Object.entries(flags)
  const parseArgsOptions = createMeowParseOptions(flagEntries, flags)

  // Parse arguments.
  const config: ParseArgsConfig = {
    args: argv,
    options: parseArgsOptions,
    strict: !collectUnknownFlags,
    allowPositionals: true,
    // A repeatable flag takes one value per occurrence; a greedy array flag
    // would swallow the positional that follows it (`--exclude-paths x .`).
    configuration: { 'greedy-arrays': false },
  }

  const parsed = parseCliArgs(config)
  const input = parsed.positionals
  const flagValues = parsed.values as InferFlagValues<F>

  normalizeMeowFlagValues(flagEntries, flagValues, { booleanDefault })
  const fullHelp = createMeowHelp(description, helpText, helpIndent)
  const unknownFlags = collectUnknownFlags
    ? collectMeowUnknownFlags(argv, flags)
    : []

  const showHelp = (exitCode = 2) => {
    logger.log(fullHelp)
    process.exit(exitCode)
  }

  const showVersion = () => {
    logger.log(pkg['version'] || '0.0.0')
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

export function normalizeMeowFlagValues(
  flagEntries: Array<[string, MeowFlag]>,
  flagValues: Record<string, unknown>,
  config: { booleanDefault: boolean | null | undefined },
): void {
  const { booleanDefault } = config
  // Convert number flags.
  for (const [name, flag] of flagEntries) {
    if (flag.type === 'number' && typeof flagValues[name] === 'string') {
      const numValue = Number(flagValues[name])
      if (!Number.isNaN(numValue)) {
        flagValues[name] = numValue
      }
    }
  }

  // Handle boolean defaults.
  if (booleanDefault !== undefined) {
    for (const [name, flag] of flagEntries) {
      if (flag.type === 'boolean' && !(name in flagValues)) {
        flagValues[name] = booleanDefault
      }
    }
  }
}

export function readMeowPackage(
  importMeta: ImportMeta | undefined,
): Record<string, unknown> {
  // Read package.json.
  let pkg: Record<string, unknown> = {}
  if (importMeta?.url) {
    try {
      pkg = readPackageJsonSync(getPackageJsonPath()) || {}
    } catch {
      // Fallback to empty object.
    }
  }

  return pkg
}
