import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  findBuildToolCandidates,
  isBuildRootCovered,
} from './discover-manifest-roots.mts'
import { testPath } from '../../../test/utils.mts'

import type { BuildRoot } from './discover-manifest-roots.mts'
import type { SocketJson } from '../../utils/socket-json.mts'

const monorepo = path.join(
  testPath,
  'fixtures/commands/manifest/dynamic-sbom-inference/monorepo',
)
const pomNames = path.join(
  testPath,
  'fixtures/commands/manifest/dynamic-sbom-inference/pom-names',
)

function relDirs(roots: BuildRoot[]): string[] {
  return roots
    .map(r => path.relative(monorepo, r.dir).replaceAll('\\', '/'))
    .sort()
}

async function pomNamesRoots(excludePaths?: string[]): Promise<string[]> {
  const candidates = await findBuildToolCandidates({
    cwd: pomNames,
    excludePaths,
    sockJson: {} as SocketJson,
  })
  return (candidates.get('maven') ?? []).map(r =>
    path
      .relative(pomNames, path.join(r.dir, r.entryFile ?? ''))
      .replaceAll('\\', '/'),
  )
}

function dirsOf(roots: BuildRoot[] | undefined): string[] {
  return (roots ?? []).map(r => r.dir)
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
    const maven = dirsOf(candidates.get('maven'))
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
    expect(dirsOf(candidates.get('gradle'))).toContain(
      path.join(monorepo, 'reactor/moduleA/nested-gradle'),
    )
  })

  it('lists a dual-marker directory on both ecosystems', async () => {
    const candidates = await findBuildToolCandidates({
      cwd: monorepo,
      sockJson: {} as SocketJson,
    })
    const dualDir = path.join(monorepo, 'dual-marker-dir')
    expect(dirsOf(candidates.get('maven'))).toContain(dualDir)
    expect(dirsOf(candidates.get('gradle'))).toContain(dualDir)
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
      { dir: path.join(monorepo, 'dual-marker-dir'), entryFile: 'pom.xml' },
    ])
    expect(candidates.get('gradle')).toEqual([
      { dir: path.join(monorepo, 'dual-marker-dir'), entryFile: undefined },
      { dir: path.join(monorepo, 'standalone-gradle'), entryFile: undefined },
    ])
  })

  it('lists a gradle directory once despite several markers', async () => {
    const candidates = await findBuildToolCandidates({
      cwd: monorepo,
      sockJson: {} as SocketJson,
    })
    const standalone = path.join(monorepo, 'standalone-gradle')
    expect(
      dirsOf(candidates.get('gradle')).filter(d => d === standalone),
    ).toHaveLength(1)
  })

  it('lists each POM the scan pattern uploads as its own maven build root', async () => {
    const roots = await pomNamesRoots()
    expect(roots).toEqual([
      'app-dev.pom.xml',
      'pom.xml',
      'bare/pom',
      'upper/POM.XML',
      'vendored/lib-1.0.pom',
    ])
  })

  it('skips POMs a .gitignore covers, as a scan does when uploading', async () => {
    const cwd = await fs.realpath(
      await fs.mkdtemp(path.join(tmpdir(), 'gitignored-poms-')),
    )
    try {
      const repoDir = path.join(cwd, '.m2/repository/com/example/lib/1.0')
      await fs.mkdir(repoDir, { recursive: true })
      await fs.writeFile(path.join(repoDir, 'lib-1.0.pom'), '<project/>')
      await fs.writeFile(path.join(cwd, 'pom.xml'), '<project/>')
      await fs.writeFile(path.join(cwd, '.gitignore'), '.m2/\n')

      const candidates = await findBuildToolCandidates({
        cwd,
        sockJson: {} as SocketJson,
      })

      expect(candidates.get('maven')).toEqual([
        { dir: cwd, entryFile: 'pom.xml' },
      ])
    } finally {
      await fs.rm(cwd, { recursive: true, force: true })
    }
  })

  it("skips POMs socket.yml's projectIgnorePaths covers, as a scan does when uploading", async () => {
    const cwd = await fs.realpath(
      await fs.mkdtemp(path.join(tmpdir(), 'project-ignored-poms-')),
    )
    try {
      await fs.mkdir(path.join(cwd, 'libs/repo'), { recursive: true })
      await fs.writeFile(path.join(cwd, 'libs/repo/lib-1.0.pom'), '<project/>')
      await fs.writeFile(path.join(cwd, 'pom.xml'), '<project/>')
      await fs.writeFile(
        path.join(cwd, 'socket.yml'),
        'version: 2\nprojectIgnorePaths:\n  - libs/repo\n',
      )

      const candidates = await findBuildToolCandidates({
        cwd,
        sockJson: {} as SocketJson,
      })

      expect(candidates.get('maven')).toEqual([
        { dir: cwd, entryFile: 'pom.xml' },
      ])
    } finally {
      await fs.rm(cwd, { recursive: true, force: true })
    }
  })

  it('respects --exclude-paths for non-default POMs, case-sensitively', async () => {
    expect(
      await pomNamesRoots(['vendored', '**/*.pom', 'app-dev.pom.xml']),
    ).toEqual(['pom.xml', 'bare/pom', 'upper/POM.XML'])
    expect(await pomNamesRoots(['UPPER', 'Bare'])).toEqual([
      'app-dev.pom.xml',
      'pom.xml',
      'bare/pom',
      'upper/POM.XML',
      'vendored/lib-1.0.pom',
    ])
  })
})

describe('isBuildRootCovered', () => {
  it('covers a POM only by its own file', () => {
    const covered = new Set(['/repo/service/pom.xml'])
    expect(
      isBuildRootCovered(covered, 'maven', {
        dir: '/repo/service',
        entryFile: 'pom.xml',
      }),
    ).toBe(true)
    expect(
      isBuildRootCovered(covered, 'maven', {
        dir: '/repo/service',
        entryFile: 'app-dev.pom.xml',
      }),
    ).toBe(false)
  })

  it('covers a root without an entry file through its default entry file or a marker file', () => {
    expect(
      isBuildRootCovered(new Set(['/repo/service/pom.xml']), 'maven', {
        dir: '/repo/service',
      }),
    ).toBe(true)
    expect(
      isBuildRootCovered(new Set(['/repo/service/lib-1.0.pom']), 'maven', {
        dir: '/repo/service',
      }),
    ).toBe(false)
    expect(
      isBuildRootCovered(new Set(['/repo/lib/settings.gradle.kts']), 'gradle', {
        dir: '/repo/lib',
      }),
    ).toBe(true)
    expect(
      isBuildRootCovered(new Set(['/repo/lib/sub/build.gradle']), 'gradle', {
        dir: '/repo/lib',
      }),
    ).toBe(false)
  })
})
