import { promises as fs } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../../..')

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
      'test/snapshots/termless/cli.native.socket-help-fix.svg',
      'test/snapshots/termless/cli.native.socket-help-scan-create.svg',
      'test/snapshots/termless/cli.native.socket-help-scan-reach.svg',
    ],
    testNamePattern: 'captures native help for (fix|scan create|scan reach)',
  },
  patch: {
    packageName: '@socketsecurity/socket-patch',
    source: 'package.json',
    versionPattern: /"@socketsecurity\/socket-patch"\s*:\s*"([^"]+)"/,
    snapshots: [
      'test/snapshots/termless/cli.native.socket-patch-apply-help.svg',
      'test/snapshots/termless/cli.native.socket-patch-rollback-help.svg',
      'test/snapshots/termless/cli.native.socket-patch-get-help.svg',
      'test/snapshots/termless/cli.native.socket-patch-scan-help.svg',
      'test/snapshots/termless/cli.native.socket-patch-list-help.svg',
      'test/snapshots/termless/cli.native.socket-patch-remove-help.svg',
      'test/snapshots/termless/cli.native.socket-patch-setup-help.svg',
      'test/snapshots/termless/cli.native.socket-patch-repair-help.svg',
      'test/snapshots/termless/cli.native.socket-patch-version.svg',
    ],
    versionSnapshots: ['test/snapshots/termless/cli.native.socket-patch-version.svg'],
    testNamePattern:
      'captures bundled patch help for (apply|rollback|get|scan|list|remove|setup|repair)|captures bundled socket-patch version',
  },
} as const satisfies Record<string, SnapshotDependency>

export type SnapshotDependencyName = 'coana' | 'patch' | 'socket-patch'
type SnapshotDependencyMapName = keyof typeof SNAPSHOT_DEPENDENCIES

export interface StaleSnapshotDependency {
  readonly dependencyName: SnapshotDependencyName
  readonly packageName: string
  readonly version: string
  readonly snapshots: readonly string[]
}

export async function findStaleSnapshotDependencies(): Promise<
  StaleSnapshotDependency[]
> {
  const findings = await Promise.all(
    (Object.entries(SNAPSHOT_DEPENDENCIES) as Array<[
      string,
      SnapshotDependency,
    ]>).map(async ([name, dependency]) => {
      const source = await fs.readFile(
        path.join(ROOT, dependency.source),
        'utf8',
      )
      const version = dependency.versionPattern.exec(source)?.[1]
      if (!version) {
        throw new Error(
          `Could not read ${dependency.packageName} version from ${dependency.source}`,
        )
      }
      const versionSnapshots = dependency.versionSnapshots ?? dependency.snapshots
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
            name === 'patch' ? 'socket-patch' : (name as SnapshotDependencyName),
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
  if (name === 'socket-patch') {return 'patch'}
  if (name === 'coana' || name === 'patch') {return name}
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
        `\nRun: pnpm snapshots:refresh:dep ${dependency.dependencyName}`,
    )
    .join('\n\n')
}

export async function assertSnapshotDependenciesCurrent(): Promise<void> {
  const stale = await findStaleSnapshotDependencies()
  if (stale.length) {
    throw new Error(snapshotDependencyUpdateHint(stale))
  }
}
