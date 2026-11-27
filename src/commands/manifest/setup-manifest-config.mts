import fs from 'node:fs'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'

import {
  DOTNET_RUNTIME_VERSION_FORMAT,
  parseReachability,
  reachabilityFieldsOf,
} from './build-root-config.mts'
import { detectManifestActions } from './detect-manifest-actions.mts'
import { BUILD_TOOLS } from './scripts/build-tool.mts'
import { REQUIREMENTS_TXT, SOCKET_JSON } from '../../constants.mts'
import { debugDir } from '../../utils/debug.mts'
import { logger } from '../../utils/logger.mts'
import { isRecord } from '../../utils/objects.mts'
import { input, select } from '../../utils/prompts.mts'
import {
  mergeSocketJsonChain,
  readSocketJsonChain,
  readSocketJsonSync,
  writeSocketJson,
} from '../../utils/socket-json.mts'

import type { ReachabilityProblem } from './build-root-config.mts'
import type { BuildTool } from './scripts/build-tool.mts'
import type { CResult } from '../../types.mts'
import type {
  ManifestDefaults,
  ReachabilityDefaults,
  ReachabilityField,
} from '../../utils/socket-json.mts'

type ReachabilityStepOptions = {
  // What the project inherits from ancestor socket.json files, as written.
  inheritedReachability?: unknown
}

type ValuePrompts = {
  ask: (current: string) => Promise<string | undefined>
  change: string
  keep: string
  set: string
  unset: string
}

const REACHABILITY_VALUE_PROMPTS = {
  __proto__: null,
  javaHome: {
    ask: current =>
      askForJavaHome(current, 'What JDK should reachability analysis use?'),
    change: 'Use a different Java for reachability analysis?',
    keep: 'as the JDK for reachability analysis',
    set: 'Set the JDK reachability analysis uses',
    unset: 'Leave the JDK for reachability analysis unset',
  },
  runtimeVersion: {
    ask: askForRuntimeVersion,
    change:
      'Start the reachability analysis of a framework-dependent .NET build on a given runtime?',
    keep: 'as the .NET runtime',
    set: 'Set the runtime the analysis starts on',
    unset:
      "Let the analysis take the runtime the build's dotnet rolls forward to",
  },
} satisfies { __proto__: null } & Record<
  Exclude<ReachabilityField, 'build'>,
  ValuePrompts
>

// As written. The wizard leaves invalid inherited values out of its defaults
// and replaces invalid values only in this directory's socket.json.
function inheritedReachabilityOf(cwd: string, tool: BuildTool): unknown {
  const dir = path.resolve(cwd)
  return mergeSocketJsonChain(
    readSocketJsonChain(dir).filter(file => file.dir !== dir),
  ).defaults?.manifest?.[tool]?.reachability
}

// Whether the prompt was canceled. A blank answer clears a value set before
// with null rather than deleting the key, so it doesn't silently start
// inheriting an ancestor's value again.
function applyAnswer<K extends string>(
  config: { [P in K]?: string | null | undefined },
  key: K,
  answer: string | undefined,
): boolean {
  if (answer === undefined) {
    return true
  }
  if (answer) {
    config[key] = answer
  } else if (config[key] !== undefined) {
    config[key] = null
  } else {
    delete config[key]
  }
  return false
}

// Whether the prompt was canceled.
function applyYesNo<K extends string>(
  config: { [P in K]?: boolean | undefined },
  key: K,
  answer: string | undefined,
): boolean {
  if (answer === undefined) {
    return true
  }
  if (answer === 'yes' || answer === 'no') {
    config[key] = answer === 'yes'
  } else {
    delete config[key]
  }
  return false
}

