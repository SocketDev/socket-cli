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
  const detected = await detectManifestActions(String(cwd))
  debugLog(detected)

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

  const socketJsonResult = (await readSocketJson(cwd, defaultOnReadError)) || {}
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

  switch (targetEco) {
    case 'conda': {
      if (!socketJson.defaults.manifest.conda) {
        socketJson.defaults.manifest.conda = {}
      }
      await setupConda(socketJson.defaults.manifest.conda)
      break
    }
    case 'gradle': {
      if (!socketJson.defaults.manifest.gradle) {
        socketJson.defaults.manifest.gradle = {}
      }
      await setupGradle(socketJson.defaults.manifest.gradle)
      break
    }
    case 'sbt': {
      if (!socketJson.defaults.manifest.sbt) {
        socketJson.defaults.manifest.sbt = {}
      }
      await setupSbt(socketJson.defaults.manifest.sbt)
      break
    }
    default: {
      logger.log('')
      logger.info('User canceled')
      logger.log('')
      return { ok: true, data: undefined }
    }
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

  logger.log('')
  logger.log('User canceled updating the config')
  logger.log('')

  return { ok: true, data: undefined }
}

async function setupConda(
  config: NonNullable<
    NonNullable<NonNullable<SocketJson['defaults']>['manifest']>['conda']
  >,
) {
  const inf = await askForInputFile(config.infile || 'environment.yml')
  if (inf?.trim() === '-') {
    config.stdin = true
  } else {
    delete config.stdin
    if (inf?.trim()) {
      config.infile = inf.trim()
    } else {
      delete config.infile
    }
  }

  const out = await askForOutputFile(config.outfile || 'requirements.txt')
  if (out === '-') {
    config.stdout = true
  } else {
    delete config.stdout
    if (out?.trim()) {
      config.outfile = out.trim()
    } else {
      delete config.outfile
    }
  }

  const verbose = await askForVerboseFlag(config.verbose)
  if (verbose === 'yes' || verbose === 'no') {
    config.verbose = verbose === 'yes'
  } else {
    delete config.verbose
  }
}

async function setupGradle(
  config: NonNullable<
    NonNullable<NonNullable<SocketJson['defaults']>['manifest']>['gradle']
  >,
) {
  const bin = await askForBin(config.bin || './gradlew')
  if (bin?.trim()) {
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
  if (opts?.trim()) {
    config.gradleOpts = opts.trim()
  } else {
    delete config.gradleOpts
  }

  const verbose = await askForVerboseFlag(config.verbose)
  if (verbose === 'yes' || verbose === 'no') {
    config.verbose = verbose === 'yes'
  } else {
    delete config.verbose
  }
}

async function setupSbt(
  config: NonNullable<
    NonNullable<NonNullable<SocketJson['defaults']>['manifest']>['sbt']
  >,
) {
  const bin = await askForBin(config.bin || 'sbt')
  if (bin?.trim()) {
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
  if (opts?.trim()) {
    config.sbtOpts = opts.trim()
  } else {
    delete config.sbtOpts
  }

  const stdout = await askForStdout(config.stdout)
  if (typeof stdout === 'boolean') {
    config.stdout = stdout
  } else {
    delete config.stdout
  }

  if (stdout !== true) {
    const out = await askForOutputFile(config.outfile || 'sbt.pom.xml')
    if (out?.trim()) {
      config.outfile = out.trim()
    } else {
      delete config.outfile
    }
  }

  const verbose = await askForVerboseFlag(config.verbose)
  if (verbose === 'yes' || verbose === 'no') {
    config.verbose = verbose === 'yes'
  } else {
    delete config.verbose
  }
}

async function askForStdout(
  defaultValue: boolean | undefined,
): Promise<boolean | undefined> {
  return await select({
    message: '(--stdout) Print the resulting pom.xml to stdout?',
    choices: [
      {
        name: 'no',
        value: 'no',
        selected: defaultValue === false,
        description: 'Write output to a file, not stdout',
      },
      {
        name: 'yes',
        value: 'yes',
        selected: defaultValue === true,
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
      '(--out) What should be the default output file? Should be absolute path, or relative to cwd, or $PATH.' +
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
): Promise<string> {
  return await select({
    message: '(--verbose) Should this run in verbose mode by default?',
    choices: [
      {
        name: 'no',
        value: 'no',
        selected: current === false,
        description: 'Do not run this manifest in verbose mode',
      },
      {
        name: 'yes',
        value: 'yes',
        selected: current === true,
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
