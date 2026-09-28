import { existsSync, promises as fs, rmSync } from 'node:fs'
import path from 'node:path'

import { isDirSync } from '@socketsecurity/registry/lib/fs'
import { logger } from '@socketsecurity/registry/lib/logger'
import { spawn } from '@socketsecurity/registry/lib/spawn'

import constants from '../../constants.mts'
import { InputError, getErrorMessage } from '../../utils/errors.mts'

import type { GeneratedScanFiles } from './handle-create-new-scan.mts'

const CLEANUP_SIGNALS: NodeJS.Signals[] = ['SIGHUP', 'SIGINT', 'SIGTERM']

const UV_SBOM_FILENAME = 'socket-uv-cdx.json'

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

function componentIdentity(component: Component): string {
  return JSON.stringify([component.name, component.version, component.purl])
}

async function exportMemberSbom(memberDir: string): Promise<Sbom> {
  const sbom = await exportSbom(memberDir, '--all-groups')
  const productionSbom = await exportSbom(memberDir, '--no-default-groups')
  // uv can renumber bom-ref values between exports.
  const productionPackages = new Set(
    productionSbom.components?.map(componentIdentity),
  )
  for (const component of sbom.components ?? []) {
    component.scope = productionPackages.has(componentIdentity(component))
      ? 'required'
      : 'optional'
  }
  return sbom
}

async function exportSbom(
  memberDir: string,
  groups: '--all-groups' | '--no-default-groups',
): Promise<Sbom> {
  let content: string
  try {
    const { stdout } = await spawn(
      'uv',
      [
        'export',
        '--project',
        memberDir,
        '--format',
        'cyclonedx1.5',
        '--frozen',
        '--offline',
        '--no-python-downloads',
        '--all-extras',
        groups,
      ],
      {
        cwd: memberDir,
        signal: constants.abortSignal,
        stdio: 'pipe',
      },
    )
    content = stdout
  } catch (e) {
    throw new InputError(
      `Could not export the uv dependency graph for ${memberDir}. Install uv on PATH with CycloneDX export support and check that the directory is a uv project with a uv.lock in it or in its workspace root.`,
      e && typeof e === 'object' && 'stderr' in e
        ? String(e.stderr).trim() || getErrorMessage(e)
        : getErrorMessage(e),
    )
  }
  return parseSbom(content, memberDir)
}

function parseSbom(content: string, memberDir: string): Sbom {
  try {
    const sbom = JSON.parse(content) as Sbom
    if (
      sbom?.bomFormat === 'CycloneDX' &&
      Array.isArray(sbom.dependencies) &&
      (sbom.components === undefined || Array.isArray(sbom.components)) &&
      typeof sbom.metadata?.component?.name === 'string'
    ) {
      return sbom
    }
  } catch {}
  throw new InputError(
    `uv did not return a CycloneDX dependency graph for ${memberDir}. Update uv and try again.`,
  )
}

export async function generateUvMemberSboms(
  memberDirs: string[],
): Promise<GeneratedScanFiles> {
  const sboms: Sbom[] = []
  for (const memberDir of memberDirs) {
    logger.info(`Exporting the uv dependency graph for ${memberDir}...`)
    // eslint-disable-next-line no-await-in-loop
    sboms.push(await exportMemberSbom(memberDir))
  }
  const files: string[] = []
  const removeFilesSync = () => {
    for (const file of files) {
      rmSync(file, { force: true })
    }
  }
  // A signalled or exiting scan skips finally blocks, and the bin launcher
  // SIGKILLs a signalled scan after a short grace period.
  process.once('exit', removeFilesSync)
  for (const signal of CLEANUP_SIGNALS) {
    process.once(signal, removeFilesSync)
  }
  const cleanup = async () => {
    process.removeListener('exit', removeFilesSync)
    for (const signal of CLEANUP_SIGNALS) {
      process.removeListener(signal, removeFilesSync)
    }
    await Promise.all(files.map(file => fs.rm(file, { force: true })))
  }
  try {
    for (let i = 0; i < memberDirs.length; i += 1) {
      // The SBOM sits where the member's own manifest would, so upload paths
      // and the reachability target line up with the member directory.
      const filename = path.join(memberDirs[i]!, UV_SBOM_FILENAME)
      // eslint-disable-next-line no-await-in-loop
      await fs.writeFile(filename, JSON.stringify(sboms[i]), { flag: 'wx' })
      files.push(filename)
    }
  } catch (e) {
    await cleanup()
    throw e
  }
  return { cleanup, files }
}

export function resolveUvMemberDirs(targets: string[], cwd: string): string[] {
  const memberDirs = new Set<string>()
  for (const target of targets) {
    const memberDir = path.resolve(cwd, target)
    const relativeDir = path.relative(cwd, memberDir)
    if (
      relativeDir === '..' ||
      relativeDir.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeDir) ||
      !isDirSync(memberDir)
    ) {
      throw new InputError(
        `--uv-members requires every TARGET to be a directory inside --cwd, but got ${target}`,
      )
    }
    if (!existsSync(path.join(memberDir, 'pyproject.toml'))) {
      throw new InputError(
        `--uv-members requires a pyproject.toml in every TARGET, but ${target} has none`,
      )
    }
    if (existsSync(path.join(memberDir, UV_SBOM_FILENAME))) {
      throw new InputError(
        `${path.join(target, UV_SBOM_FILENAME)} already exists. Remove it and run the scan again.`,
      )
    }
    memberDirs.add(memberDir)
  }
  return Array.from(memberDirs)
}
