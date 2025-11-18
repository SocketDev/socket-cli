import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import trash from 'trash'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { spawn } from '@socketsecurity/registry/lib/spawn'

import {
  cleanupErrorBranches,
  cleanupFailedPrBranches,
  cleanupStaleBranch,
  cleanupSuccessfulPrLocalBranch,
} from './branch-cleanup.mts'
import {
  gitCreateBranch,
  gitDeleteBranch,
  gitDeleteRemoteBranch,
  gitRemoteBranchExists,
} from '../../utils/git.mts'

describe('branch-cleanup integration tests', () => {
  let tempDir: string
  let repoDir: string
  let remoteDir: string

  beforeEach(async () => {
    // Create a temporary directory with unique name.
    tempDir = path.join(
      tmpdir(),
      `socket-branch-cleanup-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    await fs.mkdir(tempDir, { recursive: true })

    // Create separate directories for remote and local repos.
    remoteDir = path.join(tempDir, 'remote.git')
    repoDir = path.join(tempDir, 'repo')

    // Initialize bare remote repository.
    await fs.mkdir(remoteDir, { recursive: true })
    await spawn('git', ['init', '--bare'], { cwd: remoteDir, stdio: 'ignore' })

    // Clone the remote to create local repository.
    await spawn('git', ['clone', remoteDir, repoDir], {
      cwd: tempDir,
      stdio: 'ignore',
    })

    // Configure git user for commits.
    await spawn('git', ['config', 'user.email', 'test@socket-cli.test'], {
      cwd: repoDir,
      stdio: 'ignore',
    })
    await spawn('git', ['config', 'user.name', 'Socket CLI Test'], {
      cwd: repoDir,
      stdio: 'ignore',
    })

    // Create initial commit on main branch.
    await fs.writeFile(path.join(repoDir, 'README.md'), '# Test Repo\n')
    await spawn('git', ['add', '.'], { cwd: repoDir, stdio: 'ignore' })
    await spawn('git', ['commit', '-m', 'Initial commit'], {
      cwd: repoDir,
      stdio: 'ignore',
    })
    await spawn('git', ['push', 'origin', 'main'], {
      cwd: repoDir,
      stdio: 'ignore',
    })
  })

  afterEach(async () => {
    // Clean up temp directory.
    if (tempDir) {
      try {
        await trash(tempDir)
      } catch (e) {
        // Ignore cleanup errors.
      }
    }
  })

  describe('cleanupStaleBranch', () => {
    it('should delete both remote and local stale branches when remote deletion succeeds', async () => {
      const branchName = 'socket-fix/GHSA-test-1'

      // Create and push a branch.
      await gitCreateBranch(branchName, repoDir)
      await spawn('git', ['checkout', branchName], {
        cwd: repoDir,
        stdio: 'ignore',
      })
      await fs.writeFile(path.join(repoDir, 'test.txt'), 'test')
      await spawn('git', ['add', '.'], { cwd: repoDir, stdio: 'ignore' })
      await spawn('git', ['commit', '-m', 'Test commit'], {
        cwd: repoDir,
        stdio: 'ignore',
      })
      await spawn('git', ['push', 'origin', branchName], {
        cwd: repoDir,
        stdio: 'ignore',
      })
      await spawn('git', ['checkout', 'main'], {
        cwd: repoDir,
        stdio: 'ignore',
      })

      // Verify branch exists remotely.
      const existsBefore = await gitRemoteBranchExists(branchName, repoDir)
      expect(existsBefore).toBe(true)

      // Clean up stale branch.
      const result = await cleanupStaleBranch(
        branchName,
        'GHSA-test-1',
        repoDir,
      )

      expect(result).toBe(true)

      // Verify remote branch is deleted.
      const existsAfter = await gitRemoteBranchExists(branchName, repoDir)
      expect(existsAfter).toBe(false)

      // Verify local branch is also deleted.
      const { stdout } = await spawn('git', ['branch', '--list', branchName], {
        cwd: repoDir,
        stdio: 'pipe',
      })
      expect(stdout.trim()).toBe('')
    })
  })

  describe('cleanupFailedPrBranches', () => {
    it('should delete both remote and local branches', async () => {
      const branchName = 'socket-fix/GHSA-test-2'

      // Create and push a branch.
      await gitCreateBranch(branchName, repoDir)
      await spawn('git', ['checkout', branchName], {
        cwd: repoDir,
        stdio: 'ignore',
      })
      await fs.writeFile(path.join(repoDir, 'test.txt'), 'test')
      await spawn('git', ['add', '.'], { cwd: repoDir, stdio: 'ignore' })
      await spawn('git', ['commit', '-m', 'Test commit'], {
        cwd: repoDir,
        stdio: 'ignore',
      })
      await spawn('git', ['push', 'origin', branchName], {
        cwd: repoDir,
        stdio: 'ignore',
      })
      await spawn('git', ['checkout', 'main'], {
        cwd: repoDir,
        stdio: 'ignore',
      })

      // Clean up failed PR branches.
      await cleanupFailedPrBranches(branchName, repoDir)

      // Verify remote branch is deleted.
      const existsAfter = await gitRemoteBranchExists(branchName, repoDir)
      expect(existsAfter).toBe(false)

      // Verify local branch is also deleted.
      const { stdout } = await spawn('git', ['branch', '--list', branchName], {
        cwd: repoDir,
        stdio: 'pipe',
      })
      expect(stdout.trim()).toBe('')
    })
  })

  describe('cleanupSuccessfulPrLocalBranch', () => {
    it('should delete only local branch and keep remote', async () => {
      const branchName = 'socket-fix/GHSA-test-3'

      // Create and push a branch.
      await gitCreateBranch(branchName, repoDir)
      await spawn('git', ['checkout', branchName], {
        cwd: repoDir,
        stdio: 'ignore',
      })
      await fs.writeFile(path.join(repoDir, 'test.txt'), 'test')
      await spawn('git', ['add', '.'], { cwd: repoDir, stdio: 'ignore' })
      await spawn('git', ['commit', '-m', 'Test commit'], {
        cwd: repoDir,
        stdio: 'ignore',
      })
      await spawn('git', ['push', 'origin', branchName], {
        cwd: repoDir,
        stdio: 'ignore',
      })
      await spawn('git', ['checkout', 'main'], {
        cwd: repoDir,
        stdio: 'ignore',
      })

      // Clean up local branch only.
      await cleanupSuccessfulPrLocalBranch(branchName, repoDir)

      // Verify remote branch still exists.
      const remoteExists = await gitRemoteBranchExists(branchName, repoDir)
      expect(remoteExists).toBe(true)

      // Verify local branch is deleted.
      const { stdout } = await spawn('git', ['branch', '--list', branchName], {
        cwd: repoDir,
        stdio: 'pipe',
      })
      expect(stdout.trim()).toBe('')
    })
  })

  describe('cleanupErrorBranches', () => {
    it('should delete both branches when remote exists', async () => {
      const branchName = 'socket-fix/GHSA-test-4'

      // Create and push a branch.
      await gitCreateBranch(branchName, repoDir)
      await spawn('git', ['checkout', branchName], {
        cwd: repoDir,
        stdio: 'ignore',
      })
      await fs.writeFile(path.join(repoDir, 'test.txt'), 'test')
      await spawn('git', ['add', '.'], { cwd: repoDir, stdio: 'ignore' })
      await spawn('git', ['commit', '-m', 'Test commit'], {
        cwd: repoDir,
        stdio: 'ignore',
      })
      await spawn('git', ['push', 'origin', branchName], {
        cwd: repoDir,
        stdio: 'ignore',
      })
      await spawn('git', ['checkout', 'main'], {
        cwd: repoDir,
        stdio: 'ignore',
      })

      // Clean up error branches (remote exists).
      await cleanupErrorBranches(branchName, repoDir, true)

      // Verify remote branch is deleted.
      const remoteExists = await gitRemoteBranchExists(branchName, repoDir)
      expect(remoteExists).toBe(false)

      // Verify local branch is deleted.
      const { stdout } = await spawn('git', ['branch', '--list', branchName], {
        cwd: repoDir,
        stdio: 'pipe',
      })
      expect(stdout.trim()).toBe('')
    })

    it('should delete only local branch when remote does not exist', async () => {
      const branchName = 'socket-fix/GHSA-test-5'

      // Create local branch but don't push.
      await gitCreateBranch(branchName, repoDir)
      await spawn('git', ['checkout', 'main'], {
        cwd: repoDir,
        stdio: 'ignore',
      })

      // Clean up error branches (remote does not exist).
      await cleanupErrorBranches(branchName, repoDir, false)

      // Verify remote branch still doesn't exist.
      const remoteExists = await gitRemoteBranchExists(branchName, repoDir)
      expect(remoteExists).toBe(false)

      // Verify local branch is deleted.
      const { stdout } = await spawn('git', ['branch', '--list', branchName], {
        cwd: repoDir,
        stdio: 'pipe',
      })
      expect(stdout.trim()).toBe('')
    })
  })
})
