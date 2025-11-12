/** @fileoverview Workspace test helpers for Socket CLI. Provides utilities for creating and managing temporary test workspaces with package manifests, lockfiles, and source files. */

import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { safeDelete, safeMkdir } from '@socketsecurity/lib/fs'

/**
 * File content specification for workspace setup
 */
export interface WorkspaceFile {
  /** File path relative to workspace root */
  path: string
  /** File content (string or JSON-serializable object) */
  content: string | Record<string, unknown>
}

/**
 * Package.json configuration
 */
export interface PackageJsonConfig {
  /** Package name */
  name?: string | undefined
  /** Package version */
  version?: string | undefined
  /** Dependencies map */
  dependencies?: Record<string, string> | undefined
  /** DevDependencies map */
  devDependencies?: Record<string, string> | undefined
  /** Scripts map */
  scripts?: Record<string, string> | undefined
  /** Additional package.json fields */
  [key: string]: unknown
}

/**
 * Workspace configuration
 */
export interface WorkspaceConfig {
  /** Workspace files to create */
  files?: WorkspaceFile[] | undefined
  /** Package.json configuration */
  packageJson?: PackageJsonConfig | undefined
  /** Whether to initialize git repository (default: false) */
  initGit?: boolean | undefined
  /** Whether to create node_modules directory (default: false) */
  createNodeModules?: boolean | undefined
}

/**
 * Workspace instance with cleanup capability
 */
export interface Workspace {
  /** Absolute path to workspace directory */
  path: string
  /** Cleanup function to remove workspace */
  cleanup: () => Promise<void>
  /** Write additional file to workspace */
  writeFile: (relativePath: string, content: string) => Promise<void>
  /** Read file from workspace */
  readFile: (relativePath: string) => Promise<string>
  /** Check if file exists in workspace */
  fileExists: (relativePath: string) => Promise<boolean>
  /** Get absolute path for relative path in workspace */
  resolve: (...segments: string[]) => string
}

/**
 * Create a temporary test workspace with specified files and configuration.
 *
 * @param config - Workspace configuration
 * @returns Workspace instance with cleanup
 *
 * @example
 * ```typescript
 * const workspace = await createTestWorkspace({
 *   packageJson: {
 *     name: 'test-project',
 *     dependencies: { express: '^4.18.0' }
 *   },
 *   files: [
 *     { path: 'index.js', content: 'console.log("hello")' }
 *   ]
 * })
 *
 * // Use workspace
 * const result = await executeCliCommand(['scan'], { cwd: workspace.path })
 *
 * // Cleanup
 * await workspace.cleanup()
 * ```
 */
