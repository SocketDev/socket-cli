import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { spawn } from '@socketsecurity/registry/lib/spawn'

import { getCiBranch, gitBranch } from './git.mts'

// GitHub Actions sets these in its own runs, so they have to be cleared for
// the tests to exercise anything other than the CI job they run inside.
const GITHUB_ENV_VARS = [
  'GITHUB_HEAD_REF',
  'GITHUB_REF_NAME',
  'GITHUB_REF_TYPE',
]

const originalEnv = new Map<string, string | undefined>()

async function createTempRepo(): Promise<string> {
  const repoPath = mkdtempSync(path.join(tmpdir(), 'socket-git-branch-'))
  const options = { cwd: repoPath }
  await spawn('git', ['init', '--initial-branch', 'feature-branch'], options)
  await spawn('git', ['config', 'user.email', 'test@socket.dev'], options)
  await spawn('git', ['config', 'user.name', 'Socket Test'], options)
  await spawn('git', ['config', 'commit.gpgsign', 'false'], options)
  writeFileSync(path.join(repoPath, 'README.md'), '# test\n')
  await spawn('git', ['add', 'README.md'], options)
  await spawn('git', ['commit', '-m', 'Initial commit'], options)
  return repoPath
}

describe('getCiBranch', () => {
  beforeEach(() => {
    for (const name of GITHUB_ENV_VARS) {
      originalEnv.set(name, process.env[name])
      delete process.env[name]
    }
  })

  afterEach(() => {
    for (const name of GITHUB_ENV_VARS) {
      const value = originalEnv.get(name)
      if (value === undefined) {
        delete process.env[name]
      } else {
        process.env[name] = value
      }
    }
    originalEnv.clear()
  })

  it('returns the pull request head branch', () => {
    process.env['GITHUB_HEAD_REF'] = 'feature/pr-branch'
    expect(getCiBranch()).toBe('feature/pr-branch')
  })

  it('prefers the pull request head branch over the merge ref', () => {
    process.env['GITHUB_HEAD_REF'] = 'feature/pr-branch'
    // What GitHub Actions actually sets on a pull_request event.
    process.env['GITHUB_REF_NAME'] = '123/merge'
    process.env['GITHUB_REF_TYPE'] = 'branch'
    expect(getCiBranch()).toBe('feature/pr-branch')
  })

  it('returns the pushed branch ref outside a pull request', () => {
    process.env['GITHUB_REF_NAME'] = 'main'
    process.env['GITHUB_REF_TYPE'] = 'branch'
    expect(getCiBranch()).toBe('main')
  })

  it('ignores a tag ref', () => {
    process.env['GITHUB_REF_NAME'] = 'v1.2.3'
    process.env['GITHUB_REF_TYPE'] = 'tag'
    expect(getCiBranch()).toBeUndefined()
  })

  it('returns undefined outside GitHub Actions', () => {
    expect(getCiBranch()).toBeUndefined()
  })
})

describe('gitBranch', () => {
  let repoPath = ''

  beforeEach(async () => {
    for (const name of GITHUB_ENV_VARS) {
      originalEnv.set(name, process.env[name])
      delete process.env[name]
    }
    repoPath = await createTempRepo()
  })

  afterEach(() => {
    for (const name of GITHUB_ENV_VARS) {
      const value = originalEnv.get(name)
      if (value === undefined) {
        delete process.env[name]
      } else {
        process.env[name] = value
      }
    }
    originalEnv.clear()
    rmSync(repoPath, { force: true, recursive: true })
  })

  it('returns the checked out branch', async () => {
    expect(await gitBranch(repoPath)).toBe('feature-branch')
  })

  it('falls back to the commit hash in a detached HEAD with no CI env', async () => {
    await spawn('git', ['checkout', '--detach'], { cwd: repoPath })
    const shortHash = (
      await spawn('git', ['rev-parse', '--short', 'HEAD'], { cwd: repoPath })
    ).stdout
    expect(await gitBranch(repoPath)).toBe(shortHash)
  })

  it('returns the pull request head branch in a detached HEAD', async () => {
    await spawn('git', ['checkout', '--detach'], { cwd: repoPath })
    process.env['GITHUB_HEAD_REF'] = 'feature/pr-branch'
    process.env['GITHUB_REF_NAME'] = '123/merge'
    process.env['GITHUB_REF_TYPE'] = 'branch'
    expect(await gitBranch(repoPath)).toBe('feature/pr-branch')
  })

  it('returns the pushed branch ref in a detached HEAD', async () => {
    await spawn('git', ['checkout', '--detach'], { cwd: repoPath })
    process.env['GITHUB_REF_NAME'] = 'main'
    process.env['GITHUB_REF_TYPE'] = 'branch'
    expect(await gitBranch(repoPath)).toBe('main')
  })

  it('prefers the checked out branch over the CI env', async () => {
    process.env['GITHUB_REF_NAME'] = 'main'
    process.env['GITHUB_REF_TYPE'] = 'branch'
    expect(await gitBranch(repoPath)).toBe('feature-branch')
  })
})
