/** @fileoverview Project context awareness for better CLI UX. */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

interface ProjectContext {
  type: 'npm' | 'yarn' | 'pnpm' | 'unknown'
  root: string
  packageManager?: string
  hasLockFile: boolean
  framework?: string
  isMonorepo: boolean
  workspaces?: string[]
}

/**
 * Detect the package manager being used in the project
 */
export async function detectPackageManager(
  cwd: string,
): Promise<ProjectContext['type']> {
  // Check for lock files
  if (existsSync(join(cwd, 'pnpm-lock.yaml'))) {
    return 'pnpm'
  }
  if (existsSync(join(cwd, 'yarn.lock'))) {
    return 'yarn'
  }
  if (existsSync(join(cwd, 'package-lock.json'))) {
    return 'npm'
  }

  // Check packageManager field in package.json
  const pkgPath = join(cwd, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
      if (pkg.packageManager) {
        if (pkg.packageManager.startsWith('pnpm')) {
          return 'pnpm'
        }
        if (pkg.packageManager.startsWith('yarn')) {
          return 'yarn'
        }
        if (pkg.packageManager.startsWith('npm')) {
          return 'npm'
        }
      }
    } catch {
      // Ignore parse errors
    }
  }

  return 'unknown'
}

/**
 * Find the project root by looking for package.json
 */
export async function findProjectRoot(
  startDir: string,
): Promise<string | null> {
  let currentDir = startDir

  while (currentDir !== dirname(currentDir)) {
    if (existsSync(join(currentDir, 'package.json'))) {
      return currentDir
    }
    currentDir = dirname(currentDir)
  }

  return null
}

/**
 * Detect if this is a monorepo
 */
async function isMonorepo(root: string): Promise<boolean> {
  const pkgPath = join(root, 'package.json')
  if (!existsSync(pkgPath)) {
    return false
  }

  try {
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
    // Check for workspaces (npm/yarn/pnpm)
    if (pkg.workspaces) {
      return true
    }

    // Check for lerna
    if (existsSync(join(root, 'lerna.json'))) {
      return true
    }

    // Check for rush
    if (existsSync(join(root, 'rush.json'))) {
      return true
    }

    // Check for nx
    if (existsSync(join(root, 'nx.json'))) {
      return true
    }

    // Check for pnpm workspaces
    if (existsSync(join(root, 'pnpm-workspace.yaml'))) {
      return true
    }
  } catch {
    // Ignore errors
  }

  return false
}

/**
 * Detect the framework being used
 */
async function detectFramework(root: string): Promise<string | undefined> {
  const pkgPath = join(root, 'package.json')
  if (!existsSync(pkgPath)) {
    return undefined
  }

  try {
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }

    // React-based
    if (deps.next) {
      return 'next'
    }
    if (deps.react) {
      return 'react'
    }

    // Vue-based
    if (deps.nuxt) {
      return 'nuxt'
    }
    if (deps.vue) {
      return 'vue'
    }

    // Angular
    if (deps['@angular/core']) {
      return 'angular'
    }

    // Svelte
    if (deps.svelte || deps['@sveltejs/kit']) {
      return 'svelte'
    }

    // Node.js frameworks
    if (deps.express) {
      return 'express'
    }
    if (deps.fastify) {
      return 'fastify'
    }
    if (deps.koa) {
      return 'koa'
    }

    // Static site generators
    if (deps.gatsby) {
      return 'gatsby'
    }
    if (deps['@11ty/eleventy']) {
      return 'eleventy'
    }
  } catch {
    // Ignore errors
  }

  return undefined
}

/**
 * Get the full project context
 */
export async function getProjectContext(
  cwd: string = process.cwd(),
): Promise<ProjectContext | null> {
  const root = await findProjectRoot(cwd)
  if (!root) {
    return null
  }

  const [packageManager, monorepo, framework] = await Promise.all([
    detectPackageManager(root),
    isMonorepo(root),
    detectFramework(root),
  ])

  const hasLockFile = ['npm', 'yarn', 'pnpm'].includes(packageManager)

  const context: ProjectContext = {
    type: packageManager,
    root,
    hasLockFile,
    isMonorepo: monorepo,
  }

  if (framework !== undefined) {
    context.framework = framework
  }

  return context
}

/**
 * Get smart suggestions based on project context
 */
export function getContextualSuggestions(context: ProjectContext): string[] {
  const suggestions: string[] = []

  // Package manager specific
  if (context.type === 'pnpm' && context.isMonorepo) {
    suggestions.push('Use `socket pnpm --recursive` to scan all workspaces')
  }

  // Framework specific
  if (context.framework === 'next') {
    suggestions.push(
      'Consider using `socket scan --prod` to exclude dev dependencies',
    )
  }

  // Lock file missing
  if (!context.hasLockFile) {
    suggestions.push(
      `Run \`${context.type} install\` to generate a lock file for accurate scanning`,
    )
  }

  return suggestions
}
