import { input } from '@socketsecurity/lib-stable/stdio/prompts'

import {
  askForBin,
  askForFactsFlag,
  askForIgnoreUnresolvedFlag,
  askForOutputFile,
  askForStdout,
  askForVerboseFlag,
} from './setup-manifest-config-prompts.mts'
import { canceledByUser, notCanceled } from './setup-manifest-config-shared.mts'

import type { CResult } from '../../types.mts'
import type { SocketJson } from '../../util/socket/json.mts'

// Prompts for the facts-only options shared by gradle, maven, and sbt: the
// config include/exclude filters and --ignore-unresolved. Mutates `config` in
// place.
export async function setupFactsOptions(config: {
  excludeConfigs?: string | undefined
  ignoreUnresolved?: boolean | undefined
  includeConfigs?: string | undefined
}): Promise<CResult<{ canceled: boolean }>> {
  const includeConfigs = await input({
    message:
      '(--include-configs) Comma-separated config-name globs to resolve (blank = all configurations)',
    default: config.includeConfigs || '',
    required: false,
  })
  if (includeConfigs === undefined) {
    return canceledByUser()
  }
  if (includeConfigs) {
    config.includeConfigs = includeConfigs
  } else {
    delete config.includeConfigs
  }

  const excludeConfigs = await input({
    message:
      '(--exclude-configs) Comma-separated config-name globs to skip (blank = none)',
    default: config.excludeConfigs || '',
    required: false,
  })
  if (excludeConfigs === undefined) {
    return canceledByUser()
  }
  if (excludeConfigs) {
    config.excludeConfigs = excludeConfigs
  } else {
    delete config.excludeConfigs
  }

  const ignoreUnresolved = await askForIgnoreUnresolvedFlag(
    config.ignoreUnresolved,
  )
  if (ignoreUnresolved === undefined) {
    return canceledByUser()
  }
  if (ignoreUnresolved === 'no' || ignoreUnresolved === 'yes') {
    config.ignoreUnresolved = ignoreUnresolved === 'yes'
  } else {
    delete config.ignoreUnresolved
  }

  return notCanceled()
}

export async function setupGradle(
  config: NonNullable<
    NonNullable<NonNullable<SocketJson['defaults']>['manifest']>['gradle']
  >,
): Promise<CResult<{ canceled: boolean }>> {
  const bin = await askForBin(config.bin || './gradlew')
  if (bin === undefined) {
    return canceledByUser()
  }
  if (bin) {
    config.bin = bin
  } else {
    delete config.bin
  }

  const opts = await input({
    message: '(--gradle-opts) Enter gradle options to pass through',
    default: config.gradleOpts || '',
    required: false,
    // validate: async string => bool
  })
  if (opts === undefined) {
    return canceledByUser()
  }
  if (opts) {
    config.gradleOpts = opts
  } else {
    delete config.gradleOpts
  }

  const facts = await askForFactsFlag(config.facts)
  if (facts === undefined) {
    return canceledByUser()
  }
  if (facts === 'no' || facts === 'yes') {
    config.facts = facts === 'yes'
  } else {
    delete config.facts
  }

  // The config filters and --ignore-unresolved only apply to facts generation
  // (the default); skip them when pom generation (--pom) is selected.
  if (config.facts !== false) {
    const factsOptions = await setupFactsOptions(config)
    if (!factsOptions.ok || factsOptions.data.canceled) {
      return factsOptions
    }
  }

  const verbose = await askForVerboseFlag(config.verbose)
  /* c8 ignore start - interactive prompt cancellation, undefined return, requires raw inquirer mock setup */
  if (verbose === undefined) {
    return canceledByUser()
  }
  /* c8 ignore stop */
  if (verbose === 'no' || verbose === 'yes') {
    config.verbose = verbose === 'yes'
  } else {
    delete config.verbose
  }

  return notCanceled()
}

export async function setupMaven(
  config: NonNullable<
    NonNullable<NonNullable<SocketJson['defaults']>['manifest']>['maven']
  >,
): Promise<CResult<{ canceled: boolean }>> {
  const bin = await askForBin(config.bin || 'mvn')
  if (bin === undefined) {
    return canceledByUser()
  }
  if (bin) {
    config.bin = bin
  } else {
    delete config.bin
  }

  const opts = await input({
    message: '(--maven-opts) Enter maven options to pass through',
    default: config.mavenOpts || '',
    required: false,
  })
  if (opts === undefined) {
    return canceledByUser()
  }
  if (opts) {
    config.mavenOpts = opts
  } else {
    delete config.mavenOpts
  }

  // Maven only generates Socket facts (no pom path), so always ask the
  // facts-only options.
  const factsOptions = await setupFactsOptions(config)
  if (!factsOptions.ok || factsOptions.data.canceled) {
    return factsOptions
  }

  const verbose = await askForVerboseFlag(config.verbose)
  if (verbose === undefined) {
    return canceledByUser()
  }
  if (verbose === 'no' || verbose === 'yes') {
    config.verbose = verbose === 'yes'
  } else {
    delete config.verbose
  }

  return notCanceled()
}

export async function setupSbt(
  config: NonNullable<
    NonNullable<NonNullable<SocketJson['defaults']>['manifest']>['sbt']
  >,
): Promise<CResult<{ canceled: boolean }>> {
  const bin = await askForBin(config.bin || 'sbt')
  if (bin === undefined) {
    return canceledByUser()
  }
  if (bin) {
    config.bin = bin
  } else {
    delete config.bin
  }

  const opts = await input({
    message: '(--sbt-opts) Enter sbt options to pass through',
    default: config.sbtOpts || '',
    required: false,
    // validate: async string => bool
  })
  if (opts === undefined) {
    return canceledByUser()
  }
  if (opts) {
    config.sbtOpts = opts
  } else {
    delete config.sbtOpts
  }

  const facts = await askForFactsFlag(config.facts)
  if (facts === undefined) {
    return canceledByUser()
  }
  if (facts === 'no' || facts === 'yes') {
    config.facts = facts === 'yes'
  } else {
    delete config.facts
  }

  // Socket facts is the default. The pom output questions (stdout/outfile)
  // only apply when pom generation (--pom) is explicitly selected; otherwise
  // ask the facts-only options.
  if (config.facts === false) {
    const stdout = await askForStdout(config.stdout)
    if (stdout === undefined) {
      return canceledByUser()
    }
    if (stdout === 'yes') {
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
      }
      if (out === '-') {
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

  const verbose = await askForVerboseFlag(config.verbose)
  /* c8 ignore start - interactive prompt cancellation, undefined return, requires raw inquirer mock setup */
  if (verbose === undefined) {
    return canceledByUser()
  }
  /* c8 ignore stop */
  if (verbose === 'no' || verbose === 'yes') {
    config.verbose = verbose === 'yes'
  } else {
    delete config.verbose
  }

  return notCanceled()
}
