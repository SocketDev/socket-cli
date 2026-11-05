import { existsSync, promises as fs, statSync } from 'node:fs'
import path from 'node:path'

import micromatch from 'micromatch'

import { debugDir, debugFn } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'
import { normalizePath } from '@socketsecurity/registry/lib/path'
import { spawn } from '@socketsecurity/registry/lib/spawn'
import { pluralize } from '@socketsecurity/registry/lib/words'

import constants from '../../constants.mts'
import { InputError, getErrorMessage } from '../../utils/errors.mts'
import { withTmpDir } from '../../utils/fs.mts'
import { splitRecords } from '../manifest/scripts/records.mts'
import {
  assertBundledAssetBuilt,
  manifestScriptsPath,
} from '../manifest/scripts/run.mts'

import type {
  SocketFactsSbom,
  SocketFactsSbomComponent,
  SocketFactsSbomProject,
} from '../manifest/scripts/facts.mts'

const ARCHIVE_EXTENSIONS = new Set(['ear', 'jar', 'war'])

const CONTAINER_EXTENSIONS = new Set(['ear', 'war'])

// ArchiveLoader.java's exit code when the scanned file is no zip archive.
const LOADER_EXIT_NOT_A_ZIP = 2

const NESTED_SEPARATOR = '!/'

const SNAPSHOT = 'SNAPSHOT'

// maven-resolver's AbstractArtifact.SNAPSHOT_TIMESTAMP without its prefix
// group: the timestamp and build number that replace `SNAPSHOT`.
const SNAPSHOT_TIMESTAMP = /^[0-9]{8}\.[0-9]{6}-[0-9]+/

type LoadedArchive = {
  malformed: Array<{ detail: string; entry: string }>
  poms: PomProperties[]
  unreadable: string | undefined
}

type MavenArtifact = PomProperties & {
  // Both undefined for a pom.properties shaded into the scanned archive, which
  // records neither.
  classifier: string | undefined
  extension: string | undefined
}

type PomProperties = {
  artifactId: string
  entry: string
  groupId: string
  version: string
}

export type ArchiveReport = {
  malformedPomProperties: string[]
  skippedBundled: string[]
  unidentifiedArchives: string[]
  unreadableArchives: string[]
}

export type ArchiveFactsResult = ArchiveReport & {
  componentCount: number
  factsPath: string
}

function addComponent(
  components: Map<string, SocketFactsSbomComponent>,
  artifact: MavenArtifact,
): void {
  const qualifiers: Record<string, string> = {
    __proto__: null,
  } as unknown as Record<string, string>
  if (artifact.classifier) {
    qualifiers['classifier'] = artifact.classifier
  }
  if (artifact.extension) {
    qualifiers['ext'] = artifact.extension
  }
  const id = [
    artifact.groupId,
    artifact.artifactId,
    artifact.extension,
    artifact.classifier,
    artifact.version,
  ]
    .filter(Boolean)
    .join(':')
  if (components.has(id)) {
    return
  }
  components.set(id, {
    type: 'maven',
    namespace: artifact.groupId,
    name: artifact.artifactId,
    version: artifact.version,
    ...(Object.keys(qualifiers).length ? { qualifiers } : {}),
    id,
    direct: true,
  })
}

// `<artifactId>-<baseVersion>[-<classifier>]` (maven-war-plugin default naming),
// or a timestamped snapshot version (maven-resolver AbstractArtifact).
function classifierInFileName(
  stem: string,
  pom: PomProperties,
): string | undefined {
  const prefix = `${pom.artifactId}-`
  if (!stem.startsWith(prefix)) {
    return undefined
  }
  const rest = stem.slice(prefix.length)
  const afterVersion = (end: number): string | undefined => {
    if (end === rest.length) {
      return ''
    }
    return rest[end] === '-' && end + 1 < rest.length
      ? rest.slice(end + 1)
      : undefined
  }
  if (rest.startsWith(pom.version)) {
    const classifier = afterVersion(pom.version.length)
    if (classifier !== undefined) {
      return classifier
    }
  }
  if (pom.version.endsWith(SNAPSHOT)) {
    const base = pom.version.slice(0, -SNAPSHOT.length)
    if ((!base.length || base.endsWith('-')) && rest.startsWith(base)) {
      const timestamp = SNAPSHOT_TIMESTAMP.exec(rest.slice(base.length))
      if (timestamp) {
        return afterVersion(base.length + timestamp[0].length)
      }
    }
  }
  return undefined
}

function coordinateOf(component: SocketFactsSbomComponent): string {
  return `${component.namespace}:${component.name}:${component.version}`
}

function extensionOf(fileName: string): string | undefined {
  const ext = path.extname(fileName).slice(1)
  return ARCHIVE_EXTENSIONS.has(ext) ? ext : undefined
}

function javaBin(): string {
  const executable = process.platform === 'win32' ? 'java.exe' : 'java'
  const javaHome = process.env['JAVA_HOME']
  return javaHome ? path.join(javaHome, 'bin', executable) : executable
}

