import { Octokit } from '@octokit/rest'
import { readWantedLockfile } from '@pnpm/lockfile.fs'

import { getManifestData } from '@socketsecurity/registry'
import { logger } from '@socketsecurity/registry/lib/logger'
import { runScript } from '@socketsecurity/registry/lib/npm'
import {
  fetchPackagePackument,
  readPackageJson
} from '@socketsecurity/registry/lib/packages'
import { spawn } from '@socketsecurity/registry/lib/spawn'

import constants from '../../constants'
import {
  SAFE_ARBORIST_REIFY_OPTIONS_OVERRIDES,
  SafeArborist
} from '../../shadow/npm/arborist/lib/arborist'
import {
  findBestPatchVersion,
  findPackageNodes
} from '../../utils/lockfile/package-lock-json'
import { getAlertsMapFromPnpmLockfile } from '../../utils/lockfile/pnpm-lock-yaml'
import { getCveInfoByAlertsMap } from '../../utils/socket-package-alert'
import { runAgentInstall } from '../optimize/run-agent'

import type { EnvDetails } from '../../utils/package-environment'
import type { Spinner } from '@socketsecurity/registry/lib/spinner'

const { NPM, OVERRIDES, PNPM } = constants

async function branchExists(branchName: string, cwd: string): Promise<boolean> {
  try {
    await spawn('git', ['rev-parse', '--verify', branchName], {
      cwd,
      stdio: 'ignore'
    })
    return true
  } catch {
    return false
  }
}

async function remoteBranchExists(
  branchName: string,
  cwd: string
): Promise<boolean> {
  try {
    const result = await spawn(
      'git',
      ['ls-remote', '--heads', 'origin', branchName],
      {
        cwd,
        stdio: 'pipe'
      }
    )
    return !!result.stdout.trim()
  } catch {
    return false
  }
}

export async function commitAndPushFix(
  branchName: string,
  commitMsg: string,
  cwd: string
) {
  const localExists = await branchExists(branchName, cwd)
  const remoteExists = await remoteBranchExists(branchName, cwd)

  if (localExists || remoteExists) {
    logger.warn(`Branch "${branchName}" already exists. Skipping creation.`)
    return
  }

  const baseBranch = process.env['GITHUB_REF_NAME'] ?? 'main'

  await spawn('git', ['checkout', baseBranch], { cwd })
  await spawn('git', ['checkout', '-b', branchName], { cwd })
  await spawn('git', ['add', 'package.json', 'pnpm-lock.yaml'], { cwd })
  await spawn('git', ['commit', '-m', commitMsg], { cwd })
  await spawn('git', ['push', '--set-upstream', 'origin', branchName], { cwd })
}

async function waitForBranchToBeReadable(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string
) {
  const maxRetries = 10
  const delay = 1500

  for (let i = 0; i < maxRetries; i++) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const ref = await octokit.git.getRef({
        owner,
        repo,
        ref: `heads/${branch}`
      })
      if (ref) {
        return
      }
    } catch (err) {
      // Still not ready
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise(resolve => setTimeout(resolve, delay))
  }

  throw new Error(`Branch "${branch}" never became visible to GitHub API`)
}

async function createPullRequest({
  base = 'main',
  body,
  head,
  owner,
  repo,
  title
}: {
  owner: string
  repo: string
  title: string
  head: string
  base?: string
  body?: string
}) {
  const octokit = new Octokit({
    auth: process.env['SOCKET_AUTOFIX_PAT'] ?? process.env['GITHUB_TOKEN']
  })

  await waitForBranchToBeReadable(octokit, owner, repo, head)

  await octokit.pulls.create({
    owner,
    repo,
    title,
    head,
    base,
    ...(body ? { body } : {})
  })
}

function getRepoInfo(): { owner: string; repo: string } {
  const repoString = process.env['GITHUB_REPOSITORY']
  if (!repoString || !repoString.includes('/')) {
    throw new Error('GITHUB_REPOSITORY is not set or invalid')
  }
  const { 0: owner, 1: repo } = repoString.split('/') as [string, string]
  return { owner, repo }
}

type PnpmFixOptions = {
  cwd?: string | undefined
  spinner?: Spinner | undefined
  test?: boolean | undefined
  testScript?: string | undefined
}

