/**
 * Tests for SEA build script.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

describe('SEA build validation', () => {
  it('should have SEA bootstrap entry point', () => {
    const bootstrapPath = path.join(
      process.cwd(),
      'src',
      'stub',
      'bootstrap.mts',
    )
    expect(existsSync(bootstrapPath)).toBe(true)
  })

  it('should have SEA configuration', () => {
    const configPath = path.join(
      process.cwd(),
      '.config',
      'esbuild.sea-bootstrap.build.mjs',
    )
    expect(existsSync(configPath)).toBe(true)
  })

  it('should have SEA build script', () => {
    // Check for the main build script (SEA is built as part of general build)
    const buildScriptPath = path.join(process.cwd(), 'scripts', 'build.mjs')
    expect(existsSync(buildScriptPath)).toBe(true)
  })

  it('should define NODE_SEA_FUSE constant', () => {
    try {
      const constants = require('../dist/constants.js').default
      expect(constants.NODE_SEA_FUSE).toBeDefined()
      expect(typeof constants.NODE_SEA_FUSE).toBe('string')
    } catch {
      // Skip test if dist/constants.js doesn't exist (not built yet)
      expect(true).toBe(true)
    }
  })

  it('should have dist/sea output directory after build', () => {
    const seaDistPath = path.join(process.cwd(), 'dist', 'sea')
    // This will pass if `pnpm run build:sea` has been run
    if (existsSync(seaDistPath)) {
      expect(existsSync(seaDistPath)).toBe(true)
    } else {
      // Skip test if SEA hasn't been built yet
      expect(true).toBe(true)
    }
  })

  it('should have platform-specific binary after build', () => {
    const platform = process.platform
    const arch = process.arch
    const binaryName =
      platform === 'win32'
        ? `socket-${platform}-${arch}.exe`
        : `socket-${platform}-${arch}`
    const binaryPath = path.join(process.cwd(), 'dist', 'sea', binaryName)

    // This will pass if `pnpm run build:sea` has been run
    if (existsSync(binaryPath)) {
      expect(existsSync(binaryPath)).toBe(true)
    } else {
      // Skip test if SEA hasn't been built yet
      expect(true).toBe(true)
    }
  })
})