function nestedFileName(archivePath: string): string {
  return path.posix.basename(archivePath.split(NESTED_SEPARATOR).at(-1)!)
}

// Trivy's own-artifact rule (jar/parse.go: file name spells out the coordinate),
// extended to classifiers, timestamped snapshots, wars and ears.
function ownArtifact(
  fileName: string,
  poms: PomProperties[],
): MavenArtifact | undefined {
  const extension = extensionOf(fileName)
  if (!extension) {
    return undefined
  }
  const stem = fileName.slice(0, -(extension.length + 1))
  const matches: MavenArtifact[] = []
  for (const pom of poms) {
    const classifier = classifierInFileName(stem, pom)
    if (classifier !== undefined) {
      matches.push({ ...pom, classifier: classifier || undefined, extension })
    }
  }
  // Two coordinates spelling the same file name cannot be told apart.
  return matches.length === 1 ? matches[0] : undefined
}

function parentOf(archivePath: string): string {
  const i = archivePath.lastIndexOf(NESTED_SEPARATOR)
  return i === -1 ? '' : archivePath.slice(0, i)
}

// Record format: ArchiveLoader.java. The scanned archive has the path ''.
function parseLoaderRecords(text: string): Map<string, LoadedArchive> {
  const emptyArchive = (): LoadedArchive => ({
    malformed: [],
    poms: [],
    unreadable: undefined,
  })
  const archives = new Map<string, LoadedArchive>([['', emptyArchive()]])
  for (const fields of splitRecords(text)) {
    const { 0: tag, 1: archivePath = '' } = fields
    if (tag === 'archive') {
      archives.set(archivePath, emptyArchive())
      continue
    }
    const archive = archives.get(archivePath)!
    if (tag === 'pom') {
      const { 2: entry = '', 3: groupId, 4: artifactId, 5: version } = fields
      if (groupId && artifactId && version) {
        archive.poms.push({ artifactId, entry, groupId, version })
      } else {
        archive.malformed.push({
          detail: 'missing groupId, artifactId or version',
          entry,
        })
      }
    } else if (tag === 'malformed') {
      archive.malformed.push({
        detail: fields[3] ?? '',
        entry: fields[2] ?? '',
      })
    } else if (tag === 'unreadable') {
      archive.unreadable = fields[2] ?? ''
    }
  }
  return archives
}

async function runArchiveLoader(archivePath: string): Promise<string> {
  const jarPath = manifestScriptsPath('archive-loader', 'archive-loader.jar')
  assertBundledAssetBuilt(jarPath, 'Archive loader jar', 'build:archive-loader')
  return await withTmpDir('socket-archive-', async tmpDir => {
    const recordsFile = path.join(tmpDir, 'records.tsv')
    const bin = javaBin()
    try {
      await spawn(
        bin,
        [
          '-jar',
          jarPath,
          archivePath,
          recordsFile,
          [...ARCHIVE_EXTENSIONS].join(','),
        ],
        { stdio: 'pipe' },
      )
    } catch (e) {
      const { code, stderr } = e as { code?: unknown; stderr?: unknown }
      if (typeof code !== 'number') {
        throw new InputError(
          `Could not run ${bin} to read ${archivePath}: ${getErrorMessage(e)}. Reading a Java archive needs Java 8 or newer on PATH or in JAVA_HOME.`,
        )
      }
      throw new InputError(
        code === LOADER_EXIT_NOT_A_ZIP
          ? `Could not read ${archivePath} as a zip archive: ${String(stderr).trim()}`
          : `The archive loader failed on ${archivePath} (exit ${code}): ${String(stderr).trim()}`,
      )
    }
    return await fs.readFile(recordsFile, 'utf8')
  })
}

function warnList(header: string, items: string[]): void {
  if (items.length) {
    logger.warn(`${header}\n${items.map(m => `- ${m}`).join('\n')}`)
  }
}

