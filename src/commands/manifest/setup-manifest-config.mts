import fs from 'node:fs'
import path from 'node:path'

import { debugLog } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'
import { input, select } from '@socketsecurity/registry/lib/prompts'

import { detectManifestActions } from './detect-manifest-actions.mts'
import { readSocketJson, writeSocketJson } from '../../utils/socketjson.mts'

import type { CResult } from '../../types.mts'
import type { SocketJson } from '../../utils/socketjson.mts'

export async function setupManifestConfig(
  cwd: string,
  defaultOnReadError = false,
): Promise<CResult<unknown>> {
  const detected = await detectManifestActions(null, cwd)
  debugLog('[DEBUG]', detected)

  // - repeat
  //   - give the user an option to configure one of the supported targets
  //   - run through an interactive prompt for selected target
  //   - each target will have its own specific options
  //   - record them to the socket.yml (or socket-cli.yml ? or just socket.json ?)

  const jsonPath = path.join(cwd, `socket.json`)
  if (fs.existsSync(jsonPath)) {
    logger.info(`Found socket.json at ${jsonPath}`)
  } else {
    logger.info(`No socket.json found at ${cwd}, will generate a new one`)
  }

  logger.log('')
  logger.log(
    'Note: This tool will set up flag and argument defaults for certain',
  )
  logger.log('      CLI commands. You can still override them by explicitly')
  logger.log('      setting the flag. It is meant to be a convenience tool.')
  logger.log('')
  logger.log(
    'This command will generate a `socket.json` file in the target cwd.',
  )
  logger.log('You can choose to add this file to your repo (handy for collab)')
  logger.log('or to add it to the ignored files, or neither. This file is only')
  logger.log('used in CLI workflows.')
  logger.log('')

  const choices = [
    {
      name: 'Conda'.padEnd(30, ' '),
      value: 'conda',
      description: 'Generate requirements.txt from a Conda environment.yml',
    },
    {
      name: 'Gradle'.padEnd(30, ' '),
      value: 'gradle',
      description: 'Generate pom.xml files through gradle',
    },
    {
      name: 'Kotlin (gradle)'.padEnd(30, ' '),
      value: 'gradle',
      description: 'Generate pom.xml files (for Kotlin) through gradle',
    },
    {
      name: 'Scala (gradle)'.padEnd(30, ' '),
      value: 'gradle',
      description: 'Generate pom.xml files (for Scala) through gradle',
    },
    {
      name: 'Scala (sbt)'.padEnd(30, ' '),
      value: 'sbt',
      description: 'Generate pom.xml files through sbt',
    },
  ]

  choices.forEach(obj => {
    if (detected[obj.value as keyof typeof detected]) {
      obj.name += ' [detected]'
    }
  })

  // Surface detected language first, then by alphabet
  choices.sort((a, b) => {
    if (
      detected[a.value as keyof typeof detected] &&
      !detected[b.value as keyof typeof detected]
    ) {
      return -1
    }
    if (
      !detected[a.value as keyof typeof detected] &&
      detected[b.value as keyof typeof detected]
    ) {
      return 1
    }
    return a.value < b.value ? -1 : a.value > b.value ? 1 : 0
  })

  // Make exit the last entry...
  choices.push({
    name: 'None, exit configurator',
    value: '',
    description: 'Exit setup',
  })

  // TODO: use detected to list those first
  const targetEco = (await select({
    message: 'Select eco system manifest generator to configure',
    choices,
  })) as string | null

  const socketJsonResult = await readSocketJson(cwd, defaultOnReadError)
  if (!socketJsonResult.ok) {
    return socketJsonResult
  }
  const socketJson = socketJsonResult.data

  if (!socketJson.defaults) {
    socketJson.defaults = {}
  }
  if (!socketJson.defaults.manifest) {
    socketJson.defaults.manifest = {}
  }

  let result: CResult<{ canceled: boolean }>
  switch (targetEco) {
    case 'conda': {
      if (!socketJson.defaults.manifest.conda) {
        socketJson.defaults.manifest.conda = {}
      }
      result = await setupConda(socketJson.defaults.manifest.conda)
      break
    }
    case 'gradle': {
      if (!socketJson.defaults.manifest.gradle) {
        socketJson.defaults.manifest.gradle = {}
      }
      result = await setupGradle(socketJson.defaults.manifest.gradle)
      break
    }
    case 'sbt': {
      if (!socketJson.defaults.manifest.sbt) {
        socketJson.defaults.manifest.sbt = {}
      }
      result = await setupSbt(socketJson.defaults.manifest.sbt)
      break
    }
    default: {
      result = canceledByUser()
    }
  }

  if (!result.ok || result.data.canceled) {
    return result
  }

  logger.log('')
  logger.log('Setup complete. Writing socket.json')
  logger.log('')

  if (
    await select({
      message: `Do you want to write the new config to ${jsonPath} ?`,
      choices: [
        {
          name: 'yes',
          value: true,
          description: 'Update config',
        },
        {
          name: 'no',
          value: false,
          description: 'Do not update the config',
        },
      ],
    })
  ) {
    return await writeSocketJson(cwd, socketJson)
  }

  return canceledByUser()
}

