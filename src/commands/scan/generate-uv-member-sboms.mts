import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { isDirSync } from '@socketsecurity/registry/lib/fs'
import { logger } from '@socketsecurity/registry/lib/logger'
import { spawn } from '@socketsecurity/registry/lib/spawn'

import constants from '../../constants.mts'
import { InputError, getErrorMessage } from '../../utils/errors.mts'

type Component = {
  name: string
  version?: string
  purl?: string
  scope?: string
}

type Sbom = {
  bomFormat?: string
  components?: Component[]
  dependencies?: unknown[]
  metadata?: { component?: { name?: string } }
}

function normalizePackageName(name: string): string {
  return name.toLowerCase().replaceAll(/[._-]+/g, '-')
}

function parseSbom(content: string, packageName: string): Sbom {
  try {
    const sbom = JSON.parse(content) as Sbom
    const rootName = sbom?.metadata?.component?.name
    if (
      sbom?.bomFormat === 'CycloneDX' &&
      Array.isArray(sbom.dependencies) &&
      (sbom.components === undefined || Array.isArray(sbom.components)) &&
      typeof rootName === 'string' &&
      normalizePackageName(rootName) === packageName
    ) {
      return sbom
    }
  } catch {}
  throw new InputError(
    `uv did not return a CycloneDX dependency graph rooted at "${packageName}". Update uv and try again.`,
  )
}

function componentIdentity(component: Component): string {
  return JSON.stringify([component.name, component.version, component.purl])
}

async function exportSbom(
  projectRoot: string,
  packageName: string,
  groups: '--all-groups' | '--no-default-groups',
): Promise<Sbom> {
  let content: string
  try {
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
        groups,
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
  return parseSbom(content, packageName)
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
    // eslint-disable-next-line no-await-in-loop
    const sbom = await exportSbom(projectRoot, packageName, '--all-groups')
    // eslint-disable-next-line no-await-in-loop
    const productionSbom = await exportSbom(
      projectRoot,
      packageName,
      '--no-default-groups',
    )
    // uv can renumber bom-ref values between exports.
    const productionPackages = new Set(
      productionSbom.components?.map(componentIdentity),
    )
    for (const component of sbom.components ?? []) {
      component.scope = productionPackages.has(componentIdentity(component))
        ? 'required'
        : 'optional'
    }
    // Keep workspace-relative paths in the SBOM relative to the upload root.
    const filename = path.join(outputDir, `socket-${packageName}-cdx.json`)
    // eslint-disable-next-line no-await-in-loop
    await fs.mkdir(outputDir, { recursive: true })
    // eslint-disable-next-line no-await-in-loop
    await fs.writeFile(filename, JSON.stringify(sbom))
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
