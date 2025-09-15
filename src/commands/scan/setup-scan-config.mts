import fs from 'node:fs'
import path from 'node:path'

import { logger } from '@socketsecurity/registry/lib/logger'
import { input, select } from '@socketsecurity/registry/lib/prompts'

import constants, { SOCKET_JSON } from '../../constants.mts'
import {
  detectDefaultBranch,
  getRepoName,
  gitBranch,
} from '../../utils/git.mts'
import {
  readSocketJsonSync,
  writeSocketJson,
} from '../../utils/socket-json.mts'

import type { CResult } from '../../types.mts'
import type { SocketJson } from '../../utils/socket-json.mts'

export async function setupScanConfig(
  cwd: string,
  defaultOnReadError = false,
): Promise<CResult<unknown>> {
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
    `This command will generate a \`${SOCKET_JSON}\` file in the target cwd.`,
  )
  logger.log('You can choose to add this file to your repo (handy for collab)')
  logger.log('or to add it to the ignored files, or neither. This file is only')
  logger.log('used in CLI workflows.')
  logger.log('')
  logger.log('Note: For details on a flag you can run `socket <cmd> --help`')
  logger.log('')

  const sockJsonCResult = readSocketJsonSync(cwd, defaultOnReadError)
  if (!sockJsonCResult.ok) {
    return sockJsonCResult
  }

  const sockJson = sockJsonCResult.data
  if (!sockJson.defaults) {
    sockJson.defaults = {}
  }
  if (!sockJson.defaults.scan) {
    sockJson.defaults.scan = {}
  }

  const targetCommand = await select({
    message: 'Which scan command do you want to configure?',
    choices: [
      {
        name: 'socket scan create',
        value: 'create',
      },
      {
        name: 'socket scan github',
        value: 'github',
      },
      {
        name: '(cancel)',
        value: '',
        description: 'Exit configurator, make no changes',
      },
    ],
  })
  switch (targetCommand) {
    case 'create': {
      if (!sockJson.defaults.scan.create) {
        sockJson.defaults.scan.create = {}
      }
      const result = await configureScan(sockJson.defaults.scan.create, cwd)
      if (!result.ok || result.data.canceled) {
        return result
      }
      break
    }
    case 'github': {
      if (!sockJson.defaults.scan.github) {
        sockJson.defaults.scan.github = {}
      }
      const result = await configureGithub(sockJson.defaults.scan.github)
      if (!result.ok || result.data.canceled) {
        return result
      }
      break
    }
    default: {
      return canceledByUser()
    }
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

async function configureScan(
  config: NonNullable<
    NonNullable<NonNullable<SocketJson['defaults']>['scan']>['create']
  >,
  cwd = process.cwd(),
): Promise<CResult<{ canceled: boolean }>> {
  const defaultRepoName = await input({
    message:
      '(--repo) What repo name (slug) should be reported to Socket for this dir?',
    default: config.repo || (await getRepoName(cwd)),
    required: false,
    // validate: async string => bool
  })
  if (defaultRepoName === undefined) {
    return canceledByUser()
  }
  if (defaultRepoName) {
    // Store it even if it's constants.SOCKET_DEFAULT_REPOSITORY because if we
    // change this default then an existing user probably would not expect the change.
    config.repo = defaultRepoName
  } else {
    delete config.repo
  }

  const defaultBranchName = await input({
    message:
      '(--branch) What branch name (slug) should be reported to Socket for this dir?',
    default:
      config.branch ||
      (await gitBranch(cwd)) ||
      (await detectDefaultBranch(cwd)),
    required: false,
    // validate: async string => bool
  })
  if (defaultBranchName === undefined) {
    return canceledByUser()
  }
  if (defaultBranchName) {
    // Store it even if it's constants.SOCKET_DEFAULT_BRANCH because if we change
    // this default then an existing user probably would not expect the change.
    config.branch = defaultBranchName
  } else {
    delete config.branch
  }

  const autoManifest = await select({
    message:
      '(--auto-manifest) Do you want to run `socket manifest auto` before creating a scan? You would need this for sbt, gradle, etc.',
    choices: [
      {
        name: 'no',
        value: 'no',
        description: 'Do not generate local manifest files',
      },
      {
        name: 'yes',
        value: 'yes',
        description:
          'Locally generate manifest files for languages like gradle, sbt, and conda (see `socket manifest auto`), before creating a scan',
      },
      {
        name: '(leave default)',
        value: '',
        description: 'Do not store a setting for this',
      },
    ],
    default:
      config.autoManifest === true
        ? 'yes'
        : config.autoManifest === false
          ? 'no'
          : '',
  })
  if (autoManifest === undefined) {
    return canceledByUser()
  }
  if (autoManifest === 'yes') {
    config.autoManifest = true
  } else if (autoManifest === 'no') {
    config.autoManifest = false
  } else {
    delete config.autoManifest
  }

  const alwaysReport = await select({
    message: '(--report) Do you want to enable --report by default?',
    choices: [
      {
        name: 'no',
        value: 'no',
        description: 'Do not wait for Scan result and report by default',
      },
      {
        name: 'yes',
        value: 'yes',
        description:
          'After submitting a Scan request, wait for scan to complete, then show a report (like --report would)',
      },
      {
        name: '(leave default)',
        value: '',
        description: 'Do not store a setting for this',
      },
    ],
    default:
      config.report === true ? 'yes' : config.report === false ? 'no' : '',
  })
  if (alwaysReport === undefined) {
    return canceledByUser()
  }
  if (alwaysReport === 'yes') {
    config.report = true
  } else if (alwaysReport === 'no') {
    config.report = false
  } else {
    delete config.report
  }

  return notCanceled()
}

async function configureGithub(
  config: NonNullable<
    NonNullable<NonNullable<SocketJson['defaults']>['scan']>['github']
  >,
): Promise<CResult<{ canceled: boolean }>> {
  // Do not store the GitHub API token. Just leads to a security rabbit hole.

  const all = await select({
    message:
      '(--all) Do you by default want to fetch all repos from the GitHub API and scan all known repos?',
    choices: [
      {
        name: 'no',
        value: 'no',
        description: 'Fetch repos if not given and ask which repo to run on',
      },
      {
        name: 'yes',
        value: 'yes',
        description: 'Run on all remote repos by default',
      },
      {
        name: '(leave default)',
        value: '',
        description: 'Do not store a setting for this',
      },
    ],
    default: config.all === true ? 'yes' : config.all === false ? 'no' : '',
  })
  if (all === undefined) {
    return canceledByUser()
  }
  if (all === 'yes') {
    config.all = true
  } else if (all === 'no') {
    config.all = false
  } else {
    delete config.all
  }

  if (!all) {
    const defaultRepos = await input({
      message:
        '(--repos) Please enter the default repos to run this on, leave empty (backspace) to fetch from GitHub and ask interactive',
      default: config.repos,
      required: false,
      // validate: async string => bool
    })
    if (defaultRepos === undefined) {
      return canceledByUser()
    }
    if (defaultRepos) {
      config.repos = defaultRepos
    } else {
      delete config.repos
    }
  }

  const defaultGithubApiUrl = await input({
    message:
      '(--github-api-url) Do you want to override the default github url?',

    default: config.githubApiUrl || constants.ENV.GITHUB_API_URL,
    required: false,
    // validate: async string => bool
  })
  if (defaultGithubApiUrl === undefined) {
    return canceledByUser()
  }
  if (
    defaultGithubApiUrl &&
    defaultGithubApiUrl !== constants.ENV.GITHUB_API_URL
  ) {
    config.githubApiUrl = defaultGithubApiUrl
  } else {
    delete config.githubApiUrl
  }

  const defaultOrgGithub = await input({
    message:
      '(--org-github) Do you want to change the org slug that is used when talking to the GitHub API? Defaults to your Socket org slug.',
    default: config.orgGithub || '',
    required: false,
    // validate: async string => bool
  })
  if (defaultOrgGithub === undefined) {
    return canceledByUser()
  }
  if (defaultOrgGithub) {
    config.orgGithub = defaultOrgGithub
  } else {
    delete config.orgGithub
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