async function setupConda(
  config: NonNullable<
    NonNullable<NonNullable<SocketJson['defaults']>['manifest']>['conda']
  >,
): Promise<CResult<{ canceled: boolean }>> {
  const on = await askForEnabled(!config.disabled)
  if (on === undefined) {
    return canceledByUser()
  } else if (on) {
    delete config.disabled
  } else {
    config.disabled = true
  }

  const inf = await askForInputFile(config.infile || 'environment.yml')
  if (inf === undefined) {
    return canceledByUser()
  } else if (inf.trim() === '-') {
    config.stdin = true
  } else {
    delete config.stdin
    if (inf.trim()) {
      config.infile = inf.trim()
    } else {
      delete config.infile
    }
  }

  const stdout = await askForStdout(config.stdout)
  if (stdout === undefined) {
    return canceledByUser()
  } else if (stdout === 'yes') {
    config.stdout = true
  } else if (stdout === 'no') {
    config.stdout = false
  } else {
    delete config.stdout
  }

  if (!config.stdout) {
    const out = await askForOutputFile(config.outfile || 'requirements.txt')
    if (out === undefined) {
      return canceledByUser()
    } else if (out === '-') {
      config.stdout = true
    } else {
      delete config.stdout
      if (out?.trim()) {
        config.outfile = out.trim()
      } else {
        delete config.outfile
      }
    }
  }

  const verbose = await askForVerboseFlag(config.verbose)
  if (verbose === undefined) {
    return canceledByUser()
  } else if (verbose === 'yes' || verbose === 'no') {
    config.verbose = verbose === 'yes'
  } else {
    delete config.verbose
  }

  return notCanceled()
}

async function setupGradle(
  config: NonNullable<
    NonNullable<NonNullable<SocketJson['defaults']>['manifest']>['gradle']
  >,
): Promise<CResult<{ canceled: boolean }>> {
  const bin = await askForBin(config.bin || './gradlew')
  if (bin === undefined) {
    return canceledByUser()
  } else if (bin.trim()) {
    config.bin = bin.trim()
  } else {
    delete config.bin
  }

  const opts = await input({
    message: '(--gradleOpts) Enter gradle options to pass through',
    default: config.gradleOpts || '',
    required: false,
    // validate: async string => bool
  })
  if (opts === undefined) {
    return canceledByUser()
  } else if (opts.trim()) {
    config.gradleOpts = opts.trim()
  } else {
    delete config.gradleOpts
  }

  const verbose = await askForVerboseFlag(config.verbose)
  if (verbose === undefined) {
    return canceledByUser()
  } else if (verbose === 'yes' || verbose === 'no') {
    config.verbose = verbose === 'yes'
  } else {
    delete config.verbose
  }

  return notCanceled()
}

async function setupSbt(
  config: NonNullable<
    NonNullable<NonNullable<SocketJson['defaults']>['manifest']>['sbt']
  >,
): Promise<CResult<{ canceled: boolean }>> {
  const bin = await askForBin(config.bin || 'sbt')
  if (bin === undefined) {
    return canceledByUser()
  } else if (bin.trim()) {
    config.bin = bin.trim()
  } else {
    delete config.bin
  }

  const opts = await input({
    message: '(--sbtOpts) Enter sbt options to pass through',
    default: config.sbtOpts || '',
    required: false,
    // validate: async string => bool
  })
  if (opts === undefined) {
    return canceledByUser()
  } else if (opts.trim()) {
    config.sbtOpts = opts.trim()
  } else {
    delete config.sbtOpts
  }

  const stdout = await askForStdout(config.stdout)
  if (stdout === undefined) {
    return canceledByUser()
  } else if (stdout === 'yes') {
    config.stdout = true
  } else if (stdout === 'no') {
    config.stdout = false
  } else {
    delete config.stdout
  }

  if (config.stdout !== true) {
    const out = await askForOutputFile(config.outfile || 'sbt.pom.xml')
    if (out === undefined) {
      return canceledByUser()
    } else if (out === '-') {
      config.stdout = true
    } else {
      delete config.stdout
      if (out?.trim()) {
        config.outfile = out.trim()
      } else {
        delete config.outfile
      }
    }
  }

  const verbose = await askForVerboseFlag(config.verbose)
  if (verbose === undefined) {
    return canceledByUser()
  } else if (verbose === 'yes' || verbose === 'no') {
    config.verbose = verbose === 'yes'
  } else {
    delete config.verbose
  }

  return notCanceled()
}

async function askForStdout(
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

async function askForEnabled(
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
    default:
      defaultValue === true
        ? 'enable'
        : defaultValue === false
          ? 'disable'
          : '',
  })
}

async function askForInputFile(defaultName = ''): Promise<string | undefined> {
  return await input({
    message:
      '(--file) What should be the default file name to read? Should be an absolute path or relative to the cwd. Use `-` to read from stdin instead.' +
      (defaultName ? ' (Backspace to leave default)' : ''),
    default: defaultName,
    required: false,
    // validate: async string => bool
  })
}

async function askForOutputFile(defaultName = ''): Promise<string | undefined> {
  return await input({
    message:
      '(--out) What should be the default output file? Should be absolute path or relative to cwd.' +
      (defaultName ? ' (Backspace to leave default)' : ''),
    default: defaultName,
    required: false,
    // validate: async string => bool
  })
}

async function askForBin(defaultName = ''): Promise<string | undefined> {
  return await input({
    message:
      '(--bin) What should be the command to execute? Usually your build binary.' +
      (defaultName ? ' (Backspace to leave default)' : ''),
    default: defaultName,
    required: false,
    // validate: async string => bool
  })
}

async function askForVerboseFlag(
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

function canceledByUser(): CResult<{ canceled: boolean }> {
  logger.log('')
  logger.info('User canceled')
  logger.log('')
  return { ok: true, data: { canceled: true } }
}

function notCanceled(): CResult<{ canceled: boolean }> {
  return { ok: true, data: { canceled: false } }
}
