import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { isDirSync } from '@socketsecurity/registry/lib/fs'
import { logger } from '@socketsecurity/registry/lib/logger'
import { spawn } from '@socketsecurity/registry/lib/spawn'

import constants from '../../constants.mts'
import { InputError, getErrorMessage } from '../../utils/errors.mts'

function normalizePackageName(name: string): string {
  return name.toLowerCase().replaceAll(/[._-]+/g, '-')
}

function validateSbom(content: string, packageName: string): void {
  try {
    const sbom = JSON.parse(content) as {
      bomFormat?: string
      dependencies?: unknown[]
      metadata?: { component?: { name?: string } }
    }
    const rootName = sbom?.metadata?.component?.name
    if (
      sbom?.bomFormat === 'CycloneDX' &&
      Array.isArray(sbom.dependencies) &&
      typeof rootName === 'string' &&
      normalizePackageName(rootName) === packageName
    ) {
      return
    }
  } catch {}
  throw new InputError(
    `uv did not return a CycloneDX dependency graph rooted at "${packageName}". Update uv and try again.`,
  )
}

export async function generateUvPackageSboms({
  outputDir,
  packageNames,
  projectRoot,
}: {
  outputDir: string
  packageNames: string[]
  projectRoot: string
}): Promise<string[]> {
  const paths: string[] = []
  for (const packageName of normalizeUvPackageNames(packageNames)) {
    logger.info(`Exporting the uv dependency graph for ${packageName}...`)
    let content: string
    try {
      // Export each package separately so each SBOM has its own project root.
      // eslint-disable-next-line no-await-in-loop
      const { stdout } = await spawn(
        'uv',
        [
          'export',
          '--project',
          projectRoot,
          '--package',
          packageName,
          '--format',
          'cyclonedx1.5',
          '--frozen',
          '--offline',
          '--no-python-downloads',
          '--all-extras',
          '--all-groups',
        ],
        {
          cwd: projectRoot,
          signal: constants.abortSignal,
          stdio: 'pipe',
        },
      )
      content = stdout
    } catch (e) {
      throw new InputError(
        `Could not export uv package "${packageName}" from ${projectRoot}. Install uv on PATH with CycloneDX export support and check that this package is in the shared uv.lock.`,
        e && typeof e === 'object' && 'stderr' in e
          ? String(e.stderr).trim() || getErrorMessage(e)
          : getErrorMessage(e),
      )
    }
    validateSbom(content, packageName)
    // Keep workspace-relative paths in the SBOM relative to the upload root.
    const filename = path.join(outputDir, `socket-${packageName}-cdx.json`)
    // eslint-disable-next-line no-await-in-loop
    await fs.mkdir(outputDir, { recursive: true })
    // eslint-disable-next-line no-await-in-loop
    await fs.writeFile(filename, content)
    paths.push(filename)
  }
  return paths
}

export function normalizeUvPackageNames(values: readonly string[]): string[] {
  for (const value of values) {
    if (!/^[a-z\d](?:[a-z\d._-]*[a-z\d])?$/i.test(value)) {
      throw new InputError(
        '--uv-package expects a project.name from pyproject.toml, such as "api". Repeat the flag to select more packages.',
      )
    }
  }
  return Array.from(new Set(values.map(normalizePackageName)))
}

export function resolveUvProjectRoot(targets: string[], cwd: string): string {
  if (targets.length !== 1) {
    throw new InputError(
      '--uv-package requires exactly one uv project root as TARGET',
    )
  }
  const projectRoot = path.resolve(cwd, targets[0]!)
  const relativeRoot = path.relative(cwd, projectRoot)
  if (
    relativeRoot === '..' ||
    relativeRoot.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeRoot) ||
    !isDirSync(projectRoot)
  ) {
    throw new InputError(
      '--uv-package requires a target directory inside --cwd',
    )
  }
  if (
    !existsSync(path.join(projectRoot, 'pyproject.toml')) ||
    !existsSync(path.join(projectRoot, 'uv.lock'))
  ) {
    throw new InputError(
      '--uv-package requires pyproject.toml and uv.lock in the target directory',
    )
  }
  return projectRoot
}
