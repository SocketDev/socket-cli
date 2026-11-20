#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

import { waitForNpmVersion } from './availability.mts'
import { releasePackagesForVersion } from './packages.mts'
import { npmDistTagForRelease } from './validate-npm-policy.mts'
import {
  type ReleasePolicy,
  readReleasePolicy,
} from '../../src/sea/version.mts'
import { isMainModule } from '../lib/is-main-module.mts'
import { runMain } from '../lib/run-main.mts'

const STAGE_ID =
  /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/iu
const { packageManager } = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { packageManager: string }

interface GitHubRepositoryContext {
  readonly nameWithOwner: string
  readonly defaultBranch: string
}

function run(command: string, args: string[], inherit = false): string {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    timeout: 120_000,
  })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed: ${result.stderr || result.stdout || result.signal || result.status}`,
    )
  }
  return result.stdout?.trim() ?? ''
}

export function pnpmStageInvocation(
  version: string,
  args: string[],
): { command: string; args: string[] } {
  return `pnpm@${version}` === packageManager
    ? { command: 'pnpm', args }
    : {
        command: 'corepack',
        args: [packageManager, '--pm-on-fail=ignore', ...args],
      }
}

function runPnpmStage(args: string[], inherit = false): string {
  // pnpm run exposes the manager itself, bypassing non-executable Windows cmd shims.
  const manager = process.env['npm_config_user_agent']?.startsWith('pnpm/')
    ? process.env['npm_execpath'] || 'pnpm'
    : 'pnpm'
  const usesNode = /\.[cm]?js$/iu.test(manager)
  const command = usesNode ? process.execPath : manager
  const prefix = usesNode ? [manager] : []
  const currentVersion = run(command, [...prefix, '--version'])
  const invocation = pnpmStageInvocation(currentVersion, args)
  return invocation.command === 'pnpm'
    ? run(command, [...prefix, ...args], inherit)
    : run(invocation.command, invocation.args, inherit)
}

function validateStage(
  value: unknown,
  id: string,
  policy: ReleasePolicy,
): { name: string; version: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('npm returned an invalid stage.')
  }
  const stage = value as Record<string, unknown>
  const name = stage['packageName']
  const version = stage['version']
  if (
    stage['id'] !== id ||
    typeof name !== 'string' ||
    typeof version !== 'string' ||
    !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u.test(
      version,
    )
  ) {
    throw new Error('npm stage ID, package, or version is invalid.')
  }
  if (!releasePackagesForVersion(version).includes(name)) {
    throw new Error(`Unexpected npm package in stage: ${name}`)
  }
  const expectedTag = npmDistTagForRelease(version, policy)
  // npm makes the dist-tag immutable when the package is staged.
  if (stage['tag'] !== expectedTag) {
    throw new Error(
      `Expected npm stage dist-tag ${expectedTag} for ${name}@${version}, got ${String(stage['tag'])}.`,
    )
  }
  return { name, version }
}

export type StageAction = 'wait' | 'approve' | 'finalize' | 'burned'

export function stageActionForStatus(status: unknown): StageAction {
  if (status === 'validating') {
    return 'wait'
  }
  if (status === 'staged' || status === 'awaiting_approval') {
    return 'approve'
  }
  if (status === 'published') {
    return 'finalize'
  }
  if (status === 'blocked' || status === 'deleted') {
    return 'burned'
  }
  throw new Error(`npm stage is ${String(status)}; approval stopped.`)
}

function readGitHubRepositoryContext(): GitHubRepositoryContext {
  const context = JSON.parse(
    run('gh', ['repo', 'view', '--json', 'nameWithOwner,defaultBranchRef']),
  ) as {
    nameWithOwner?: string
    defaultBranchRef?: { name?: string }
  }
  const { nameWithOwner } = context
  const defaultBranch = context.defaultBranchRef?.name
  if (
    !nameWithOwner ||
    !/^[^/\s]+\/[^/\s]+$/u.test(nameWithOwner) ||
    !defaultBranch ||
    !/^[A-Za-z0-9._/-]+$/u.test(defaultBranch) ||
    defaultBranch.startsWith('-')
  ) {
    throw new Error('GitHub returned an invalid repository or default branch.')
  }
  return { nameWithOwner, defaultBranch }
}

function dispatchGitHubRelease(
  version: string,
  repository: GitHubRepositoryContext,
): void {
  const tag = `v${version}`
  const args = [
    'workflow',
    'run',
    'release-github.yml',
    '--repo',
    repository.nameWithOwner,
    '--ref',
    repository.defaultBranch,
    '--field',
    `tag=${tag}`,
  ]
  try {
    run('gh', args)
  } catch (error) {
    process.stderr.write(
      `${String(error)}\nRetry finalization with: gh ${args.join(' ')}\n`,
    )
    throw new Error('GitHub release dispatch failed after npm approval.')
  }
  process.stdout.write(
    `GitHub release finalization queued for ${tag}. Retry this stage ID if finalization fails.\n`,
  )
}

async function approve(id: string): Promise<void> {
  if (!STAGE_ID.test(id)) {
    throw new Error('Invalid npm stage UUID.')
  }
  const policy = readReleasePolicy()
  const deadline = Date.now() + 30 * 60_000
  let delay = 2_000
  let stage: { name: string; version: string }
  let status: unknown
  let shouldApprove = false
  while (true) {
    const raw = runPnpmStage([
      'stage',
      'view',
      id,
      '--json',
      '--registry=https://registry.npmjs.org',
    ])
    let value: unknown
    try {
      value = JSON.parse(raw) as unknown
    } catch {
      throw new Error('npm stage view did not return JSON.')
    }
    stage = validateStage(value, id, policy)
    status = (value as Record<string, unknown>)['status']
    const action = stageActionForStatus(status)
    if (action === 'approve') {
      shouldApprove = true
      break
    }
    if (action === 'finalize') {
      break
    }
    if (action === 'burned') {
      throw new Error(
        `npm stage is ${String(status)}; version ${stage.version} is burned. Keep tag v${stage.version} and prepare the next version.`,
      )
    }
    if (Date.now() >= deadline) {
      throw new Error(
        'Timed out waiting for npm validation; the stage remains available to retry.',
      )
    }
    // eslint-disable-next-line no-await-in-loop -- Poll stage state before approving it.
    await new Promise(resolve =>
      setTimeout(resolve, Math.min(delay, deadline - Date.now())),
    )
    delay = Math.min(delay * 2, 30_000)
  }
  const repository = readGitHubRepositoryContext()
  if (shouldApprove) {
    const taggedManifest = JSON.parse(
      run('gh', [
        'api',
        `repos/${repository.nameWithOwner}/contents/package.json?ref=${encodeURIComponent(`refs/tags/v${stage.version}`)}`,
      ]),
    ) as { encoding?: string; content?: string }
    if (taggedManifest.encoding !== 'base64' || !taggedManifest.content) {
      throw new Error(
        `GitHub could not read package.json at tag v${stage.version}.`,
      )
    }
    const repositoryManifest = JSON.parse(
      Buffer.from(taggedManifest.content, 'base64').toString('utf8'),
    ) as { name?: string; version?: string }
    if (
      repositoryManifest.name !== 'socket' ||
      repositoryManifest.version !== stage.version
    ) {
      throw new Error(
        `Tag v${stage.version} does not contain ${stage.name}@${stage.version}.`,
      )
    }
    if (stage.name === 'socket' && stage.version.includes('-')) {
      await Promise.all(
        releasePackagesForVersion(stage.version)
          .slice(1)
          .map(name =>
            waitForNpmVersion(name, stage.version, { timeoutMs: 5000 }),
          ),
      )
    }
    runPnpmStage(
      ['stage', 'approve', id, '--registry=https://registry.npmjs.org'],
      true,
    )
    process.stdout.write(`Approved ${stage.name}@${stage.version}.\n`)
  } else {
    process.stdout.write(`npm stage ${id} is already published.\n`)
  }

  // The socket stage starts one finalizer per release. That workflow waits for
  // every sibling, so stable packages can still be approved in any order.
  if (stage.name === 'socket') {
    dispatchGitHubRelease(stage.version, repository)
  } else {
    process.stdout.write(
      `The socket@${stage.version} stage triggers GitHub finalization. Retry its stage ID if finalization times out.\n`,
    )
  }
}

async function main(args = process.argv.slice(2)): Promise<void> {
  const { positionals } = parseArgs({
    args,
    options: {},
    strict: true,
    allowPositionals: true,
  })
  if (positionals.length !== 1 || !positionals[0]) {
    throw new Error('Usage: pnpm run approve:npm <stage-id>')
  }
  await approve(positionals[0])
}

if (isMainModule(import.meta.url)) {
  runMain(main, {
    describe: 'Approves a validated npm stage by ID.',
    help: 'Usage: pnpm run approve:npm <stage-id>',
  })
}

export { approve, readGitHubRepositoryContext, validateStage }
