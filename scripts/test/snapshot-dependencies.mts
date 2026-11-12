import { promises as fs } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../..')

export interface SnapshotDependency {
  readonly packageName: string
  readonly source: string
  readonly versionPattern: RegExp
  readonly snapshots: readonly string[]
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
} as const satisfies Record<string, SnapshotDependency>

export type SnapshotDependencyName = keyof typeof SNAPSHOT_DEPENDENCIES

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
    Object.entries(SNAPSHOT_DEPENDENCIES).map(async ([name, dependency]) => {
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
      const snapshots = await Promise.all(
        dependency.snapshots.map(async snapshot => ({
          path: snapshot,
          contents: await fs.readFile(path.join(ROOT, snapshot), 'utf8'),
        })),
      )
      const staleSnapshots = snapshots
        .filter(snapshot => !snapshot.contents.includes(version))
        .map(snapshot => snapshot.path)
      if (staleSnapshots.length) {
        return {
          dependencyName: name as SnapshotDependencyName,
          packageName: dependency.packageName,
          version,
          snapshots: staleSnapshots,
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
