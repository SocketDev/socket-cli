import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  buildRootPath,
  findBuildToolCandidates,
  isBuildRootCovered,
  sortByDepthThenPath,
} from './discover-manifest-roots.mts'
import { testPath } from '../../../test/utils.mts'
import { loadSocketConfig } from '../../utils/config.mts'

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
    socketConfig: undefined,
    sockJson: {} as SocketJson,
  })
  return (candidates.get('maven') ?? []).map(r =>
    path.relative(pomNames, buildRootPath(r)).replaceAll('\\', '/'),
  )
}

async function rootsBesideIgnoredPom(
  ignoredPomDir: string,
  ignoreFile: { content: string; name: string },
): Promise<BuildRoot[] | undefined> {
  const cwd = await fs.realpath(
    await fs.mkdtemp(path.join(tmpdir(), 'ignored-poms-')),
  )
  try {
    await fs.mkdir(path.join(cwd, ignoredPomDir), { recursive: true })
    await fs.writeFile(
      path.join(cwd, ignoredPomDir, 'lib-1.0.pom'),
      '<project/>',
    )
    await fs.writeFile(path.join(cwd, 'pom.xml'), '<project/>')
    await fs.writeFile(path.join(cwd, ignoreFile.name), ignoreFile.content)
    const candidates = await findBuildToolCandidates({
      cwd,
      socketConfig: loadSocketConfig(cwd),
      sockJson: {} as SocketJson,
    })
    return candidates
      .get('maven')
      ?.map(root => ({ ...root, dir: path.relative(cwd, root.dir) }))
  } finally {
    await fs.rm(cwd, { recursive: true, force: true })
  }
}

function dirsOf(roots: BuildRoot[] | undefined): string[] {
  return (roots ?? []).map(r => r.dir)
}

describe('findBuildToolCandidates', () => {
  it('discovers maven, gradle, and sbt candidates in depth order', async () => {
    const candidates = await findBuildToolCandidates({
      cwd: monorepo,
      socketConfig: undefined,
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
      socketConfig: undefined,
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
      socketConfig: undefined,
      sockJson: {} as SocketJson,
    })
    expect(dirsOf(candidates.get('gradle'))).toContain(
      path.join(monorepo, 'reactor/moduleA/nested-gradle'),
    )
  })

  it('lists a dual-marker directory on both ecosystems', async () => {
    const candidates = await findBuildToolCandidates({
      cwd: monorepo,
      socketConfig: undefined,
      sockJson: {} as SocketJson,
    })
    const dualDir = path.join(monorepo, 'dual-marker-dir')
    expect(dirsOf(candidates.get('maven'))).toContain(dualDir)
    expect(dirsOf(candidates.get('gradle'))).toContain(dualDir)
  })

  it('drops a disabled ecosystem entirely', async () => {
    const candidates = await findBuildToolCandidates({
      cwd: monorepo,
      socketConfig: undefined,
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
      socketConfig: undefined,
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
      socketConfig: undefined,
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
    expect(
      await rootsBesideIgnoredPom('.m2/repository/com/example/lib/1.0', {
        content: '.m2/\n',
        name: '.gitignore',
      }),
    ).toEqual([{ dir: '', entryFile: 'pom.xml' }])
  })

  it("skips POMs socket.yml's projectIgnorePaths covers, as a scan does when uploading", async () => {
    expect(
      await rootsBesideIgnoredPom('libs/repo', {
        content: 'version: 2\nprojectIgnorePaths:\n  - libs/repo\n',
        name: 'socket.yml',
      }),
    ).toEqual([{ dir: '', entryFile: 'pom.xml' }])
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

  it('covers a root without an entry file through a marker file', () => {
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

describe('sortByDepthThenPath', () => {
  it('sorts shallower dirs first, then by path, then by entry file', () => {
    expect(
      sortByDepthThenPath(
        [
          { dir: '/repo/b/nested' },
          { dir: '/repo/b', entryFile: 'pom.xml' },
          { dir: '/repo/b', entryFile: 'app-dev.pom.xml' },
          { dir: '/repo/a' },
          { dir: '/repo' },
        ],
        '/repo',
      ),
    ).toEqual([
      { dir: '/repo' },
      { dir: '/repo/a' },
      { dir: '/repo/b', entryFile: 'app-dev.pom.xml' },
      { dir: '/repo/b', entryFile: 'pom.xml' },
      { dir: '/repo/b/nested' },
    ])
  })
})
