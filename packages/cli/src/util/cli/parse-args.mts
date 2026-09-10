import yargsParser from 'yargs-parser'

import type {
  ParseArgsConfig,
  ParsedArgs,
  YargsArguments,
  YargsOptions,
} from '@socketsecurity/lib-stable/exe/argv/parse'

export function parseCliArgs(options: ParseArgsConfig = {}): ParsedArgs {
  const {
    allowNegative = false,
    allowPositionals = true,
    args = process.argv.slice(2),
    configuration,
    options: flagOptions = {},
    strict = true,
  } = options
  const boolean: string[] = []
  const string: string[] = []
  const array: string[] = []
  const alias: Record<string, string> = {}
  const defaults: Record<string, unknown> = {}
  const coerce: Record<string, (value: unknown) => unknown> = {}
  for (const [key, option] of Object.entries(flagOptions)) {
    if (option.type === 'boolean') {
      boolean.push(key)
    } else if (option.type === 'string') {
      string.push(key)
    }
    if (option.multiple) {
      array.push(key)
    }
    if (option.short) {
      alias[option.short] = key
    }
    if (option.default !== undefined) {
      defaults[key] = option.default
    }
    if (option.coerce) {
      coerce[key] = option.coerce
    }
  }
  const yargsOptions: YargsOptions = {
    boolean,
    string,
    array,
    alias,
    default: defaults,
    coerce,
    'unknown-options-as-args': !strict,
    'parse-numbers': false,
    'parse-positional-numbers': false,
    'boolean-negation': !allowNegative,
    'halt-at-non-option': !allowPositionals,
    configuration: {
      'camel-case-expansion': true,
      'dot-notation': false,
      'duplicate-arguments-array': true,
      'flatten-duplicate-arrays': true,
      'populate--': true,
      'short-option-groups': true,
      'strip-aliased': false,
      'strip-dashed': false,
      ...configuration,
    },
  }
  const raw = yargsParser([...args], yargsOptions)
  const { _: positionals, ...values } = raw
  return {
    values,
    positionals: positionals.map(String),
    raw: raw as YargsArguments,
  }
}
