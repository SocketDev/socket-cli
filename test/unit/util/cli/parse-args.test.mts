import { describe, expect, it } from 'vitest'

import { parseCliArgs } from '../../../../src/util/cli/parse-args.mts'

describe('parseCliArgs', () => {
  it('keeps positionals separate from option values and retains raw arguments', () => {
    const result = parseCliArgs({ args: ['example.js', '42'] })
    expect(result.positionals).toEqual(['example.js', '42'])
    expect(result.values).toEqual({})
    expect(result.raw._).toEqual(['example.js', 42])
  })

  it('parses short boolean aliases, negation, defaults, and literal dotted keys', () => {
    const result = parseCliArgs({
      args: ['-v', '--no-color', '--output.file', 'report.json'],
      options: {
        verbose: { type: 'boolean', short: 'v' },
        color: { type: 'boolean', default: true },
        'output.file': { type: 'string' },
        format: { type: 'string', default: 'json' },
      },
    })
    expect(result.values).toMatchObject({
      verbose: true,
      v: true,
      color: false,
      'output.file': 'report.json',
      format: 'json',
    })
  })

  it('coerces values and keeps repeatable flags from consuming positionals', () => {
    const result = parseCliArgs({
      args: [
        '--include-path',
        'src',
        '--include-path',
        'lib',
        'example.js',
        '--count',
        '3',
      ],
      options: {
        'include-path': { type: 'string', multiple: true },
        count: { type: 'string', coerce: value => Number(value) * 2 },
      },
      configuration: { 'greedy-arrays': false },
    })
    expect(result.positionals).toEqual(['example.js'])
    expect(result.values).toMatchObject({
      'include-path': ['src', 'lib'],
      includePath: ['src', 'lib'],
      count: 6,
    })
  })

  it('retains separator arguments without interpreting them as flags', () => {
    const result = parseCliArgs({
      args: ['example.js', '--', '--literal', 'target'],
    })
    expect(result.positionals).toEqual(['example.js'])
    expect(result.values).toEqual({ '--': ['--literal', 'target'] })
  })

  it('honors parser configuration overrides', () => {
    const result = parseCliArgs({
      args: ['--file-name', 'example.js', '0042'],
      options: { 'file-name': { type: 'string' } },
      configuration: {
        'camel-case-expansion': false,
        'parse-positional-numbers': false,
      },
    })
    expect(result.positionals).toEqual(['0042'])
    expect(result.values).toEqual({ 'file-name': 'example.js' })
  })
})