// The archive is the project and everything identified in it a direct
// dependency: an archive records containment, not which library needs which.
export function buildArchiveFacts(
  fileName: string,
  recordsText: string,
): { facts: SocketFactsSbom; report: ArchiveReport } {
  const displayPath = (archivePath: string) =>
    archivePath ? `${fileName}${NESTED_SEPARATOR}${archivePath}` : fileName
  const archives = parseLoaderRecords(recordsText)
  const report: ArchiveReport = {
    malformedPomProperties: [],
    skippedBundled: [],
    unidentifiedArchives: [],
    unreadableArchives: [],
  }
  const reportMalformed = (archivePath: string, archive: LoadedArchive) => {
    for (const { detail, entry } of archive.malformed) {
      report.malformedPomProperties.push(
        `${displayPath(archivePath)}${NESTED_SEPARATOR}${entry}: ${detail}`,
      )
    }
  }
  // Only the scanned archive, wars and ears ship libraries; anything bundled
  // in other archives is inside a dependency, unreported until REA-890.
  const shipsLibraries = (archivePath: string): boolean =>
    !archivePath ||
    (CONTAINER_EXTENSIONS.has(extensionOf(nestedFileName(archivePath)) ?? '') &&
      shipsLibraries(parentOf(archivePath)))

  const root = archives.get('')!
  const own = ownArtifact(fileName, root.poms)
  reportMalformed('', root)
  const components = new Map<string, SocketFactsSbomComponent>()
  for (const { 0: archivePath, 1: archive } of archives) {
    if (!archivePath) {
      continue
    }
    const display = displayPath(archivePath)
    if (!shipsLibraries(parentOf(archivePath))) {
      report.skippedBundled.push(display)
      continue
    }
    reportMalformed(archivePath, archive)
    if (archive.unreadable !== undefined) {
      report.unreadableArchives.push(`${display}: ${archive.unreadable}`)
      continue
    }
    const nestedOwn = ownArtifact(nestedFileName(archivePath), archive.poms)
    if (nestedOwn) {
      addComponent(components, nestedOwn)
    } else {
      report.unidentifiedArchives.push(display)
    }
    for (const pom of archive.poms) {
      if (pom.entry !== nestedOwn?.entry) {
        report.skippedBundled.push(`${display}${NESTED_SEPARATOR}${pom.entry}`)
      }
    }
  }

  // Shaded into the scanned archive by its own build; one also shipped as its
  // own jar is the same library.
  const shipped = new Set([...components.values()].map(coordinateOf))
  for (const pom of root.poms) {
    if (
      pom.entry !== own?.entry &&
      !shipped.has(`${pom.groupId}:${pom.artifactId}:${pom.version}`)
    ) {
      addComponent(components, {
        ...pom,
        classifier: undefined,
        extension: undefined,
      })
    }
  }
  const sorted = [...components.values()].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  )
  const project: SocketFactsSbomProject = {
    // An archive carrying no metadata of its own is named only by its file.
    ...(own
      ? {
          type: 'maven',
          namespace: own.groupId,
          name: own.artifactId,
          version: own.version,
        }
      : { type: 'generic', name: fileName }),
    id: fileName,
    subprojectDir: '.',
    manifestFiles: [{ file: fileName }],
    children: sorted.map((_, i) => i),
  }
  return {
    facts: {
      projects: [project],
      components: sorted,
      dependencies: sorted.map((_, i) => ({ component: i })),
    },
    report,
  }
}

export function findArchiveTargets(targets: string[], cwd: string): string[] {
  const archives = new Set<string>()
  for (const target of targets) {
    const resolved = path.resolve(cwd, target)
    if (
      extensionOf(path.basename(resolved)) &&
      existsSync(resolved) &&
      statSync(resolved).isFile()
    ) {
      archives.add(resolved)
    }
  }
  return [...archives]
}

export async function generateArchiveFacts(
  archivePath: string,
): Promise<ArchiveFactsResult> {
  const recordsText = await runArchiveLoader(archivePath)
  const { facts, report } = buildArchiveFacts(
    path.basename(archivePath),
    recordsText,
  )
  const factsPath = `${archivePath}${constants.DOT_SOCKET_DOT_FACTS_JSON}`
  await fs.writeFile(factsPath, JSON.stringify(facts), 'utf8')
  return { ...report, componentCount: facts.components.length, factsPath }
}

export async function generateArchiveTargetFacts(
  targets: string[],
  { cwd, excludeGlobs }: { cwd: string; excludeGlobs: string[] },
): Promise<string[]> {
  const factsPaths: string[] = []
  for (const archivePath of findArchiveTargets(targets, cwd)) {
    const relative = path.relative(cwd, archivePath)
    // excludeGlobs are --exclude-paths anchored at cwd, as discovery uses them.
    if (
      micromatch.isMatch(normalizePath(relative), excludeGlobs, { dot: true })
    ) {
      debugFn(
        'notice',
        `Skipping archive target excluded by --exclude-paths: ${relative}`,
      )
      continue
    }
    // eslint-disable-next-line no-await-in-loop
    const result = await generateArchiveFacts(archivePath)
    // Discovery yields forward slashes; matching lets the scan dedupe a facts
    // file it also discovered.
    factsPaths.push(normalizePath(result.factsPath))
    logger.info(
      `Generated ${path.relative(cwd, result.factsPath)} from ${relative}: ${result.componentCount} ${pluralize('component', result.componentCount)} identified by bundled Maven metadata.`,
    )
    if (result.unidentifiedArchives.length) {
      logger.warn(
        `${result.unidentifiedArchives.length} ${pluralize('archive', result.unidentifiedArchives.length)} inside ${relative} carry no pom.properties matching their file name and are not reported.`,
      )
    }
    warnList(
      `Could not read these archives inside ${relative}; their libraries are not reported:`,
      result.unreadableArchives,
    )
    warnList(
      `Skipped unreadable pom.properties in ${relative}:`,
      result.malformedPomProperties,
    )
    debugDir('inspect', {
      archive: relative,
      skippedBundled: result.skippedBundled,
      unidentifiedArchives: result.unidentifiedArchives,
      unreadableArchives: result.unreadableArchives,
    })
  }
  return factsPaths
}
