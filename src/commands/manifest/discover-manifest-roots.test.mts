import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  buildRootPath,
  findBuildToolCandidates,
  isBuildRootCovered,
  isRootCovered,
  sortByDepthThenPath,
} from './discover-manifest-roots.mts'
import { testPath } from '../../../test/utils.mts'
import { loadSocketConfig } from '../../utils/config.mts'

import type { BuildRoot } from './discover-manifest-roots.mts'
import type { BuildTool } from './scripts/build-tool.mts'
import type { PURL_Type } from '../../utils/ecosystem.mts'
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

  it.for<{
    name: string
    purlTypes?: PURL_Type[]
    sockJson?: SocketJson
    tools: BuildTool[]
  }>([
    {
      name: 'a disabled ecosystem',
      sockJson: {
        defaults: { manifest: { maven: { disabled: true } } },
      } as SocketJson,
      tools: ['dotnet', 'gradle', 'sbt'],
    },
    {
      name: 'purl types other than maven',
      purlTypes: ['maven'],
      tools: ['gradle', 'maven', 'sbt'],
    },
    {
      name: 'purl types other than nuget',
      purlTypes: ['nuget'],
      tools: ['dotnet'],
    },
  ])(
    'drops the build tools of $name',
    async ({ purlTypes, sockJson = {} as SocketJson, tools }) => {
      const candidates = await findBuildToolCandidates({
        cwd: monorepo,
        purlTypes,
        socketConfig: undefined,
        sockJson,
      })
      expect([...candidates.keys()]).toEqual(tools)
    },
  )

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
  it.for([
    [
      'maven',
      '/repo/service/pom.xml',
      { dir: '/repo/service', entryFile: 'pom.xml' },
      true,
    ],
    [
      'maven',
      '/repo/service/pom.xml',
      { dir: '/repo/service', entryFile: 'app-dev.pom.xml' },
      false,
    ],
    [
      'dotnet',
      '/repo/src/App/App.csproj',
      { dir: '/repo/src/App', entryFile: 'App.csproj' },
      true,
    ],
    [
      'dotnet',
      '/repo/src/App/App.csproj',
      { dir: '/repo/src/App', entryFile: 'App.sln' },
      false,
    ],
    ['gradle', '/repo/lib/settings.gradle.kts', { dir: '/repo/lib' }, true],
    ['gradle', '/repo/lib/sub/build.gradle', { dir: '/repo/lib' }, false],
  ] as const)(
    '%s: %s covers %o: %s',
    ({ 0: tool, 1: file, 2: root, 3: expected }) => {
      expect(isBuildRootCovered(new Set([file]), tool, root)).toBe(expected)
    },
  )
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

  it('puts the solutions of a directory before its projects', () => {
    expect(
      sortByDepthThenPath(
        [
          { dir: '/repo', entryFile: 'App.csproj' },
          { dir: '/repo', entryFile: 'Zed.slnx' },
          { dir: '/repo', entryFile: 'App.sln' },
        ],
        '/repo',
        'dotnet',
      ),
    ).toEqual([
      { dir: '/repo', entryFile: 'App.sln' },
      { dir: '/repo', entryFile: 'Zed.slnx' },
      { dir: '/repo', entryFile: 'App.csproj' },
    ])
  })
})

function listing(members: string[]) {
  return async () => members
}

async function failToList(): Promise<string[]> {
  throw new Error('listed')
}

async function slnxUnreadable({
  entryFile,
}: {
  entryFile?: string | undefined
}): Promise<string[] | undefined> {
  return entryFile?.endsWith('.slnx') ? undefined : []
}

async function unreadable(): Promise<undefined> {
  return undefined
}

describe('isRootCovered', () => {
  const root = { dir: '/repo', entryFile: 'App.slnx' }
  const covers = (
    covered: string[],
    list: Parameters<typeof isRootCovered>[4],
    r: BuildRoot = root,
  ) => isRootCovered(new Set(covered), 'dotnet', r, {}, list)

  it('covers a solution once every project it builds is covered', async () => {
    const covered = ['/repo/src/A/A.csproj', '/repo/src/B/B.csproj']
    expect(await covers(covered, listing(covered))).toBe(true)
    expect(
      await covers(
        covered,
        listing(['/repo/src/A/A.csproj', '/repo/src/C/C.csproj']),
      ),
    ).toBe(false)
  })

  it('lists no members while nothing is covered and no twin exists, or for a project or a POM', async () => {
    expect(await covers([], failToList)).toBe(false)
    expect(
      await covers(['/x'], failToList, { dir: '/repo', entryFile: 'A.csproj' }),
    ).toBe(false)
    expect(
      await isRootCovered(
        new Set(['/x']),
        'maven',
        { dir: '/repo', entryFile: 'pom.xml' },
        {},
        failToList,
      ),
    ).toBe(false)
  })

  describe('with an App.sln and App.slnx pair', () => {
    let dir = ''
    const at = (entryFile: string) => ({ dir, entryFile })

    beforeAll(async () => {
      dir = await fs.mkdtemp(path.join(tmpdir(), 'entry-covered-'))
      await fs.writeFile(path.join(dir, 'App.sln'), '')
      await fs.writeFile(path.join(dir, 'App.slnx'), '')
    })

    afterAll(async () => {
      await fs.rm(dir, { recursive: true, force: true })
    })

    it('takes a solution the SDK cannot read as covered by its twin in the other format', async () => {
      const covered = ['/repo/src/A/A.csproj']
      expect(await covers(covered, slnxUnreadable, at('App.slnx'))).toBe(true)
      // Also before anything is covered, e.g. when the twin built nothing.
      expect(await covers([], slnxUnreadable, at('App.slnx'))).toBe(true)
      expect(await covers(covered, slnxUnreadable, at('Other.slnx'))).toBe(
        false,
      )
    })

    it('builds an unreadable solution whose twin is unreadable too, so its failure shows', async () => {
      expect(await covers([], unreadable, at('App.sln'))).toBe(false)
      expect(await covers([], unreadable, at('App.slnx'))).toBe(false)
    })
  })
})
