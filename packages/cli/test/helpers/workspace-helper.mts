/**
 * @file Workspace test helpers for Socket CLI. Provides utilities for creating
 *   and managing temporary test workspaces with package manifests, lockfiles,
 *   and source files.
 */

import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { safeDelete, safeMkdir } from '@socketsecurity/lib-stable/fs/safe'

/**
 * File content specification for workspace setup.
 */
interface WorkspaceFile {
  /**
   * File path relative to workspace root.
   */
  path: string
  /**
   * File content (string or JSON-serializable object)
   */
  content: string | Record<string, unknown>
}

/**
 * Package.json configuration.
 */
interface PackageJsonConfig {
  /**
   * Package name.
   */
  name?: string | undefined
  /**
   * Package version.
   */
  version?: string | undefined
  /**
   * Dependencies map.
   */
  dependencies?: Record<string, string> | undefined
  /**
   * DevDependencies map.
   */
  devDependencies?: Record<string, string> | undefined
  /**
   * Scripts map.
   */
  scripts?: Record<string, string> | undefined
  /**
   * Additional package.json fields.
   */
  [key: string]: unknown
}

/**
 * Workspace configuration.
 */
interface WorkspaceConfig {
  /**
   * Workspace files to create.
   */
  files?: WorkspaceFile[] | undefined
  /**
   * Package.json configuration.
   */
  packageJson?: PackageJsonConfig | undefined
  /**
   * Whether to initialize git repository (default: false)
   */
  initGit?: boolean | undefined
  /**
   * Whether to create node_modules directory (default: false)
   */
  createNodeModules?: boolean | undefined
}

/**
 * Workspace instance with cleanup capability.
 */
export interface Workspace {
  /**
   * Absolute path to workspace directory.
   */
  path: string
  /**
   * Cleanup function to remove workspace.
   */
  cleanup: () => Promise<void>
  /**
   * Write additional file to workspace.
   */
  writeFile: (relativePath: string, content: string) => Promise<void>
  /**
   * Read file from workspace.
   */
  readFile: (relativePath: string) => Promise<string>
  /**
   * Check if file exists in workspace.
   */
  fileExists: (relativePath: string) => boolean
  /**
   * Get absolute path for relative path in workspace.
   */
  resolve: (...segments: string[]) => string
}

/**
 * Create a temporary test workspace with specified files and configuration.
 *
 * @example
 *   ```typescript
 *   const workspace = await createTestWorkspace({
 *     packageJson: {
 *       name: 'test-project',
 *       dependencies: { express: '^4.18.0' },
 *     },
 *     files: [{ path: 'index.js', content: 'console.log("hello")' }],
 *   })
 *
 *   // Use workspace
 *   const result = await executeCliCommand(['scan'], { cwd: workspace.path })
 *
 *   // Cleanup
 *   await workspace.cleanup()
 *   ```
 *
 * @param config - Workspace configuration.
 *
 * @returns Workspace instance with cleanup
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
  const tempBaseDir = os.tmpdir()
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
  for (let i = 0, { length } = files; i < length; i += 1) {
    const file = files[i]!
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

    fileExists: (relativePath: string) => {
      return existsSync(path.join(workspacePath, relativePath))
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

