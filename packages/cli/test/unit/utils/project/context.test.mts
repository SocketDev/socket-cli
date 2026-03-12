/**
 * Unit tests for project context utilities.
 *
 * Purpose:
 * Tests the project context detection for package managers, frameworks, and monorepos.
 *
 * Test Coverage:
 * - detectPackageManager function
 * - findProjectRoot function
 * - getProjectContext function
 * - getContextualSuggestions function
 *
 * Related Files:
 * - src/utils/project/context.mts (implementation)
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  detectPackageManager,
  findProjectRoot,
  getContextualSuggestions,
  getProjectContext,
} from '../../../../src/utils/project/context.mts'

describe('project context utilities', () => {
  // Create temporary test directories.
  const testRoot = path.join(process.cwd(), '.test-project-context-temp')
  const npmProject = path.join(testRoot, 'npm-project')
  const yarnProject = path.join(testRoot, 'yarn-project')
  const pnpmProject = path.join(testRoot, 'pnpm-project')
  const monorepoProject = path.join(testRoot, 'monorepo-project')
  const frameworkProject = path.join(testRoot, 'framework-project')
  const packageManagerField = path.join(testRoot, 'pm-field-project')
  const noLockProject = path.join(testRoot, 'no-lock-project')
  const nestedProject = path.join(testRoot, 'nested', 'deep', 'project')

  beforeAll(() => {
    // Create npm project.
    mkdirSync(npmProject, { recursive: true })
    writeFileSync(
      path.join(npmProject, 'package.json'),
      JSON.stringify({ name: 'npm-test' }),
    )
    writeFileSync(path.join(npmProject, 'package-lock.json'), '{}')

    // Create yarn project.
    mkdirSync(yarnProject, { recursive: true })
    writeFileSync(
      path.join(yarnProject, 'package.json'),
      JSON.stringify({ name: 'yarn-test' }),
    )
    writeFileSync(path.join(yarnProject, 'yarn.lock'), '')

    // Create pnpm project.
    mkdirSync(pnpmProject, { recursive: true })
    writeFileSync(
      path.join(pnpmProject, 'package.json'),
      JSON.stringify({ name: 'pnpm-test' }),
    )
    writeFileSync(path.join(pnpmProject, 'pnpm-lock.yaml'), '')

    // Create monorepo project.
    mkdirSync(monorepoProject, { recursive: true })
    writeFileSync(
      path.join(monorepoProject, 'package.json'),
      JSON.stringify({
        name: 'monorepo-test',
        workspaces: ['packages/*'],
      }),
    )
    writeFileSync(path.join(monorepoProject, 'package-lock.json'), '{}')

    // Create framework project (React/Next.js).
    mkdirSync(frameworkProject, { recursive: true })
    writeFileSync(
      path.join(frameworkProject, 'package.json'),
      JSON.stringify({
        name: 'framework-test',
        dependencies: { next: '^14.0.0', react: '^18.0.0' },
      }),
    )
    writeFileSync(path.join(frameworkProject, 'package-lock.json'), '{}')

    // Create project with packageManager field.
    mkdirSync(packageManagerField, { recursive: true })
    writeFileSync(
      path.join(packageManagerField, 'package.json'),
      JSON.stringify({
        name: 'pm-field-test',
        packageManager: 'pnpm@8.0.0',
      }),
    )

    // Create project without lock file.
    mkdirSync(noLockProject, { recursive: true })
    writeFileSync(
      path.join(noLockProject, 'package.json'),
      JSON.stringify({ name: 'no-lock-test' }),
    )

    // Create nested project structure.
    mkdirSync(nestedProject, { recursive: true })
    writeFileSync(
      path.join(testRoot, 'nested', 'package.json'),
      JSON.stringify({ name: 'nested-root' }),
    )
    writeFileSync(path.join(testRoot, 'nested', 'package-lock.json'), '{}')
  })

  afterAll(() => {
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true })
    }
  })

  describe('detectPackageManager', () => {
    it('detects npm from package-lock.json', async () => {
      const result = await detectPackageManager(npmProject)

      expect(result).toBe('npm')
    })

    it('detects yarn from yarn.lock', async () => {
      const result = await detectPackageManager(yarnProject)

      expect(result).toBe('yarn')
    })

    it('detects pnpm from pnpm-lock.yaml', async () => {
      const result = await detectPackageManager(pnpmProject)

      expect(result).toBe('pnpm')
    })

    it('detects from packageManager field when no lock file', async () => {
      const result = await detectPackageManager(packageManagerField)

      expect(result).toBe('pnpm')
    })

    it('returns unknown when no indicators found', async () => {
      const result = await detectPackageManager(noLockProject)

      expect(result).toBe('unknown')
    })

    it('prefers lock file over packageManager field', async () => {
      // pnpmProject has pnpm-lock.yaml.
      const result = await detectPackageManager(pnpmProject)

      expect(result).toBe('pnpm')
    })
  })

  describe('findProjectRoot', () => {
    it('finds project root in current directory', async () => {
      const result = await findProjectRoot(npmProject)

      expect(result).toBe(npmProject)
    })

    it('finds project root in parent directory', async () => {
      const result = await findProjectRoot(nestedProject)

      expect(result).toBe(path.join(testRoot, 'nested'))
    })

    it('returns null when no package.json found', async () => {
      const result = await findProjectRoot('/tmp')

      expect(result).toBeNull()
    })
  })

  describe('getProjectContext', () => {
    it('returns full context for npm project', async () => {
      const context = await getProjectContext(npmProject)

      expect(context).not.toBeNull()
      expect(context?.type).toBe('npm')
      expect(context?.root).toBe(npmProject)
      expect(context?.hasLockFile).toBe(true)
      expect(context?.isMonorepo).toBe(false)
    })

    it('detects monorepo configuration', async () => {
      const context = await getProjectContext(monorepoProject)

      expect(context).not.toBeNull()
      expect(context?.isMonorepo).toBe(true)
    })

    it('detects framework from dependencies', async () => {
      const context = await getProjectContext(frameworkProject)

      expect(context).not.toBeNull()
      expect(context?.framework).toBe('next')
    })

    it('returns null for non-project directory', async () => {
      const context = await getProjectContext('/tmp')

      expect(context).toBeNull()
    })

    it('marks hasLockFile false for unknown package manager', async () => {
      const context = await getProjectContext(noLockProject)

      expect(context).not.toBeNull()
      expect(context?.hasLockFile).toBe(false)
      expect(context?.type).toBe('unknown')
    })
  })

  describe('getContextualSuggestions', () => {
    it('suggests recursive for pnpm monorepos', () => {
      const suggestions = getContextualSuggestions({
        type: 'pnpm',
        root: '/test',
        hasLockFile: true,
        isMonorepo: true,
      })

      expect(suggestions).toContainEqual(
        expect.stringContaining('--recursive'),
      )
    })

    it('suggests --prod for Next.js projects', () => {
      const suggestions = getContextualSuggestions({
        type: 'npm',
        root: '/test',
        hasLockFile: true,
        isMonorepo: false,
        framework: 'next',
      })

      expect(suggestions).toContainEqual(expect.stringContaining('--prod'))
    })

    it('suggests generating lock file when missing', () => {
      const suggestions = getContextualSuggestions({
        type: 'unknown',
        root: '/test',
        hasLockFile: false,
        isMonorepo: false,
      })

      expect(suggestions).toContainEqual(
        expect.stringContaining('generate a lock file'),
      )
    })

    it('returns empty array for standard npm project', () => {
      const suggestions = getContextualSuggestions({
        type: 'npm',
        root: '/test',
        hasLockFile: true,
        isMonorepo: false,
      })

      expect(suggestions).toHaveLength(0)
    })
  })
})