export async function createTestWorkspace(
  config?: WorkspaceConfig | undefined,
): Promise<Workspace> {
  const {
    createNodeModules = false,
    files = [],
    initGit = false,
    packageJson,
  } = {
    __proto__: null,
    ...config,
  } as WorkspaceConfig

  // Create unique temporary directory
  const tempBaseDir = tmpdir()
  const tempDirName = `socket-cli-workspace-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const workspacePath = path.join(tempBaseDir, tempDirName)

  await safeMkdir(workspacePath, { recursive: true })

  // Create package.json if specified
  if (packageJson) {
    const pkgContent = {
      name: 'test-workspace',
      version: '1.0.0',
      ...packageJson,
    }
    await fs.writeFile(
      path.join(workspacePath, 'package.json'),
      JSON.stringify(pkgContent, null, 2),
      'utf8',
    )
  }

  // Create specified files
  for (const file of files) {
    const filePath = path.join(workspacePath, file.path)
    const fileDir = path.dirname(filePath)
    // eslint-disable-next-line no-await-in-loop
    await safeMkdir(fileDir, { recursive: true })

    const content =
      typeof file.content === 'string'
        ? file.content
        : JSON.stringify(file.content, null, 2)

    // eslint-disable-next-line no-await-in-loop
    await fs.writeFile(filePath, content, 'utf8')
  }

  // Create node_modules directory if requested
  if (createNodeModules) {
    await safeMkdir(path.join(workspacePath, 'node_modules'), {
      recursive: true,
    })
  }

  // Initialize git repository if requested
  if (initGit) {
    await safeMkdir(path.join(workspacePath, '.git'), { recursive: true })
  }

  // Create workspace instance
  const workspace: Workspace = {
    path: workspacePath,

    cleanup: async () => {
      try {
        await safeDelete(workspacePath)
      } catch {
        // Ignore cleanup errors.
      }
    },

    fileExists: async (relativePath: string) => {
      try {
        await fs.access(path.join(workspacePath, relativePath))
        return true
      } catch {
        return false
      }
    },

    readFile: async (relativePath: string) => {
      return fs.readFile(path.join(workspacePath, relativePath), 'utf8')
    },

    resolve: (...segments: string[]) => {
      return path.join(workspacePath, ...segments)
    },

    writeFile: async (relativePath: string, content: string) => {
      const filePath = path.join(workspacePath, relativePath)
      const fileDir = path.dirname(filePath)
      await safeMkdir(fileDir, { recursive: true })
      await fs.writeFile(filePath, content, 'utf8')
    },
  }

  return workspace
}

/**
 * Execute a test function with a temporary workspace, automatically cleaning up.
 *
 * @param config - Workspace configuration
 * @param testFn - Test function to execute with workspace
 * @returns Result of test function
 *
 * @example
 * ```typescript
 * await withTestWorkspace(
 *   {
 *     packageJson: { name: 'test-app' },
 *     files: [{ path: 'index.js', content: 'module.exports = {}' }]
 *   },
 *   async (workspace) => {
 *     const result = await executeCliCommand(['scan'], { cwd: workspace.path })
 *     expect(result.status).toBe(true)
 *   }
 * )
 * ```
 */
export async function withTestWorkspace<T>(
  config: WorkspaceConfig | undefined,
  testFn: (workspace: Workspace) => Promise<T>,
): Promise<T> {
  const workspace = await createTestWorkspace(config)
  try {
    return await testFn(workspace)
  } finally {
    await workspace.cleanup()
  }
}

/**
 * Create workspace with common package manager lockfiles.
 *
 * @param packageManager - Package manager type
 * @param dependencies - Dependencies to include
 * @returns Workspace instance
 *
 * @example
 * ```typescript
 * const workspace = await createWorkspaceWithLockfile('npm', {
 *   express: '^4.18.0',
 *   lodash: '^4.17.21'
 * })
 * ```
 */
export async function createWorkspaceWithLockfile(
  packageManager: 'npm' | 'pnpm' | 'yarn',
  dependencies: Record<string, string>,
): Promise<Workspace> {
  const config: WorkspaceConfig = {
    packageJson: {
      dependencies,
      name: 'test-lockfile',
    },
  }

  const workspace = await createTestWorkspace(config)

  // Create appropriate lockfile
  if (packageManager === 'npm') {
    const lockfile = {
      lockfileVersion: 3,
      name: 'test-lockfile',
      packages: {},
      requires: true,
    }
    await workspace.writeFile(
      'package-lock.json',
      JSON.stringify(lockfile, null, 2),
    )
  } else if (packageManager === 'pnpm') {
    const lockfile = `lockfileVersion: '9.0'
settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

importers:
  .:
    dependencies:
${Object.entries(dependencies)
  .map(([name, version]) => `      ${name}:\n        specifier: ${version}`)
  .join('\n')}
`
    await workspace.writeFile('pnpm-lock.yaml', lockfile)
  } else if (packageManager === 'yarn') {
    const lockfile = `# THIS IS AN AUTOGENERATED FILE. DO NOT EDIT THIS FILE DIRECTLY.
# yarn lockfile v1

${Object.entries(dependencies)
  .map(
    ([name, version]) =>
      `${name}@${version}:\n  version "${version.replace(/^\^|~/, '')}"\n  resolved "https://registry.yarnpkg.com/..."\n  integrity sha512-xxx\n`,
  )
  .join('\n')}
`
    await workspace.writeFile('yarn.lock', lockfile)
  }

  return workspace
}

/**
 * Create workspace configured for monorepo structure.
 *
 * @param packages - Package configurations keyed by package name
 * @returns Workspace instance
 *
 * @example
 * ```typescript
 * const workspace = await createMonorepoWorkspace({
 *   'packages/app': {
 *     name: '@myorg/app',
 *     dependencies: { express: '^4.18.0' }
 *   },
 *   'packages/utils': {
 *     name: '@myorg/utils',
 *     version: '1.0.0'
 *   }
 * })
 * ```
 */
export async function createMonorepoWorkspace(
  packages: Record<string, PackageJsonConfig>,
): Promise<Workspace> {
  const files: WorkspaceFile[] = []

  // Create package.json for each package
  for (const [pkgPath, pkgConfig] of Object.entries(packages)) {
    files.push({
      content: pkgConfig,
      path: path.join(pkgPath, 'package.json'),
    })
  }

  const workspace = await createTestWorkspace({
    files,
    packageJson: {
      name: 'monorepo-root',
      private: true,
      workspaces: Object.keys(packages),
    },
  })

  return workspace
}

/**
 * Setup package.json with specific dependency configuration.
 *
 * @param workspace - Workspace instance
 * @param dependencies - Dependencies to add
 * @param devDependencies - DevDependencies to add
 *
 * @example
 * ```typescript
 * await setupPackageJson(workspace, { express: '^4.18.0' }, { vitest: '^3.0.0' })
 * ```
 */
export async function setupPackageJson(
  workspace: Workspace,
  dependencies?: Record<string, string> | undefined,
  devDependencies?: Record<string, string> | undefined,
): Promise<void> {
  const pkgPath = workspace.resolve('package.json')
  let pkg: Record<string, unknown> = {}

  try {
    const content = await fs.readFile(pkgPath, 'utf8')
    pkg = JSON.parse(content)
  } catch {
    pkg = { name: 'test-package', version: '1.0.0' }
  }

  if (dependencies) {
    pkg['dependencies'] = {
      ...(typeof pkg['dependencies'] === 'object' ? pkg['dependencies'] : {}),
      ...dependencies,
    }
  }

  if (devDependencies) {
    pkg['devDependencies'] = {
      ...(typeof pkg['devDependencies'] === 'object'
        ? pkg['devDependencies']
        : {}),
      ...devDependencies,
    }
  }

  await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2), 'utf8')
}

/**
 * Create workspace with Socket.dev configuration file.
 *
 * @param socketConfig - Socket configuration object
 * @returns Workspace instance
 *
 * @example
 * ```typescript
 * const workspace = await createWorkspaceWithSocketConfig({
 *   version: 2,
 *   issueRules: {
 *     '*': { 'npm/install-scripts': 'error' }
 *   }
 * })
 * ```
 */
export async function createWorkspaceWithSocketConfig(
  socketConfig: Record<string, unknown>,
): Promise<Workspace> {
  const workspace = await createTestWorkspace()
  await workspace.writeFile(
    '.socketrc.json',
    JSON.stringify(socketConfig, null, 2),
  )
  return workspace
}
