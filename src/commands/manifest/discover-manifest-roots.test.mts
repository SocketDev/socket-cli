import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { findBuildToolCandidates } from './discover-manifest-roots.mts'
import { testPath } from '../../../test/utils.mts'

import type { SocketJson } from '../../utils/socket-json.mts'

const monorepo = path.join(
  testPath,
  'fixtures/commands/manifest/dynamic-sbom-inference/monorepo',
)

function relDirs(dirs: string[]): string[] {
  return dirs.map(d => path.relative(monorepo, d).replaceAll('\\', '/')).sort()
}

describe('findBuildToolCandidates', () => {
  it('discovers maven, gradle, and sbt candidates in depth order', async () => {
    const candidates = await findBuildToolCandidates({
      cwd: monorepo,
      sockJson: {} as SocketJson,
    })

    expect(relDirs(candidates.get('maven') ?? [])).toEqual(
      [
        'dual-marker-dir',
        'reactor',
        'reactor/moduleA',
        'reactor/moduleB',
        'reactor/moduleB/independent-submodule',
      ].sort(),
    )
    expect(relDirs(candidates.get('gradle') ?? [])).toEqual(
      [
        'dual-marker-dir',
        'reactor/moduleA/nested-gradle',
        'standalone-gradle',
      ].sort(),
    )
    expect(candidates.get('sbt') ?? []).toEqual([])
  })

  it('lists a reactor root before its own members (depth-ascending)', async () => {
    const candidates = await findBuildToolCandidates({
      cwd: monorepo,
      sockJson: {} as SocketJson,
    })
    const maven = candidates.get('maven') ?? []
    const rootIndex = maven.findIndex(d => d === path.join(monorepo, 'reactor'))
    const moduleAIndex = maven.findIndex(
      d => d === path.join(monorepo, 'reactor/moduleA'),
    )
    expect(rootIndex).toBeGreaterThanOrEqual(0)
    expect(moduleAIndex).toBeGreaterThan(rootIndex)
  })

  it('includes a gradle project nested inside a maven candidate directory tree', async () => {
    const candidates = await findBuildToolCandidates({
      cwd: monorepo,
      sockJson: {} as SocketJson,
    })
    expect(candidates.get('gradle')).toContain(
      path.join(monorepo, 'reactor/moduleA/nested-gradle'),
    )
  })

  it('lists a dual-marker directory on both ecosystems', async () => {
    const candidates = await findBuildToolCandidates({
      cwd: monorepo,
      sockJson: {} as SocketJson,
    })
    const dualDir = path.join(monorepo, 'dual-marker-dir')
    expect(candidates.get('maven')).toContain(dualDir)
    expect(candidates.get('gradle')).toContain(dualDir)
  })

  it('drops a disabled ecosystem entirely', async () => {
    const candidates = await findBuildToolCandidates({
      cwd: monorepo,
      sockJson: {
        defaults: { manifest: { maven: { disabled: true } } },
      } as SocketJson,
    })
    expect(candidates.has('maven')).toBe(false)
    expect(candidates.get('gradle')?.length).toBeGreaterThan(0)
  })

  it('respects --exclude-paths', async () => {
    const candidates = await findBuildToolCandidates({
      cwd: monorepo,
      excludePaths: ['reactor'],
      sockJson: {} as SocketJson,
    })
    expect(candidates.get('maven')).toEqual([
      path.join(monorepo, 'dual-marker-dir'),
    ])
    expect(candidates.get('gradle')).toEqual([
      path.join(monorepo, 'dual-marker-dir'),
      path.join(monorepo, 'standalone-gradle'),
    ])
  })
})
