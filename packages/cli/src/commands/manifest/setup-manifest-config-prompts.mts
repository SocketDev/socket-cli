/**
 * Interactive prompt helpers for `socket manifest setup`.
 *
 * Extracted from setup-manifest-config.mts to keep that file under the
 * 500-line soft cap. Each helper wraps a single @socketsecurity/lib prompt
 * primitive for one manifest-config flag (bin, enabled, infile, outfile,
 * stdout, verbose).
 */

import { input, select } from '@socketsecurity/lib-stable/stdio/prompts'

export async function askForBin(defaultName = ''): Promise<string | undefined> {
  return await input({
    message:
      '(--bin) What should be the command to execute? Usually your build binary.' +
      (defaultName ? ' (Backspace to leave default)' : ''),
    default: defaultName,
    required: false,
    // validate: async string => bool
  })
}

export async function askForEnabled(
  defaultValue: boolean | undefined,
): Promise<boolean | undefined> {
  return await select({
    message:
      'Do you want to enable or disable auto generating manifest files for this language in this dir?',
    choices: [
      {
        name: 'Enable',
        value: true,
        description: 'Generate manifest files for this language when detected',
      },
      {
        name: 'Disable',
        value: false,
        description:
          'Do not generate manifest files for this language when detected, unless explicitly asking for it',
      },
      {
        name: 'Cancel',
        value: undefined,
        description: 'Exit configurator',
      },
    ],
    default: defaultValue,
  })
}

export async function askForInputFile(
  defaultName = '',
): Promise<string | undefined> {
  return await input({
    message:
      '(--file) What should be the default file name to read? Should be an absolute path or relative to the cwd. Use `-` to read from stdin instead.' +
      (defaultName ? ' (Backspace to leave default)' : ''),
    default: defaultName,
    required: false,
    // validate: async string => bool
  })
}

export async function askForOutputFile(
  defaultName = '',
): Promise<string | undefined> {
  return await input({
    message:
      '(--out) What should be the default output file? Should be absolute path or relative to cwd.' +
      (defaultName ? ' (Backspace to leave default)' : ''),
    default: defaultName,
    required: false,
    // validate: async string => bool
  })
}

export async function askForStdout(
  defaultValue: boolean | undefined,
): Promise<string | undefined> {
  return await select({
    message: '(--stdout) Print the resulting pom.xml to stdout?',
    choices: [
      {
        name: 'no',
        value: 'no',
        description: 'Write output to a file, not stdout',
      },
      {
        name: 'yes',
        value: 'yes',
        description: 'Print in stdout (this will supersede --out)',
      },
      {
        name: '(leave default)',
        value: '',
        description: 'Do not store a setting for this',
      },
    ],
    default: defaultValue === true ? 'yes' : defaultValue === false ? 'no' : '',
  })
}

export async function askForVerboseFlag(
  current: boolean | undefined,
): Promise<string | undefined> {
  return await select({
    message: '(--verbose) Should this run in verbose mode by default?',
    choices: [
      {
        name: 'no',
        value: 'no',
        description: 'Do not run this manifest in verbose mode',
      },
      {
        name: 'yes',
        value: 'yes',
        description: 'Run this manifest in verbose mode',
      },
      {
        name: '(leave default)',
        value: '',
        description: 'Do not store a setting for this',
      },
    ],
    default: current === true ? 'yes' : current === false ? 'no' : '',
  })
}
