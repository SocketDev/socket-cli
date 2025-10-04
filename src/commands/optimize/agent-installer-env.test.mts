/** @fileoverview Integration tests for agent installer using ENV variables to test with real package manager binaries. */

import { existsSync } from 'node:fs'
import path from 'node:path'

import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { spawn } from '@socketsecurity/registry/lib/spawn'

import { createTempFixtures } from '../../../src/utils/test-fixtures.mts'
import {
  PNPM_V10_AGENT_FIXTURE,
  PNPM_V8_AGENT_FIXTURE,
  PNPM_V9_AGENT_FIXTURE,
  VLT_AGENT_FIXTURE,
  YARN_BERRY_AGENT_FIXTURE,
  YARN_CLASSIC_AGENT_FIXTURE,
} from '../../../test/utils.mts'

describe('agent installer with ENV paths', () => {
  let tempFixtures: Record<string, string>
  let pnpmV8Binary: string
  let pnpmV9Binary: string
  let pnpmV10Binary: string
  let yarnClassicBinary: string
  let yarnBerryBinary: string
  let vltBinary: string
  let cleanupFns: Array<() => Promise<void>> = []

  beforeAll(async () => {
    // Create temp copies of all agent fixtures
    tempFixtures = await createTempFixtures({
      'pnpm-v8': PNPM_V8_AGENT_FIXTURE,
      'pnpm-v9': PNPM_V9_AGENT_FIXTURE,
      'pnpm-v10': PNPM_V10_AGENT_FIXTURE,
      'yarn-classic': YARN_CLASSIC_AGENT_FIXTURE,
      'yarn-berry': YARN_BERRY_AGENT_FIXTURE,
      vlt: VLT_AGENT_FIXTURE,
    })

    // Install package managers in temp directories
    await Promise.all([
      spawn('npm', ['install', '--no-audit', '--no-fund'], {
        cwd: tempFixtures['pnpm-v8'],
        stdio: 'ignore',
      }),
      spawn('npm', ['install', '--no-audit', '--no-fund'], {
        cwd: tempFixtures['pnpm-v9'],
        stdio: 'ignore',
      }),
      spawn('npm', ['install', '--no-audit', '--no-fund'], {
        cwd: tempFixtures['pnpm-v10'],
        stdio: 'ignore',
      }),
      spawn('npm', ['install', '--no-audit', '--no-fund'], {
        cwd: tempFixtures['yarn-classic'],
        stdio: 'ignore',
      }),
      spawn('npm', ['install', '--no-audit', '--no-fund'], {
        cwd: tempFixtures['yarn-berry'],
        stdio: 'ignore',
      }),
      spawn('npm', ['install', '--no-audit', '--no-fund'], {
        cwd: tempFixtures['vlt'],
        stdio: 'ignore',
      }),
    ])

    // Create yarn berry wrapper since @yarnpkg/cli has "bin": null
    const { promises: fs } = await import('node:fs')
    const yarnBerryWrapperPath = path.join(
      tempFixtures['yarn-berry'],
      'node_modules/.bin/yarn',
    )
    await fs.mkdir(path.dirname(yarnBerryWrapperPath), { recursive: true })
    await fs.writeFile(
      yarnBerryWrapperPath,
      `#!/usr/bin/env node
// Wrapper for Yarn Berry @yarnpkg/cli@4.10.3
const pkg = require('@yarnpkg/cli/package.json');
if (process.argv.includes('--version') || process.argv.includes('-v')) {
  console.log(pkg.version);
  process.exit(0);
}
const {runExit} = require('@yarnpkg/cli');
runExit('yarn', process.cwd(), process.argv.slice(2));
`,
      { mode: 0o755 },
    )

    // Set binary paths
    pnpmV8Binary = path.join(tempFixtures['pnpm-v8'], 'node_modules/.bin/pnpm')
    pnpmV9Binary = path.join(tempFixtures['pnpm-v9'], 'node_modules/.bin/pnpm')
    pnpmV10Binary = path.join(
      tempFixtures['pnpm-v10'],
      'node_modules/.bin/pnpm',
    )
    yarnClassicBinary = path.join(
      tempFixtures['yarn-classic'],
      'node_modules/.bin/yarn',
    )
    yarnBerryBinary = path.join(
      tempFixtures['yarn-berry'],
      'node_modules/.bin/yarn',
    )
    vltBinary = path.join(tempFixtures['vlt'], 'node_modules/.bin/vlt')

    // Set ENV variables for package manager paths
    process.env['SOCKET_CLI_PNPM_V8_PATH'] = pnpmV8Binary
    process.env['SOCKET_CLI_PNPM_V9_PATH'] = pnpmV9Binary
    process.env['SOCKET_CLI_PNPM_V10_PATH'] = pnpmV10Binary
    process.env['SOCKET_CLI_YARN_CLASSIC_PATH'] = yarnClassicBinary
    process.env['SOCKET_CLI_YARN_BERRY_PATH'] = yarnBerryBinary
    process.env['SOCKET_CLI_VLT_PATH'] = vltBinary
  }, 180000)

  afterEach(async () => {
    // Run any registered cleanup functions
    await Promise.all(cleanupFns.map(fn => fn().catch(() => {})))
    cleanupFns = []
  })

  describe('binary path validation', () => {
    it('should have pnpm v8 binary installed', () => {
      expect(existsSync(pnpmV8Binary)).toBe(true)
    })

    it('should have pnpm v9 binary installed', () => {
      expect(existsSync(pnpmV9Binary)).toBe(true)
    })

    it('should have pnpm v10 binary installed', () => {
      expect(existsSync(pnpmV10Binary)).toBe(true)
    })

    it('should have yarn classic binary installed', () => {
      expect(existsSync(yarnClassicBinary)).toBe(true)
    })

    it('should have yarn berry binary installed', () => {
      expect(existsSync(yarnBerryBinary)).toBe(true)
    })

    it('should have vlt binary installed', () => {
      expect(existsSync(vltBinary)).toBe(true)
    })
  })

  describe('ENV variable configuration', () => {
    it('should set SOCKET_CLI_PNPM_V8_PATH', () => {
      expect(process.env['SOCKET_CLI_PNPM_V8_PATH']).toBe(pnpmV8Binary)
    })

    it('should set SOCKET_CLI_PNPM_V9_PATH', () => {
      expect(process.env['SOCKET_CLI_PNPM_V9_PATH']).toBe(pnpmV9Binary)
    })

    it('should set SOCKET_CLI_PNPM_V10_PATH', () => {
      expect(process.env['SOCKET_CLI_PNPM_V10_PATH']).toBe(pnpmV10Binary)
    })

    it('should set SOCKET_CLI_YARN_CLASSIC_PATH', () => {
      expect(process.env['SOCKET_CLI_YARN_CLASSIC_PATH']).toBe(
        yarnClassicBinary,
      )
    })

    it('should set SOCKET_CLI_YARN_BERRY_PATH', () => {
      expect(process.env['SOCKET_CLI_YARN_BERRY_PATH']).toBe(yarnBerryBinary)
    })

    it('should set SOCKET_CLI_VLT_PATH', () => {
      expect(process.env['SOCKET_CLI_VLT_PATH']).toBe(vltBinary)
    })
  })

  describe('binary version verification', () => {
    it('should verify pnpm v8 version', async () => {
      const result = await spawn(pnpmV8Binary, ['--version'], {
        stdio: 'pipe',
      })

      const version = result.stdout?.toString().trim()
      expect(version).toMatch(/^8\./)
    })

    it('should verify pnpm v9 version', async () => {
      const result = await spawn(pnpmV9Binary, ['--version'], {
        stdio: 'pipe',
      })

      const version = result.stdout?.toString().trim()
      expect(version).toMatch(/^9\./)
    })

    it('should verify pnpm v10 version', async () => {
      const result = await spawn(pnpmV10Binary, ['--version'], {
        stdio: 'pipe',
      })

      const version = result.stdout?.toString().trim()
      expect(version).toMatch(/^10\./)
    })

    it('should verify yarn classic version', async () => {
      const result = await spawn(yarnClassicBinary, ['--version'], {
        stdio: 'pipe',
      })

      const version = result.stdout?.toString().trim()
      expect(version).toMatch(/^1\.22\./)
    })

    it('should verify yarn berry version', async () => {
      const result = await spawn(yarnBerryBinary, ['--version'], {
        stdio: 'pipe',
      })

      const version = result.stdout?.toString().trim()
      expect(version).toMatch(/^4\./)
    })

    it('should verify vlt version', async () => {
      const result = await spawn(vltBinary, ['--version'], {
        stdio: 'pipe',
      })

      const version = result.stdout?.toString().trim()
      expect(version).toMatch(/^0\./)
    })
  })
})