export async function setupManifestConfig(
  cwd: string,
  defaultOnReadError = false,
): Promise<CResult<unknown>> {
  const detected = await detectManifestActions(null, cwd)
  debugDir('inspect', { detected })

  // - repeat
  //   - give the user an option to configure one of the supported targets
  //   - run through an interactive prompt for selected target
  //   - each target will have its own specific options
  //   - record them to the socket.yml (or socket-cli.yml ? or just socket.json ?)

  const jsonPath = path.join(cwd, SOCKET_JSON)
  if (fs.existsSync(jsonPath)) {
    logger.info(`Found ${SOCKET_JSON} at ${jsonPath}`)
  } else {
    logger.info(`No ${SOCKET_JSON} found at ${cwd}, will generate a new one`)
  }

  logger.log('')
  logger.log(
    'Note: This tool will set up flag and argument defaults for certain',
  )
  logger.log('      CLI commands. You can still override them by explicitly')
  logger.log('      setting the flag. It is meant to be a convenience tool.')
  logger.log('')
  logger.log(
    `This command will generate a ${SOCKET_JSON} file in the target cwd.`,
  )
  logger.log(
    'You can choose to add this file to your repo (handy for collaboration)',
  )
  logger.log('or to add it to the ignored files, or neither. This file is only')
  logger.log('used in CLI workflows.')
  logger.log('')

  const choices = [
    {
      name: '.NET (dotnet)'.padEnd(30, ' '),
      value: 'dotnet',
      description:
        'Generate a Socket facts file for .NET solutions and projects through dotnet',
    },
    {
      name: 'Conda'.padEnd(30, ' '),
      value: 'conda',
      description: `Generate ${REQUIREMENTS_TXT} from a Conda environment.yml`,
    },
    {
      name: 'Gradle'.padEnd(30, ' '),
      value: 'gradle',
      description: 'Generate a Socket facts file or pom.xml through gradle',
    },
    {
      name: 'Kotlin (gradle)'.padEnd(30, ' '),
      value: 'gradle',
      description:
        'Generate a Socket facts file or pom.xml (for Kotlin) through gradle',
    },
    {
      name: 'Maven'.padEnd(30, ' '),
      value: 'maven',
      description: 'Generate a Socket facts file through maven',
    },
    {
      name: 'Scala (gradle)'.padEnd(30, ' '),
      value: 'gradle',
      description:
        'Generate a Socket facts file or pom.xml (for Scala) through gradle',
    },
    {
      name: 'Scala (sbt)'.padEnd(30, ' '),
      value: 'sbt',
      description: 'Generate a Socket facts file or pom.xml through sbt',
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

  // TODO: Use detected to list those first.
  const targetEco = (await select({
    message: 'Select ecosystem manifest generator to configure',
    choices,
  })) as string | null

  const sockJsonCResult = readSocketJsonSync(cwd, defaultOnReadError)
  if (!sockJsonCResult.ok) {
    return sockJsonCResult
  }
  const sockJson = sockJsonCResult.data

  if (!sockJson.defaults) {
    sockJson.defaults = {}
  }
  if (!sockJson.defaults.manifest) {
    sockJson.defaults.manifest = {}
  }

  const tool = BUILD_TOOLS.find(t => t === targetEco)
  const inheritedReachability = tool
    ? inheritedReachabilityOf(cwd, tool)
    : undefined

  let result: CResult<{ canceled: boolean }>
  switch (targetEco) {
    case 'conda': {
      if (!sockJson.defaults.manifest.conda) {
        sockJson.defaults.manifest.conda = {}
      }
      result = await setupConda(sockJson.defaults.manifest.conda)
      break
    }
    case 'dotnet': {
      if (!sockJson.defaults.manifest.dotnet) {
        sockJson.defaults.manifest.dotnet = {}
      }
      result = await setupDotnet(sockJson.defaults.manifest.dotnet, {
        inheritedReachability,
      })
      break
    }
    case 'gradle': {
      if (!sockJson.defaults.manifest.gradle) {
        sockJson.defaults.manifest.gradle = {}
      }
      result = await setupGradle(sockJson.defaults.manifest.gradle, {
        inheritedReachability,
      })
      break
    }
    case 'maven': {
      if (!sockJson.defaults.manifest.maven) {
        sockJson.defaults.manifest.maven = {}
      }
      result = await setupMaven(sockJson.defaults.manifest.maven, {
        inheritedReachability,
      })
      break
    }
    case 'sbt': {
      if (!sockJson.defaults.manifest.sbt) {
        sockJson.defaults.manifest.sbt = {}
      }
      result = await setupSbt(sockJson.defaults.manifest.sbt, {
        inheritedReachability,
      })
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
  logger.log(`Setup complete. Writing ${SOCKET_JSON}`)
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
    return await writeSocketJson(cwd, sockJson)
  }

  return canceledByUser()
}

async function setupConda(
  config: ManifestDefaults<'conda'>,
): Promise<CResult<{ canceled: boolean }>> {
  const on = await askForEnabled(!config.disabled)
  if (on === undefined) {
    return canceledByUser()
  } else if (on) {
    delete config.disabled
  } else {
    config.disabled = true
  }

  const infile = await askForInputFile(config.infile || 'environment.yml')
  if (infile === undefined) {
    return canceledByUser()
  } else if (infile === '-') {
    config.stdin = true
  } else {
    delete config.stdin
    if (infile) {
      config.infile = infile
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
    const out = await askForOutputFile(config.outfile || REQUIREMENTS_TXT)
    if (out === undefined) {
      return canceledByUser()
    } else if (out === '-') {
      config.stdout = true
    } else {
      delete config.stdout
      if (out) {
        config.outfile = out
      } else {
        delete config.outfile
      }
    }
  }

  if (applyYesNo(config, 'verbose', await askForVerboseFlag(config.verbose))) {
    return canceledByUser()
  }

  return notCanceled()
}

export async function setupDotnet(
  config: ManifestDefaults<'dotnet'>,
  { inheritedReachability }: ReachabilityStepOptions = {},
): Promise<CResult<{ canceled: boolean }>> {
  if (applyAnswer(config, 'bin', await askForBin(config.bin || '', 'dotnet'))) {
    return canceledByUser()
  }

  if (
    applyAnswer(
      config,
      'dotnetOpts',
      await input({
        message:
          '(--dotnet-opts) Enter options to pass to `dotnet restore`, e.g. `-p:Configuration=Release --configfile nuget.config`',
        default: config.dotnetOpts || '',
        required: false,
      }),
    )
  ) {
    return canceledByUser()
  }

  const factsOptions = await setupFactsOptions(config, 'target framework')
  if (!factsOptions.ok || factsOptions.data.canceled) {
    return factsOptions
  }

  if (applyYesNo(config, 'verbose', await askForVerboseFlag(config.verbose))) {
    return canceledByUser()
  }

  return await setupReachability('dotnet', config, inheritedReachability)
}

export async function setupGradle(
  config: ManifestDefaults<'gradle'>,
  // Set by the recursive dynamic-sbom-inference wizard, which has no
  // pom-mode equivalent - skips the facts/pom question entirely.
  {
    factsOnly = false,
    inheritedReachability,
  }: ReachabilityStepOptions & { factsOnly?: boolean } = {},
): Promise<CResult<{ canceled: boolean }>> {
  if (
    applyAnswer(config, 'bin', await askForBin(config.bin || '', './gradlew'))
  ) {
    return canceledByUser()
  }

  if (
    applyAnswer(config, 'javaHome', await askForJavaHome(config.javaHome || ''))
  ) {
    return canceledByUser()
  }

  if (
    applyAnswer(
      config,
      'gradleOpts',
      await input({
        message: '(--gradle-opts) Enter gradle options to pass through',
        default: config.gradleOpts || '',
        required: false,
        // validate: async string => bool
      }),
    )
  ) {
    return canceledByUser()
  }

  if (!factsOnly) {
    if (applyYesNo(config, 'facts', await askForFactsFlag(config.facts))) {
      return canceledByUser()
    }
  }
  const generatesFacts = factsOnly || config.facts !== false

  // The config filters and --ignore-unresolved only apply to facts generation
  // (the default); skip them when pom generation (--pom) is selected.
  if (generatesFacts) {
    const factsOptions = await setupFactsOptions(config)
    if (!factsOptions.ok || factsOptions.data.canceled) {
      return factsOptions
    }
  }

  if (applyYesNo(config, 'verbose', await askForVerboseFlag(config.verbose))) {
    return canceledByUser()
  }

  if (generatesFacts) {
    return await setupReachability('gradle', config, inheritedReachability)
  }

  return notCanceled()
}

export async function setupMaven(
  config: ManifestDefaults<'maven'>,
  { inheritedReachability }: ReachabilityStepOptions = {},
): Promise<CResult<{ canceled: boolean }>> {
  if (applyAnswer(config, 'bin', await askForBin(config.bin || '', 'mvn'))) {
    return canceledByUser()
  }

  if (
    applyAnswer(config, 'javaHome', await askForJavaHome(config.javaHome || ''))
  ) {
    return canceledByUser()
  }

  if (
    applyAnswer(
      config,
      'mavenOpts',
      await input({
        message: '(--maven-opts) Enter maven options to pass through',
        default: config.mavenOpts || '',
        required: false,
      }),
    )
  ) {
    return canceledByUser()
  }

  // Maven only generates Socket facts (no pom path), so always ask the
  // facts-only options.
  const factsOptions = await setupFactsOptions(config)
  if (!factsOptions.ok || factsOptions.data.canceled) {
    return factsOptions
  }

  if (applyYesNo(config, 'verbose', await askForVerboseFlag(config.verbose))) {
    return canceledByUser()
  }

  return await setupReachability('maven', config, inheritedReachability)
}

export async function setupSbt(
  config: ManifestDefaults<'sbt'>,
  // See setupGradle's matching parameter for why.
  {
    factsOnly = false,
    inheritedReachability,
  }: ReachabilityStepOptions & { factsOnly?: boolean } = {},
): Promise<CResult<{ canceled: boolean }>> {
  if (applyAnswer(config, 'bin', await askForBin(config.bin || '', 'sbt'))) {
    return canceledByUser()
  }

  if (
    applyAnswer(config, 'javaHome', await askForJavaHome(config.javaHome || ''))
  ) {
    return canceledByUser()
  }

  if (
    applyAnswer(
      config,
      'sbtOpts',
      await input({
        message: '(--sbt-opts) Enter sbt options to pass through',
        default: config.sbtOpts || '',
        required: false,
        // validate: async string => bool
      }),
    )
  ) {
    return canceledByUser()
  }

  if (!factsOnly) {
    if (applyYesNo(config, 'facts', await askForFactsFlag(config.facts))) {
      return canceledByUser()
    }
  }
  const generatesFacts = factsOnly || config.facts !== false

  // Socket facts is the default. The pom output questions (stdout/outfile)
  // only apply when pom generation (--pom) is explicitly selected; otherwise
  // ask the facts-only options.
  if (!generatesFacts) {
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
        if (out) {
          config.outfile = out
        } else {
          delete config.outfile
        }
      }
    }
  } else {
    const factsOptions = await setupFactsOptions(config)
    if (!factsOptions.ok || factsOptions.data.canceled) {
      return factsOptions
    }
  }

  if (applyYesNo(config, 'verbose', await askForVerboseFlag(config.verbose))) {
    return canceledByUser()
  }

  if (generatesFacts) {
    return await setupReachability('sbt', config, inheritedReachability)
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

// `defaultName` must be a prior explicit/cascaded value, never the tool's
// hardcoded fallback (e.g. `mvn`) - pre-filling that would freeze it into
// socket.json on a bare Enter. `fallbackHint` is informational text only.
async function askForBin(
  defaultName = '',
  fallbackHint = '',
): Promise<string | undefined> {
  return await input({
    message:
      '(--bin) What should be the command to execute? Usually your build binary.' +
      (defaultName
        ? ' (Backspace to leave default)'
        : fallbackHint
          ? ` (blank = ${fallbackHint})`
          : ''),
    default: defaultName,
    required: false,
    // validate: async string => bool
  })
}

async function askForJavaHome(
  defaultName = '',
  question = 'What JDK should this build tool use? Leave blank to use the JDK already on PATH/JAVA_HOME.',
): Promise<string | undefined> {
  return await input({
    message:
      `${question} Supports $VAR/\${VAR}.` +
      (defaultName ? ' (Backspace to leave default)' : ''),
    default: defaultName,
    required: false,
  })
}

async function askForRuntimeVersion(
  current: string,
): Promise<string | undefined> {
  return await input({
    message:
      `Which .NET runtime? Enter ${DOTNET_RUNTIME_VERSION_FORMAT}.` +
      (current ? ' (Backspace to leave default)' : ''),
    default: current,
    required: false,
    validate: (value: string) =>
      !value ||
      !parseReachability('dotnet', { runtimeVersion: value }).problems.length ||
      `Enter ${DOTNET_RUNTIME_VERSION_FORMAT}.`,
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

async function askForFactsFlag(
  current: boolean | undefined,
): Promise<string | undefined> {
  return await select({
    message: '(--facts / --pom) Which manifest should this generate?',
    choices: [
      {
        name: 'Socket facts (default)',
        value: 'yes',
        description:
          'Generate a Socket facts file (*.socket.facts.json) describing the resolved dependency graph',
      },
      {
        name: 'pom.xml',
        value: 'no',
        description: 'Generate pom.xml manifest files instead (the --pom path)',
      },
      {
        name: '(leave default)',
        value: '',
        description: 'Do not store a setting; uses the default (Socket facts)',
      },
    ],
    default: current === true ? 'yes' : current === false ? 'no' : '',
  })
}

async function askForIgnoreUnresolvedFlag(
  current: boolean | undefined,
): Promise<string | undefined> {
  return await select({
    message:
      '(--ignore-unresolved) Warn on unresolved dependencies instead of failing?',
    choices: [
      {
        name: 'no',
        value: 'no',
        description: 'Fail the run when a declared dependency cannot resolve',
      },
      {
        name: 'yes',
        value: 'yes',
        description:
          'Warn and continue; unresolved dependencies are omitted from the facts file',
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

// The wizard replaces invalid local values with the answers. Invalid
// inherited values need to be fixed in the socket.json that sets them.
function warnInvalidReachability(
  tool: BuildTool,
  problems: readonly ReachabilityProblem[],
  inherited: unknown,
): void {
  for (const { field, value } of problems) {
    let parent: unknown
    let message: string
    if (field === undefined) {
      parent = inherited
      message = `Replacing \`reachability\` (${JSON.stringify(value)}), which is not an object.`
    } else {
      parent = isRecord(inherited) ? inherited[field] : undefined
      message = `Replacing \`reachability.${field}\` (${JSON.stringify(value)}), which ${tool} builds cannot take.`
    }
    if (!isDeepStrictEqual(value, parent)) {
      logger.warn(message)
    }
  }
}

// Answering no to a value prompt keeps the effective value.
// The wizard writes "none" to override an inherited "compile".
async function setupReachability(
  tool: BuildTool,
  config: { reachability?: ReachabilityDefaults | undefined },
  inheritedReachability: unknown,
): Promise<CResult<{ canceled: boolean }>> {
  const { problems, settings: reachability } = parseReachability(
    tool,
    config.reachability,
  )
  warnInvalidReachability(tool, problems, inheritedReachability)
  const { settings: inherited } = parseReachability(tool, inheritedReachability)
  // As a scan merges them.
  const effective = { ...inherited, ...reachability }

  const wantsBuild = await select({
    message:
      'Build project before reachability analysis? Note: A failed build fails the scan.',
    choices: [
      {
        name: 'no',
        value: false,
        description: 'Analyze the project without building it',
      },
      {
        name: 'yes',
        value: true,
        description: 'Compile the project before reachability analysis',
      },
    ],
    default: effective.build === 'compile',
  })
  if (wantsBuild === undefined) {
    return canceledByUser()
  }
  if (wantsBuild) {
    reachability.build = 'compile'
  } else if (inherited.build === 'compile') {
    reachability.build = 'none'
  } else {
    delete reachability.build
  }

  // Whether the prompt was canceled.
  const askValue = async (
    field: Exclude<ReachabilityField, 'build'>,
  ): Promise<boolean> => {
    const prompts = REACHABILITY_VALUE_PROMPTS[field]
    const current = effective[field]
    const wantsValue = await select({
      message: prompts.change,
      choices: [
        {
          name: 'no',
          value: false,
          description: current
            ? `Keep ${current} ${prompts.keep}${Object.hasOwn(reachability, field) ? '' : ', as a parent socket.json sets it'}`
            : prompts.unset,
        },
        {
          name: 'yes',
          value: true,
          description: prompts.set,
        },
      ],
      default: !!current,
    })
    if (wantsValue === undefined) {
      return true
    }
    if (!wantsValue) {
      return false
    }
    const answer = await prompts.ask(current || '')
    if (answer === undefined) {
      return true
    }
    if (answer) {
      reachability[field] = answer
    } else if (reachability[field] || inherited[field]) {
      // Clears the value rather than inheriting it again.
      reachability[field] = null
    } else {
      delete reachability[field]
    }
    return false
  }
  for (const field of reachabilityFieldsOf(tool)) {
    // eslint-disable-next-line no-await-in-loop
    if (field !== 'build' && (await askValue(field))) {
      return canceledByUser()
    }
  }

  if (Object.keys(reachability).length) {
    config.reachability = reachability
  } else {
    delete config.reachability
  }
  return notCanceled()
}

// Prompts for the facts-only options every facts generator shares: the config
// include/exclude filters and --ignore-unresolved. Mutates `config` in place.
async function setupFactsOptions(
  config: {
    excludeConfigs?: string | undefined | null
    ignoreUnresolved?: boolean | undefined
    includeConfigs?: string | undefined | null
  },
  configNoun = 'config-name',
): Promise<CResult<{ canceled: boolean }>> {
  if (
    applyAnswer(
      config,
      'includeConfigs',
      await input({
        message: `(--include-configs) Comma-separated ${configNoun} globs to resolve (blank = all)`,
        default: config.includeConfigs || '',
        required: false,
      }),
    )
  ) {
    return canceledByUser()
  }

  if (
    applyAnswer(
      config,
      'excludeConfigs',
      await input({
        message: `(--exclude-configs) Comma-separated ${configNoun} globs to skip (blank = none)`,
        default: config.excludeConfigs || '',
        required: false,
      }),
    )
  ) {
    return canceledByUser()
  }

  if (
    applyYesNo(
      config,
      'ignoreUnresolved',
      await askForIgnoreUnresolvedFlag(config.ignoreUnresolved),
    )
  ) {
    return canceledByUser()
  }

  return notCanceled()
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