export async function pnpmFix(
  pkgEnvDetails: EnvDetails,
  options?: PnpmFixOptions | undefined
) {
  const {
    cwd = process.cwd(),
    spinner,
    test = false,
    testScript = 'test'
  } = { __proto__: null, ...options } as PnpmFixOptions

  const lockfile = await readWantedLockfile(cwd, { ignoreIncompatible: false })
  if (!lockfile) {
    spinner?.stop()
    return
  }

  const alertsMap = await getAlertsMapFromPnpmLockfile(lockfile, {
    consolidate: true,
    include: {
      existing: true,
      unfixable: false,
      upgradable: false
    },
    nothrow: true
  })

  const infoByPkg = getCveInfoByAlertsMap(alertsMap)
  if (!infoByPkg) {
    spinner?.stop()
    return
  }

  const arb = new SafeArborist({
    path: cwd,
    ...SAFE_ARBORIST_REIFY_OPTIONS_OVERRIDES
  })

  await arb.loadActual()

  const editablePkgJson = await readPackageJson(cwd, { editable: true })
  const { content: pkgJson } = editablePkgJson

  spinner?.stop()

  for (const { 0: name, 1: infos } of infoByPkg) {
    const tree = arb.actualTree!

    const hasUpgrade = !!getManifestData(NPM, name)
    if (hasUpgrade) {
      logger.info(`Skipping ${name}. Socket Optimize package exists.`)
      continue
    }

    const nodes = findPackageNodes(tree, name)

    const packument =
      nodes.length && infos.length
        ? // eslint-disable-next-line no-await-in-loop
          await fetchPackagePackument(name)
        : null
    if (!packument) {
      continue
    }

    for (let i = 0, { length: nodesLength } = nodes; i < nodesLength; i += 1) {
      const node = nodes[i]!
      for (
        let j = 0, { length: infosLength } = infos;
        j < infosLength;
        j += 1
      ) {
        const { firstPatchedVersionIdentifier, vulnerableVersionRange } =
          infos[j]!
        const { version: oldVersion } = node
        const oldSpec = `${name}@${oldVersion}`
        const availableVersions = Object.keys(packument.versions)
        // Find the highest non-vulnerable version within the same major range
        const targetVersion = findBestPatchVersion(
          node,
          availableVersions,
          vulnerableVersionRange,
          firstPatchedVersionIdentifier
        )
        const targetPackument = targetVersion
          ? packument.versions[targetVersion]
          : undefined

        spinner?.stop()

        // Check targetVersion to make TypeScript happy.
        if (targetVersion && targetPackument) {
          const oldPnpm = (pkgJson as any)[PNPM]
          const oldOverrides = oldPnpm?.[OVERRIDES] as
            | { [key: string]: string }
            | undefined
          const overrideKey = `${node.name}@${vulnerableVersionRange}`
          const overrideRange = `^${targetVersion}`
          const fixSpec = `${name}@${overrideRange}`
          const data = {
            [PNPM]: {
              ...oldPnpm,
              [OVERRIDES]: {
                [overrideKey]: overrideRange,
                ...oldOverrides
              }
            }
          }
          try {
            editablePkgJson.update(data)

            spinner?.start()
            spinner?.info(`Installing ${fixSpec}`)

            // eslint-disable-next-line no-await-in-loop
            await editablePkgJson.save()
            // eslint-disable-next-line no-await-in-loop
            await runAgentInstall(pkgEnvDetails, {
              args: ['--no-frozen-lockfile'],
              spinner
            })

            if (test) {
              spinner?.info(`Testing ${fixSpec}`)
              // eslint-disable-next-line no-await-in-loop
              await runScript(testScript, [], { spinner, stdio: 'ignore' })
            }
            try {
              const branchName = `fix-${name}-${targetVersion.replace(/\./g, '-')}`
              const commitMsg = `fix: upgrade ${name} to ${targetVersion}`
              const { owner, repo } = getRepoInfo()
              // eslint-disable-next-line no-await-in-loop
              await spawn(
                'git',
                [
                  'remote',
                  'set-url',
                  'origin',
                  `https://x-access-token:${process.env['SOCKET_AUTOFIX_PAT'] ?? process.env['GITHUB_TOKEN']}@github.com/${owner}/${repo}`
                ],
                { cwd }
              )
              // eslint-disable-next-line no-await-in-loop
              await commitAndPushFix(branchName, commitMsg, cwd)
              // eslint-disable-next-line no-await-in-loop
              await createPullRequest({
                owner,
                repo,
                title: commitMsg,
                head: branchName,
                base: process.env['GITHUB_REF_NAME'] ?? 'master',
                body: `This PR fixes a security issue in \`${name}\` by upgrading to \`${targetVersion}\`.`
              })
            } catch (e) {
              console.log(e)
            }
            logger.success(`Fixed ${name}`)
          } catch {
            spinner?.error(`Reverting ${fixSpec}`)

            const pnpmKeyCount = Object.keys(data[PNPM]).length
            const pnpmOverridesKeyCount = Object.keys(
              data[PNPM][OVERRIDES]
            ).length
            if (pnpmKeyCount === 1 && pnpmOverridesKeyCount === 1) {
              editablePkgJson.update({
                // Setting to `undefined` will remove the property.
                [PNPM]: undefined as any
              })
            } else {
              editablePkgJson.update({
                [PNPM]: {
                  ...oldPnpm,
                  [OVERRIDES]:
                    pnpmOverridesKeyCount === 1
                      ? undefined
                      : {
                          [overrideKey]: undefined,
                          ...oldOverrides
                        }
                }
              })
            }
            // eslint-disable-next-line no-await-in-loop
            await editablePkgJson.save()
            // eslint-disable-next-line no-await-in-loop
            await runAgentInstall(pkgEnvDetails, {
              args: ['--no-frozen-lockfile'],
              spinner
            })
            spinner?.stop()
            logger.error(`Failed to fix ${oldSpec}`)
          }
        } else {
          spinner?.stop()
          logger.error(`Could not patch ${oldSpec}`)
        }
      }
    }
  }

  spinner?.stop()
}
