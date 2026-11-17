import { promises as fs } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../..')

export interface SnapshotDependency {
  readonly packageName: string
  readonly source: string
  readonly versionPattern: RegExp
  readonly snapshots: readonly string[]
  readonly versionSnapshots?: readonly string[]
  readonly testNamePattern: string
}

export const SNAPSHOT_DEPENDENCIES = {
  coana: {
    packageName: '@coana-tech/cli',
    source: 'src/constants.mts',
    versionPattern: /const COANA_CLI_VERSION = ['"]([^'"]+)['"]/,
    snapshots: [
      'test/native-snapshots/socket-help-fix.help.svg',
      'test/native-snapshots/socket-help-scan-create.help.svg',
      'test/native-snapshots/socket-help-scan-reach.help.svg',
    ],
    testNamePattern: 'captures native help for (fix|scan create|scan reach)',
  },
  patch: {
    packageName: '@socketsecurity/socket-patch',
    source: 'package.json',
    versionPattern: /"@socketsecurity\/socket-patch"\s*:\s*"([^"]+)"/,
    snapshots: [
      'test/native-snapshots/socket-patch-apply-help.help.svg',
      'test/native-snapshots/socket-patch-rollback-help.help.svg',
      'test/native-snapshots/socket-patch-get-help.help.svg',
      'test/native-snapshots/socket-patch-scan-help.help.svg',
      'test/native-snapshots/socket-patch-list-help.help.svg',
      'test/native-snapshots/socket-patch-remove-help.help.svg',
      'test/native-snapshots/socket-patch-setup-help.help.svg',
      'test/native-snapshots/socket-patch-repair-help.help.svg',
      'test/native-snapshots/socket-patch-version.version.svg',
    ],
    versionSnapshots: [
      'test/native-snapshots/socket-patch-version.version.svg',
    ],
    testNamePattern:
      'captures bundled patch help for (apply|rollback|get|scan|list|remove|setup|repair)|captures bundled socket-patch version',
  },
} as const satisfies Record<string, SnapshotDependency>

export type SnapshotDependencyName = 'coana' | 'patch' | 'socket-patch'
type SnapshotDependencyMapName = keyof typeof SNAPSHOT_DEPENDENCIES

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Replace a pinned version in a terminal SVG snapshot without changing the
 * rendered row width. The row's trailing spaces absorb the length difference.
 */
export function swapVersionInSnapshot(
  contents: string,
  from: string,
  to: string,
): string {
  const pattern = new RegExp(
    `(?<![\\w.])${escapeRegExp(from)}(?!\\w|\\.\\d)(\\S*)( *)`,
    'g',
  )
  let found = false
  const swapped = contents.replace(
    pattern,
    (_match, tail: string, padding: string) => {
      found = true
      const width = from.length + padding.length
      if (to.length > width) {
        throw new Error(`No room in the row to replace ${from} with ${to}`)
      }
      return `${to}${tail}${' '.repeat(width - to.length)}`
    },
  )
  if (!found) {
    throw new Error(`The snapshot does not mention ${from}`)
  }
  return swapped
}

export interface StaleSnapshotDependency {
  readonly dependencyName: SnapshotDependencyName
  readonly packageName: string
  readonly version: string
  readonly snapshots: readonly string[]
}

export async function readPinnedVersion(
  dependency: SnapshotDependency,
): Promise<string> {
  const source = await fs.readFile(path.join(ROOT, dependency.source), 'utf8')
  const version = dependency.versionPattern.exec(source)?.[1]
  if (!version) {
    throw new Error(
      `Could not read ${dependency.packageName} version from ${dependency.source}`,
    )
  }
  return version
}

export async function findStaleSnapshotDependencies(): Promise<
  StaleSnapshotDependency[]
> {
  const findings = await Promise.all(
    (
      Object.entries(SNAPSHOT_DEPENDENCIES) as Array<
        [string, SnapshotDependency]
      >
    ).map(async ([name, dependency]) => {
      const version = await readPinnedVersion(dependency)
      const versionSnapshots =
        dependency.versionSnapshots ?? dependency.snapshots
      const snapshots = await Promise.all(
        versionSnapshots.map(async snapshot => ({
          path: snapshot,
          contents: await fs.readFile(path.join(ROOT, snapshot), 'utf8'),
        })),
      )
      const staleSnapshots = snapshots
        .filter(snapshot => !snapshot.contents.includes(version))
        .map(snapshot => snapshot.path)
      if (staleSnapshots.length) {
        return {
          dependencyName:
            name === 'patch'
              ? 'socket-patch'
              : (name as SnapshotDependencyName),
          packageName: dependency.packageName,
          version,
          snapshots: dependency.versionSnapshots
            ? dependency.snapshots
            : staleSnapshots,
        }
      }
      return undefined
    }),
  )
  const stale: StaleSnapshotDependency[] = []
  for (const finding of findings) {
    if (finding) {
      stale.push(finding)
    }
  }
  return stale
}

export function normalizeSnapshotDependencyName(
  name: string,
): SnapshotDependencyMapName | undefined {
  if (name === 'socket-patch') {
    return 'patch'
  }
  if (name === 'coana' || name === 'patch') {
    return name
  }
  return undefined
}

export function snapshotDependencyUpdateHint(
  stale: readonly StaleSnapshotDependency[],
): string {
  return stale
    .map(
      dependency =>
        `Snapshot output for ${dependency.packageName}@${dependency.version} is stale:\n` +
        dependency.snapshots.map(snapshot => `  - ${snapshot}`).join('\n') +
        `\nRun: pnpm snapshots:update:dep ${dependency.dependencyName}`,
    )
    .join('\n\n')
}

export async function assertSnapshotDependenciesCurrent(): Promise<void> {
  const stale = await findStaleSnapshotDependencies()
  if (stale.length) {
    throw new Error(snapshotDependencyUpdateHint(stale))
  }
}
