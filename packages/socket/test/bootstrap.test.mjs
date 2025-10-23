/**
 * @fileoverview Tests for socket package bootstrap and delegation.
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
const bootstrapPath = path.join(packageDir, 'bin', 'bootstrap.js')
const socketBinPath = path.join(packageDir, 'bin', 'socket.js')

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
        socket: './bin/socket.js',
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

      expect(pkgJson.files).toContain('bin/')
    })
  })

  describe('bin scripts exist', () => {
    it('should have socket.js bin script', () => {
      expect(existsSync(socketBinPath)).toBe(true)
    })

    it('should have bootstrap.js', () => {
      expect(existsSync(bootstrapPath)).toBe(true)
    })

    it('socket.js should be executable', async () => {
      if (platform() !== 'win32') {
        const stats = await fs.stat(socketBinPath)
        // Check if user execute bit is set.
        expect((stats.mode & 0o100) !== 0).toBe(true)
      }
    })

    it('socket.js should have node shebang', async () => {
      const content = await fs.readFile(socketBinPath, 'utf-8')
      expect(content.startsWith('#!/usr/bin/env node')).toBe(true)
    })

    it('socket.js should require bootstrap.js', async () => {
      const content = await fs.readFile(socketBinPath, 'utf-8')
      expect(content).toContain("require('./bootstrap.js')")
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
      const stdout = result.stdout.toString()
      expect(stdout).toMatch(/\d+\.\d+\.\d+/)

      // Should have cached CLI.
      const cliPath = path.join(testDir, '.socket', '_dlx', 'cli', 'dist', 'cli.js')
      expect(existsSync(cliPath)).toBe(true)
    }, 120000) // 2 min timeout

    it('should use cached CLI on subsequent runs', async () => {
      // Pre-create cache directory with mock CLI.
      const cliDir = path.join(testDir, '.socket', '_dlx', 'cli', 'dist')
      await fs.mkdir(cliDir, { recursive: true })

      // Create mock CLI that just prints version.
      const mockCli = `
        console.log('1.0.0-mock')
        process.exit(0)
      `
      await fs.writeFile(path.join(cliDir, 'cli.js'), mockCli)

      const result = spawnSync(process.execPath, [bootstrapPath, '--version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 5000,
      })

      expect(result.status).toBe(0)
      expect(result.stdout.toString()).toContain('1.0.0-mock')
    })

    it('should use compressed CLI when available', async () => {
      // Pre-create cache directory with compressed CLI.
      const cliDir = path.join(testDir, '.socket', '_dlx', 'cli', 'dist')
      await fs.mkdir(cliDir, { recursive: true })

      // Create mock CLI.
      const mockCli = `
        console.log('1.0.0-compressed')
        process.exit(0)
      `
      const compressed = brotliCompressSync(Buffer.from(mockCli))
      await fs.writeFile(path.join(cliDir, 'cli.js.bz'), compressed)

      const result = spawnSync(process.execPath, [bootstrapPath, '--version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 5000,
      })

      expect(result.status).toBe(0)
      expect(result.stdout.toString()).toContain('1.0.0-compressed')
    })

    it('should pass arguments to delegated CLI', async () => {
      // Pre-create cache with mock CLI that echoes args.
      const cliDir = path.join(testDir, '.socket', '_dlx', 'cli', 'dist')
      await fs.mkdir(cliDir, { recursive: true })

      const mockCli = `
        console.log(JSON.stringify(process.argv.slice(2)))
        process.exit(0)
      `
      await fs.writeFile(path.join(cliDir, 'cli.js'), mockCli)

      const result = spawnSync(
        process.execPath,
        [bootstrapPath, 'report', '--json', 'lodash'],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 5000,
        },
      )

      expect(result.status).toBe(0)
      const args = JSON.parse(result.stdout.toString())
      expect(args).toEqual(['report', '--json', 'lodash'])
    })

    it('should set PKG_EXECPATH environment variable', async () => {
      // Pre-create cache with mock CLI that prints env.
      const cliDir = path.join(testDir, '.socket', '_dlx', 'cli', 'dist')
      await fs.mkdir(cliDir, { recursive: true })

      const mockCli = `
        console.log(process.env.PKG_EXECPATH)
        process.exit(0)
      `
      await fs.writeFile(path.join(cliDir, 'cli.js'), mockCli)

      const result = spawnSync(process.execPath, [bootstrapPath, '--version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 5000,
      })

      expect(result.status).toBe(0)
      expect(result.stdout.toString()).toContain('PKG_INVOKE_NODEJS')
    })

    it('should exit with CLI exit code', async () => {
      // Pre-create cache with mock CLI that exits with code 42.
      const cliDir = path.join(testDir, '.socket', '_dlx', 'cli', 'dist')
      await fs.mkdir(cliDir, { recursive: true })

      const mockCli = `
        process.exit(42)
      `
      await fs.writeFile(path.join(cliDir, 'cli.js'), mockCli)

      const result = spawnSync(process.execPath, [bootstrapPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 5000,
      })

      expect(result.status).toBe(42)
    })
  })

  describe('error handling', () => {
    it('should handle missing npm gracefully', async () => {
      const testDir = await fs.mkdtemp(path.join(tmpdir(), 'socket-test-'))
      const originalHome = process.env.HOME
      const originalPath = process.env.PATH

      try {
        process.env.HOME = testDir
        // Set PATH to empty to simulate missing npm.
        process.env.PATH = ''

        const result = spawnSync(process.execPath, [bootstrapPath, '--version'], {
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 5000,
        })

        // Should fail gracefully.
        expect(result.status).not.toBe(0)
        expect(result.stderr.toString()).toContain('Failed to download')
      } finally {
        process.env.HOME = originalHome
        process.env.PATH = originalPath
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
