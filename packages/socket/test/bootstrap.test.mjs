/**
 * @fileoverview Tests for socket package bootstrap and delegation.
 *
 * Note: Bootstrap delegation tests require actual npm package installation.
 * They are resource-intensive and may require network access.
 * For CI/CD pipelines, consider running these tests separately or conditionally.
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import { homedir, platform, tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { brotliCompressSync } from 'node:zlib'

import { describe, expect, it, beforeEach, afterEach } from 'vitest'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageDir = path.join(__dirname, '..')
const bootstrapPath = path.join(packageDir, 'dist', 'bootstrap.js')

describe('socket package', () => {
  describe('package.json validation', () => {
    it('should have valid package.json metadata', async () => {
      const pkgJson = JSON.parse(
        await fs.readFile(path.join(packageDir, 'package.json'), 'utf-8'),
      )

      expect(pkgJson.name).toBe('socket')
      expect(pkgJson.version).toMatch(/^\d+\.\d+\.\d+$/)
      expect(pkgJson.license).toBe('MIT')
      expect(pkgJson.description).toContain('Socket CLI')
    })

    it('should have correct bin entry', async () => {
      const pkgJson = JSON.parse(
        await fs.readFile(path.join(packageDir, 'package.json'), 'utf-8'),
      )

      expect(pkgJson.bin).toEqual({
        socket: './dist/bootstrap.js',
      })
    })

    it('should have all platform optional dependencies', async () => {
      const pkgJson = JSON.parse(
        await fs.readFile(path.join(packageDir, 'package.json'), 'utf-8'),
      )

      const expectedPlatforms = [
        '@socketbin/cli-alpine-arm64',
        '@socketbin/cli-alpine-x64',
        '@socketbin/cli-darwin-arm64',
        '@socketbin/cli-darwin-x64',
        '@socketbin/cli-linux-arm64',
        '@socketbin/cli-linux-x64',
        '@socketbin/cli-win32-arm64',
        '@socketbin/cli-win32-x64',
      ]

      expect(pkgJson.optionalDependencies).toBeDefined()
      for (const platformPkg of expectedPlatforms) {
        expect(pkgJson.optionalDependencies[platformPkg]).toMatch(/^\^?\d+\.\d+\.\d+/)
      }
    })

    it('should include required files', async () => {
      const pkgJson = JSON.parse(
        await fs.readFile(path.join(packageDir, 'package.json'), 'utf-8'),
      )

      expect(pkgJson.files).toContain('dist/**')
    })
  })

  describe('dist scripts exist', () => {
    it('should have bootstrap.js', () => {
      expect(existsSync(bootstrapPath)).toBe(true)
    })

    it('bootstrap.js should be executable', async () => {
      if (platform() !== 'win32') {
        const stats = await fs.stat(bootstrapPath)
        // Check if user execute bit is set.
        expect((stats.mode & 0o100) !== 0).toBe(true)
      }
    })

    it('bootstrap.js should have node shebang', async () => {
      const content = await fs.readFile(bootstrapPath, 'utf-8')
      expect(content.startsWith('#!/usr/bin/env node')).toBe(true)
    })
  })

  describe('bootstrap logic', () => {
    let testDir
    let originalHome

    beforeEach(async () => {
      // Create temp directory for test.
      testDir = await fs.mkdtemp(path.join(tmpdir(), 'socket-test-'))
      originalHome = process.env.HOME
      // Mock home directory to avoid polluting real home.
      process.env.HOME = testDir
    })

    afterEach(async () => {
      // Restore original home.
      process.env.HOME = originalHome
      // Clean up test directory.
      try {
        await fs.rm(testDir, { recursive: true, force: true })
      } catch {
        // Ignore cleanup errors.
      }
    })

    it.skip('should download and cache CLI on first run', async () => {
      // This test actually downloads from npm - requires npm to be available.
      // Enable with: TEST_NPM_DOWNLOAD=1 pnpm test
      if (!process.env.TEST_NPM_DOWNLOAD) {
        return
      }

      const result = spawnSync(process.execPath, [bootstrapPath, '--version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 60000, // 60s for npm download.
      })

      // Should succeed.
      expect(result.status).toBe(0)

      // Should output version.
      const stdout = result.stdout?.toString() ?? ''
      expect(stdout).toMatch(/\d+\.\d+\.\d+/)

      // Should have cached CLI.
      const cliPath = path.join(testDir, '.socket', '_dlx', 'cli', 'dist', 'cli.js')
      expect(existsSync(cliPath)).toBe(true)
    }, 120000) // 2 min timeout

    it('should use local CLI path when SOCKET_CLI_LOCAL_PATH is set', async () => {
      // Create mock CLI directory.
      const mockCliDir = path.join(testDir, 'mock-cli')
      await fs.mkdir(mockCliDir, { recursive: true })

      // Create mock CLI that just prints version.
      const mockCliPath = path.join(mockCliDir, 'cli.js')
      const mockCli = `
        console.log('1.0.0-mock')
        process.exit(0)
      `
      await fs.writeFile(mockCliPath, mockCli)

      const result = spawnSync(process.execPath, [bootstrapPath, '--version'], {
        env: {
          ...process.env,
          HOME: testDir,
          SOCKET_CLI_LOCAL_PATH: mockCliPath,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 5000,
      })

      expect(result.status).toBe(0)
      expect(result.stdout?.toString()).toContain('1.0.0-mock')
    })

    it('should pass arguments to delegated CLI', async () => {
      // Create mock CLI directory.
      const mockCliDir = path.join(testDir, 'mock-cli-args')
      await fs.mkdir(mockCliDir, { recursive: true })

      // Create mock CLI that echoes args.
      const mockCliPath = path.join(mockCliDir, 'cli.js')
      const mockCli = `
        console.log(JSON.stringify(process.argv.slice(2)))
        process.exit(0)
      `
      await fs.writeFile(mockCliPath, mockCli)

      const result = spawnSync(
        process.execPath,
        [bootstrapPath, 'report', '--json', 'lodash'],
        {
          env: {
            ...process.env,
            HOME: testDir,
            SOCKET_CLI_LOCAL_PATH: mockCliPath,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 5000,
        },
      )

      expect(result.status).toBe(0)
      const args = JSON.parse(result.stdout?.toString())
      expect(args).toEqual(['report', '--json', 'lodash'])
    })

    it('should exit with CLI exit code', async () => {
      // Create mock CLI directory.
      const mockCliDir = path.join(testDir, 'mock-cli-exit')
      await fs.mkdir(mockCliDir, { recursive: true })

      // Create mock CLI that exits with code 42.
      const mockCliPath = path.join(mockCliDir, 'cli.js')
      const mockCli = `
        process.exit(42)
      `
      await fs.writeFile(mockCliPath, mockCli)

      const result = spawnSync(process.execPath, [bootstrapPath], {
        env: {
          ...process.env,
          HOME: testDir,
          SOCKET_CLI_LOCAL_PATH: mockCliPath,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 5000,
      })

      expect(result.status).toBe(42)
    })
  })

  describe('error handling', () => {
    it('should handle invalid local CLI path gracefully', async () => {
      const testDir = await fs.mkdtemp(path.join(tmpdir(), 'socket-test-'))
      const originalHome = process.env.HOME

      try {
        // Create an invalid CLI file (not a valid JS file).
        const invalidCliDir = path.join(testDir, 'invalid-cli')
        await fs.mkdir(invalidCliDir, { recursive: true })
        const invalidCliPath = path.join(invalidCliDir, 'bad-cli.js')
        await fs.writeFile(invalidCliPath, 'this is not valid javascript {{{')

        const result = spawnSync(process.execPath, [bootstrapPath, '--version'], {
          env: {
            ...process.env,
            HOME: testDir,
            SOCKET_CLI_LOCAL_PATH: invalidCliPath,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 5000,
        })

        // Should fail gracefully.
        expect(result.status).not.toBe(0)
      } finally {
        process.env.HOME = originalHome
        await fs.rm(testDir, { recursive: true, force: true }).catch(() => {})
      }
    })
  })

  describe('README documentation', () => {
    it('should have README.md', () => {
      const readmePath = path.join(packageDir, 'README.md')
      expect(existsSync(readmePath)).toBe(true)
    })

    it('README should document installation', async () => {
      const readmePath = path.join(packageDir, 'README.md')
      const readme = await fs.readFile(readmePath, 'utf-8')
      expect(readme).toContain('npm install')
      expect(readme).toContain('socket')
    })

    it('README should document how it works', async () => {
      const readmePath = path.join(packageDir, 'README.md')
      const readme = await fs.readFile(readmePath, 'utf-8')
      expect(readme).toContain('@socketsecurity/cli')
      expect(readme).toContain('~/.socket')
    })

    it('README should document platform binaries', async () => {
      const readmePath = path.join(packageDir, 'README.md')
      const readme = await fs.readFile(readmePath, 'utf-8')
      expect(readme).toContain('@socketbin')
      expect(readme).toContain('darwin')
      expect(readme).toContain('linux')
      expect(readme).toContain('win32')
    })
  })
})
