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
import os from 'node:os'
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
  // Use a temp directory outside any project tree to test non-project detection.
  // This ensures no package.json exists in any parent directory.
  const emptyDir = path.join(
    os.tmpdir(),
    `socket-cli-test-empty-${Date.now()}`,
    'deeply',
    'nested',
    'empty',
  )

  beforeAll(() => {
    // Create empty directory (no package.json) for testing non-project detection.
    mkdirSync(emptyDir, { recursive: true })
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
    // Clean up the temp emptyDir base (the unique timestamped directory).
    const emptyDirBase = path.dirname(path.dirname(path.dirname(emptyDir)))
    if (existsSync(emptyDirBase)) {
      rmSync(emptyDirBase, { recursive: true, force: true })
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

    it('detects yarn from packageManager field', async () => {
      const yarnPmProject = path.join(testRoot, 'yarn-pm-field')
      mkdirSync(yarnPmProject, { recursive: true })
      writeFileSync(
        path.join(yarnPmProject, 'package.json'),
        JSON.stringify({
          name: 'yarn-pm-test',
          packageManager: 'yarn@4.0.0',
        }),
      )

      const result = await detectPackageManager(yarnPmProject)
      expect(result).toBe('yarn')

      rmSync(yarnPmProject, { recursive: true, force: true })
    })

    it('detects npm from packageManager field', async () => {
      const npmPmProject = path.join(testRoot, 'npm-pm-field')
      mkdirSync(npmPmProject, { recursive: true })
      writeFileSync(
        path.join(npmPmProject, 'package.json'),
        JSON.stringify({
          name: 'npm-pm-test',
          packageManager: 'npm@10.0.0',
        }),
      )

      const result = await detectPackageManager(npmPmProject)
      expect(result).toBe('npm')

      rmSync(npmPmProject, { recursive: true, force: true })
    })

    it('handles invalid package.json gracefully', async () => {
      const invalidPkgProject = path.join(testRoot, 'invalid-pkg')
      mkdirSync(invalidPkgProject, { recursive: true })
      writeFileSync(path.join(invalidPkgProject, 'package.json'), 'not json')

      const result = await detectPackageManager(invalidPkgProject)
      expect(result).toBe('unknown')

      rmSync(invalidPkgProject, { recursive: true, force: true })
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
      const result = await findProjectRoot(emptyDir)

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
      const context = await getProjectContext(emptyDir)

      expect(context).toBeNull()
    })

    it('marks hasLockFile false for unknown package manager', async () => {
      const context = await getProjectContext(noLockProject)

      expect(context).not.toBeNull()
      expect(context?.hasLockFile).toBe(false)
      expect(context?.type).toBe('unknown')
    })

    it('detects lerna monorepo', async () => {
      const lernaProject = path.join(testRoot, 'lerna-project')
      mkdirSync(lernaProject, { recursive: true })
      writeFileSync(
        path.join(lernaProject, 'package.json'),
        JSON.stringify({ name: 'lerna-test' }),
      )
      writeFileSync(path.join(lernaProject, 'lerna.json'), '{}')
      writeFileSync(path.join(lernaProject, 'package-lock.json'), '{}')

      const context = await getProjectContext(lernaProject)

      expect(context).not.toBeNull()
      expect(context?.isMonorepo).toBe(true)

      rmSync(lernaProject, { recursive: true, force: true })
    })

    it('detects rush monorepo', async () => {
      const rushProject = path.join(testRoot, 'rush-project')
      mkdirSync(rushProject, { recursive: true })
      writeFileSync(
        path.join(rushProject, 'package.json'),
        JSON.stringify({ name: 'rush-test' }),
      )
      writeFileSync(path.join(rushProject, 'rush.json'), '{}')
      writeFileSync(path.join(rushProject, 'package-lock.json'), '{}')

      const context = await getProjectContext(rushProject)

      expect(context).not.toBeNull()
      expect(context?.isMonorepo).toBe(true)

      rmSync(rushProject, { recursive: true, force: true })
    })

    it('detects nx monorepo', async () => {
      const nxProject = path.join(testRoot, 'nx-project')
      mkdirSync(nxProject, { recursive: true })
      writeFileSync(
        path.join(nxProject, 'package.json'),
        JSON.stringify({ name: 'nx-test' }),
      )
      writeFileSync(path.join(nxProject, 'nx.json'), '{}')
      writeFileSync(path.join(nxProject, 'package-lock.json'), '{}')

      const context = await getProjectContext(nxProject)

      expect(context).not.toBeNull()
      expect(context?.isMonorepo).toBe(true)

      rmSync(nxProject, { recursive: true, force: true })
    })

    it('detects pnpm workspace monorepo', async () => {
      const pnpmWorkspaceProject = path.join(testRoot, 'pnpm-workspace-project')
      mkdirSync(pnpmWorkspaceProject, { recursive: true })
      writeFileSync(
        path.join(pnpmWorkspaceProject, 'package.json'),
        JSON.stringify({ name: 'pnpm-ws-test' }),
      )
      writeFileSync(path.join(pnpmWorkspaceProject, 'pnpm-workspace.yaml'), '')
      writeFileSync(path.join(pnpmWorkspaceProject, 'pnpm-lock.yaml'), '')

      const context = await getProjectContext(pnpmWorkspaceProject)

      expect(context).not.toBeNull()
      expect(context?.isMonorepo).toBe(true)

      rmSync(pnpmWorkspaceProject, { recursive: true, force: true })
    })

    it('detects react framework', async () => {
      const reactProject = path.join(testRoot, 'react-project')
      mkdirSync(reactProject, { recursive: true })
      writeFileSync(
        path.join(reactProject, 'package.json'),
        JSON.stringify({
          name: 'react-test',
          dependencies: { react: '^18.0.0' },
        }),
      )
      writeFileSync(path.join(reactProject, 'package-lock.json'), '{}')

      const context = await getProjectContext(reactProject)

      expect(context).not.toBeNull()
      expect(context?.framework).toBe('react')

      rmSync(reactProject, { recursive: true, force: true })
    })

    it('detects vue framework', async () => {
      const vueProject = path.join(testRoot, 'vue-project')
      mkdirSync(vueProject, { recursive: true })
      writeFileSync(
        path.join(vueProject, 'package.json'),
        JSON.stringify({
          name: 'vue-test',
          dependencies: { vue: '^3.0.0' },
        }),
      )
      writeFileSync(path.join(vueProject, 'package-lock.json'), '{}')

      const context = await getProjectContext(vueProject)

      expect(context).not.toBeNull()
      expect(context?.framework).toBe('vue')

      rmSync(vueProject, { recursive: true, force: true })
    })

    it('detects nuxt framework', async () => {
      const nuxtProject = path.join(testRoot, 'nuxt-project')
      mkdirSync(nuxtProject, { recursive: true })
      writeFileSync(
        path.join(nuxtProject, 'package.json'),
        JSON.stringify({
          name: 'nuxt-test',
          dependencies: { nuxt: '^3.0.0', vue: '^3.0.0' },
        }),
      )
      writeFileSync(path.join(nuxtProject, 'package-lock.json'), '{}')

      const context = await getProjectContext(nuxtProject)

      expect(context).not.toBeNull()
      expect(context?.framework).toBe('nuxt')

      rmSync(nuxtProject, { recursive: true, force: true })
    })

    it('detects angular framework', async () => {
      const angularProject = path.join(testRoot, 'angular-project')
      mkdirSync(angularProject, { recursive: true })
      writeFileSync(
        path.join(angularProject, 'package.json'),
        JSON.stringify({
          name: 'angular-test',
          dependencies: { '@angular/core': '^17.0.0' },
        }),
      )
      writeFileSync(path.join(angularProject, 'package-lock.json'), '{}')

      const context = await getProjectContext(angularProject)

      expect(context).not.toBeNull()
      expect(context?.framework).toBe('angular')

      rmSync(angularProject, { recursive: true, force: true })
    })

    it('detects svelte framework', async () => {
      const svelteProject = path.join(testRoot, 'svelte-project')
      mkdirSync(svelteProject, { recursive: true })
      writeFileSync(
        path.join(svelteProject, 'package.json'),
        JSON.stringify({
          name: 'svelte-test',
          dependencies: { svelte: '^4.0.0' },
        }),
      )
      writeFileSync(path.join(svelteProject, 'package-lock.json'), '{}')

      const context = await getProjectContext(svelteProject)

      expect(context).not.toBeNull()
      expect(context?.framework).toBe('svelte')

      rmSync(svelteProject, { recursive: true, force: true })
    })

    it('detects sveltekit framework', async () => {
      const sveltekitProject = path.join(testRoot, 'sveltekit-project')
      mkdirSync(sveltekitProject, { recursive: true })
      writeFileSync(
        path.join(sveltekitProject, 'package.json'),
        JSON.stringify({
          name: 'sveltekit-test',
          dependencies: { '@sveltejs/kit': '^2.0.0' },
        }),
      )
      writeFileSync(path.join(sveltekitProject, 'package-lock.json'), '{}')

      const context = await getProjectContext(sveltekitProject)

      expect(context).not.toBeNull()
      expect(context?.framework).toBe('svelte')

      rmSync(sveltekitProject, { recursive: true, force: true })
    })

    it('detects express framework', async () => {
      const expressProject = path.join(testRoot, 'express-project')
      mkdirSync(expressProject, { recursive: true })
      writeFileSync(
        path.join(expressProject, 'package.json'),
        JSON.stringify({
          name: 'express-test',
          dependencies: { express: '^4.0.0' },
        }),
      )
      writeFileSync(path.join(expressProject, 'package-lock.json'), '{}')

      const context = await getProjectContext(expressProject)

      expect(context).not.toBeNull()
      expect(context?.framework).toBe('express')

      rmSync(expressProject, { recursive: true, force: true })
    })

    it('detects fastify framework', async () => {
      const fastifyProject = path.join(testRoot, 'fastify-project')
      mkdirSync(fastifyProject, { recursive: true })
      writeFileSync(
        path.join(fastifyProject, 'package.json'),
        JSON.stringify({
          name: 'fastify-test',
          dependencies: { fastify: '^4.0.0' },
        }),
      )
      writeFileSync(path.join(fastifyProject, 'package-lock.json'), '{}')

      const context = await getProjectContext(fastifyProject)

      expect(context).not.toBeNull()
      expect(context?.framework).toBe('fastify')

      rmSync(fastifyProject, { recursive: true, force: true })
    })

    it('detects koa framework', async () => {
      const koaProject = path.join(testRoot, 'koa-project')
      mkdirSync(koaProject, { recursive: true })
      writeFileSync(
        path.join(koaProject, 'package.json'),
        JSON.stringify({
          name: 'koa-test',
          dependencies: { koa: '^2.0.0' },
        }),
      )
      writeFileSync(path.join(koaProject, 'package-lock.json'), '{}')

      const context = await getProjectContext(koaProject)

      expect(context).not.toBeNull()
      expect(context?.framework).toBe('koa')

      rmSync(koaProject, { recursive: true, force: true })
    })

    it('detects gatsby framework', async () => {
      const gatsbyProject = path.join(testRoot, 'gatsby-project')
      mkdirSync(gatsbyProject, { recursive: true })
      writeFileSync(
        path.join(gatsbyProject, 'package.json'),
        JSON.stringify({
          name: 'gatsby-test',
          dependencies: { gatsby: '^5.0.0' },
        }),
      )
      writeFileSync(path.join(gatsbyProject, 'package-lock.json'), '{}')

      const context = await getProjectContext(gatsbyProject)

      expect(context).not.toBeNull()
      expect(context?.framework).toBe('gatsby')

      rmSync(gatsbyProject, { recursive: true, force: true })
    })

    it('detects eleventy framework', async () => {
      const eleventyProject = path.join(testRoot, 'eleventy-project')
      mkdirSync(eleventyProject, { recursive: true })
      writeFileSync(
        path.join(eleventyProject, 'package.json'),
        JSON.stringify({
          name: 'eleventy-test',
          devDependencies: { '@11ty/eleventy': '^2.0.0' },
        }),
      )
      writeFileSync(path.join(eleventyProject, 'package-lock.json'), '{}')

      const context = await getProjectContext(eleventyProject)

      expect(context).not.toBeNull()
      expect(context?.framework).toBe('eleventy')

      rmSync(eleventyProject, { recursive: true, force: true })
    })

    it('returns undefined framework when no framework detected', async () => {
      const plainProject = path.join(testRoot, 'plain-project')
      mkdirSync(plainProject, { recursive: true })
      writeFileSync(
        path.join(plainProject, 'package.json'),
        JSON.stringify({
          name: 'plain-test',
          dependencies: { lodash: '^4.17.0' },
        }),
      )
      writeFileSync(path.join(plainProject, 'package-lock.json'), '{}')

      const context = await getProjectContext(plainProject)

      expect(context).not.toBeNull()
      expect(context?.framework).toBeUndefined()

      rmSync(plainProject, { recursive: true, force: true })
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
