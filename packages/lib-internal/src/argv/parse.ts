/**
 * Argument parsing utilities for CLI applications.
 * Uses yargs-parser internally for robust argument parsing with Node.js parseArgs-compatible API.
 */

import yargsParser from 'yargs-parser'

/**
 * Yargs parser options interface.
 */
interface YargsOptions {
  // Array of option names that should be treated as booleans.
  boolean?: string[] | undefined
  // Array of option names that should be treated as strings.
  string?: string[] | undefined
  // Array of option names that should accept multiple values.
  array?: string[] | undefined
  // Map of short aliases to full option names.
  alias?: Record<string, string | string[]> | undefined
  // Default values for options.
  default?: Record<string, unknown> | undefined
  // Transform functions to coerce parsed values.
  coerce?: Record<string, (value: unknown) => unknown> | undefined
  // Whether to treat unknown options as positional arguments.
  'unknown-options-as-args'?: boolean | undefined
  // Whether to parse numeric strings as numbers.
  'parse-numbers'?: boolean | undefined
  // Whether to parse positional arguments as numbers.
  'parse-positional-numbers'?: boolean | undefined
  // Whether to support --no-<option> negation for booleans.
  'boolean-negation'?: boolean | undefined
  // Whether to stop parsing options after the first positional.
  'halt-at-non-option'?: boolean | undefined
  // Advanced yargs-parser configuration options.
  configuration?: Record<string, boolean | string> | undefined
  // Whether to throw on unknown options.
  strict?: boolean | undefined
}

/**
 * Yargs parser result interface.
 */
interface YargsArguments extends Record<string, unknown> {
  _: string[]
  $0?: string
}

/**
 * Options for configuring argument parsing, similar to Node.js util.parseArgs.
 */
export interface ParseArgsOptionsConfig {
  // Whether the option accepts multiple values (array).
  multiple?: boolean | undefined
  // Short alias for the option (single character).
  short?: string | undefined
  // Type of the option value.
  type?: 'boolean' | 'string' | undefined
  // Default value for the option.
  default?: unknown | undefined
  // Transform function to coerce parsed values.
  coerce?: (value: unknown) => unknown | undefined
}

/**
 * Configuration object for parseArgs function, similar to Node.js util.parseArgs.
 */
export interface ParseArgsConfig {
  // Command-line arguments to parse (defaults to process.argv.slice(2)).
  args?: readonly string[] | undefined
  // Options configuration object.
  options?: Record<string, ParseArgsOptionsConfig> | undefined
  // Whether to throw on unknown options (default: true).
  strict?: boolean | undefined
  // Whether to populate tokens array (not implemented, for API compatibility).
  tokens?: boolean | undefined
  // Whether to allow positional arguments after options.
  allowPositionals?: boolean | undefined
  // Whether to allow negative numbers as option values.
  allowNegative?: boolean | undefined
  // Advanced yargs-parser configuration passthrough.
  configuration?: Record<string, boolean | string> | undefined
}

/**
 * Result of parsing command-line arguments.
 */
export interface ParsedArgs<T = Record<string, unknown>> {
  // Parsed option values.
  values: T
  // Positional arguments (non-option arguments).
  positionals: string[]
  // Raw parsed arguments object from yargs-parser.
  raw: YargsArguments
}

/**
 * Parse command-line arguments with a Node.js parseArgs-compatible API.
 * Uses yargs-parser internally for robust argument parsing.
 */
export function parseArgs<T = Record<string, unknown>>(
  config: ParseArgsConfig = {},
): ParsedArgs<T> {
  const {
    allowNegative = false,
    allowPositionals = true,
    args = process.argv.slice(2),
    configuration,
    options = {},
    strict = true,
  } = config

  // Convert parseArgs options to yargs-parser options.
  const yargsOptions: YargsOptions = {
    // Arrays of option names to treat as specific types.
    boolean: [],
    string: [],
    array: [],
    // Maps for aliases, defaults, and transformations.
    alias: {},
    default: {},
    coerce: {},
    'unknown-options-as-args': !strict,
    'parse-numbers': false,
    'parse-positional-numbers': false,
    'boolean-negation': !allowNegative,
    'halt-at-non-option': !allowPositionals,
    configuration: {
      // Enable kebab-case to camelCase conversion (e.g., --temp-dir → tempDir).
      'camel-case-expansion': true,
      // Disable dot notation to avoid confusing nested property parsing.
      'dot-notation': false,
      // Convert duplicate arguments into arrays automatically.
      'duplicate-arguments-array': true,
      // Flatten nested arrays from duplicate arguments for cleaner output.
      'flatten-duplicate-arrays': true,
      // Populate the '--' key with arguments after the -- separator.
      'populate--': true,
      // Allow short option grouping like -abc for -a -b -c.
      'short-option-groups': true,
      // Keep aliased keys in the result for flexibility.
      'strip-aliased': false,
      // Keep both kebab-case and camelCase keys for flexibility.
      'strip-dashed': false,
      ...configuration,
    },
  }

  // Process each option configuration.
  for (const { 0: key, 1: optionConfig } of Object.entries(options)) {
    const {
      coerce,
      default: defaultValue,
      multiple,
      short,
      type,
    } = optionConfig

    // Set the option type.
    if (type === 'boolean') {
      yargsOptions.boolean?.push(key)
    } else if (type === 'string') {
      yargsOptions.string?.push(key)
    }

    // Handle multiple values (arrays).
    if (multiple) {
      yargsOptions.array?.push(key)
    }

    // Set short alias.
    if (short) {
      ;(yargsOptions.alias as Record<string, string>)[short] = key
    }

    // Set default value.
    if (defaultValue !== undefined) {
      ;(yargsOptions.default as Record<string, unknown>)[key] = defaultValue
    }

    // Set coerce function.
    if (coerce) {
      ;(yargsOptions.coerce as Record<string, unknown>)[key] = coerce
    }
  }

  // Parse the arguments.
  const parsed = yargsParser(args as string[], yargsOptions)

  // Extract positional arguments.
  const positionals = parsed._ || []

  // Remove the positionals array from values to match Node.js parseArgs behavior.
  const { _, ...values } = parsed

  // Ensure positionals are strings.
  const stringPositionals = positionals.map(String)

  return {
    values: values as T,
    positionals: stringPositionals,
    raw: parsed as YargsArguments,
  }
}

/**
 * Parse command-line arguments with Socket defaults.
 * Provides sensible defaults for Socket CLI applications.
 */
export function parseArgsWithDefaults<T = Record<string, unknown>>(
  config: ParseArgsConfig = {},
): ParsedArgs<T> {
  return parseArgs<T>({
    strict: false,
    allowPositionals: true,
    ...config,
  })
}

/**
 * Common parseArgs configuration for Socket registry scripts.
 */
export const commonParseArgsConfig: ParseArgsConfig = {
  options: {
    force: {
      type: 'boolean',
      short: 'f',
      default: false,
    },
    quiet: {
      type: 'boolean',
      short: 'q',
      default: false,
    },
  },
  strict: false,
}

/**
 * Extract positional arguments from process.argv.
 * Useful for commands that accept file paths or other positional parameters.
 */
export function getPositionalArgs(startIndex = 2): string[] {
  const args = process.argv.slice(startIndex)
  const positionals: string[] = []
  let i = 0

  while (i < args.length) {
    const arg = args[i]!
    // Stop at first flag
    if (arg.startsWith('-')) {
      break
    }
    positionals.push(arg)
    i++
  }

  return positionals
}

/**
 * Check if a specific flag is present in argv.
 */
export function hasFlag(flag: string, argv = process.argv): boolean {
  const flagVariants = [
    `--${flag}`,
    // Short flag.
    `-${flag.charAt(0)}`,
  ]
  return flagVariants.some(variant => argv.includes(variant))
}
