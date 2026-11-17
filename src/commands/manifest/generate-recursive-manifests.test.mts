import { existsSync, promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { logger } from '@socketsecurity/registry/lib/logger'

vi.mock('../../utils/socket-json.mts', async importOriginal => ({
  ...(await importOriginal<typeof import('../../utils/socket-json.mts')>()),
  readOrDefaultSocketJson: vi.fn(() => ({})),
  // Default: no nested socket.json anywhere in the fixture tree.
  readSocketJsonChain: vi.fn(() => []),
}))
vi.mock('./run-manifest-facts.mts', async importOriginal => ({
  ...(await importOriginal<typeof import('./run-manifest-facts.mts')>()),
  listBuildProjects: vi.fn(),
  listDotnetSolutionMembers: vi.fn(async () => undefined),
  runManifestFacts: vi.fn(),
}))

import { buildRootPath } from './discover-manifest-roots.mts'
import { generateRecursiveManifests } from './generate-recursive-manifests.mts'
import {
  listBuildProjects,
  listDotnetSolutionMembers,
  runManifestFacts,
} from './run-manifest-facts.mts'
import { testPath } from '../../../test/utils.mts'
import {
  readOrDefaultSocketJson,
  readSocketJsonChain,
} from '../../utils/socket-json.mts'

import type {
  RunManifestFactsOutcome,
  SocketFactsWorkDir,
} from './run-manifest-facts.mts'
import type { SocketJson } from '../../utils/socket-json.mts'

type TestProject = {
  manifestFiles?: Array<{ file: string }> | undefined
  subprojectDir: string
  [field: string]: unknown
}

// `targetPath` is `factsPath` unless the run wrote into a work dir.
type TestFacts = {
  factsPath: string
  projects: TestProject[]
  sidecarEntry?: { factsFile: string; stateDir: string } | undefined
  targetPath?: string | undefined
}

// What Coana reports of `projects`, as the build tool at `buildRoot` lists
// them.
function listed(buildRoot: string, projects: readonly TestProject[]) {
  return projects.map(project => ({
    buildFiles: (project.manifestFiles ?? []).map(({ file }) =>
      path.resolve(buildRoot, file),
    ),
    dir: path.resolve(buildRoot, project.subprojectDir),
  }))
}

function reported({
  factsPath,
  projects,
  sidecarEntry,
  targetPath = factsPath,
}: TestFacts) {
  return {
    factsPath,
    projects: listed(path.dirname(targetPath), projects),
    sidecarEntry,
    targetPath,
  }
}

// Answers like Coana given a work dir: the facts go into a state dir of the
// run's own, keyed by its build root as Coana's are.
async function writeIntoWorkDir(
  workDir: SocketFactsWorkDir,
  cwd: string,
  targetPath: string,
  content: string,
): Promise<Pick<TestFacts, 'factsPath' | 'sidecarEntry' | 'targetPath'>> {
  const stateDir = path.join(workDir.dir, Buffer.from(cwd).toString('hex'))
  const factsPath = path.join(stateDir, path.basename(targetPath))
  await fs.mkdir(stateDir, { recursive: true })
  await fs.writeFile(factsPath, content)
  return {
    factsPath,
    sidecarEntry: { factsFile: targetPath, stateDir },
    targetPath,
  }
}

function newWorkDir(parent = '/'): SocketFactsWorkDir {
  return { dir: path.join(parent, 'work'), entries: new Map(), withFiles: true }
}

function mockFacts(
  impl: (
    options: Parameters<typeof runManifestFacts>[0],
  ) => Promise<TestFacts | null | undefined>,
): void {
  vi.mocked(runManifestFacts).mockImplementation(
    async (options): Promise<RunManifestFactsOutcome> => {
      const facts = await impl(options)
      return facts ? reported(facts) : facts
    },
  )
}

// The settings each build root's directory resolves to, as one socket.json at
// the filesystem root.
function mockCascade(cascade: (dir: string) => unknown): void {
  vi.mocked(readSocketJsonChain).mockImplementation(dir => [
    { dir: path.parse(dir).root, sockJson: cascade(dir) as SocketJson },
  ])
}

// `dir`'s own socket.json, with `builds` entries for the builds there.
function mockOwnSettings(own: Record<string, unknown>): void {
  vi.mocked(readSocketJsonChain).mockImplementation(dir =>
    own[dir] ? [{ dir, sockJson: own[dir] as SocketJson }] : [],
  )
}

const monorepo = path.join(
  testPath,
  'fixtures/commands/manifest/dynamic-sbom-inference/monorepo',
)
const pomNames = path.join(
  testPath,
  'fixtures/commands/manifest/dynamic-sbom-inference/pom-names',
)
const reactor = path.join(monorepo, 'reactor')
const dualMarkerDir = path.join(monorepo, 'dual-marker-dir')

function relOf(dir: string): string {
  return path.relative(monorepo, dir).replaceAll('\\', '/')
}

function mavenProject(subprojectDir: string) {
  return {
    type: 'maven' as const,
    name: subprojectDir,
    id: subprojectDir,
    subprojectDir,
    manifestFiles: [{ file: `${subprojectDir}/pom.xml` }],
    children: [],
  }
}

function sentReachability() {
  return Object.fromEntries(
    vi
      .mocked(runManifestFacts)
      .mock.calls.map(([opts]) => [opts.ecosystem, opts.reachability]),
  )
}

describe('generateRecursiveManifests', () => {
  beforeEach(() => {
    vi.mocked(runManifestFacts).mockReset()
    vi.mocked(readOrDefaultSocketJson).mockReturnValue({} as SocketJson)
    mockCascade(() => ({}))
  })
  afterEach(() => {
    process.exitCode = undefined
  })

  it('invokes the reactor root once and skips its declared members, but still visits an undeclared nested submodule and a differently-tooled nested project', async () => {
    mockFacts(async ({ cwd, ecosystem }) => {
      if (cwd === reactor && ecosystem === 'maven') {
        return {
          factsPath: path.join(cwd, '.socket.facts.json'),
          projects: [
            {
              type: 'maven',
              name: 'moduleA',
              subprojectDir: 'moduleA',
              manifestFiles: [{ file: 'moduleA/pom.xml' }],
              children: [],
            },
            {
              type: 'maven',
              name: 'moduleB',
              subprojectDir: 'moduleB',
              manifestFiles: [{ file: 'moduleB/pom.xml' }],
              children: [],
            },
          ],
        }
      }
      return { factsPath: path.join(cwd, '.socket.facts.json'), projects: [] }
    })

    const outcomes = await generateRecursiveManifests({
      cwd: monorepo,
      verbose: false,
    })

    const calledDirs = vi
      .mocked(runManifestFacts)
      .mock.calls.map(([opts]) => `${opts.ecosystem}:${relOf(opts.cwd)}`)
      .sort()
    expect(calledDirs).toEqual(
      [
        'gradle:dual-marker-dir',
        'gradle:reactor/moduleA/nested-gradle',
        'gradle:standalone-gradle',
        'maven:dual-marker-dir',
        'maven:reactor',
        'maven:reactor/moduleB/independent-submodule',
      ].sort(),
    )

    const skipped = outcomes
      .filter(o => o.status === 'skippedCovered')
      .map(o => `${o.ecosystem}:${relOf(o.dir)}`)
      .sort()
    expect(skipped).toEqual(
      ['maven:reactor/moduleA', 'maven:reactor/moduleB'].sort(),
    )
  })

  it.each([
    // Sorting before the reactor ('aaa-shared-lib'), the member is built on
    // its own first and dropped once the reactor turns out to load it; after
    // it ('zzz-shared-lib'), it is never built on its own.
    ['aaa-shared-lib', true],
    ['zzz-shared-lib', false],
  ])(
    'builds a member outside its reactor directory only inside the reactor (name: %s)',
    async (sharedLibName, builtAlone) => {
      const outer = await fs.realpath(
        await fs.mkdtemp(path.join(tmpdir(), 'escaping-subproject-')),
      )
      const reactorA = path.join(outer, 'reactor-a')
      const sharedLib = path.join(outer, sharedLibName)
      const sharedFacts = path.join(sharedLib, 'pom.xml.socket.facts.json')
      const workDir = newWorkDir(outer)
      try {
        await fs.mkdir(reactorA, { recursive: true })
        await fs.mkdir(sharedLib, { recursive: true })
        await fs.writeFile(path.join(reactorA, 'pom.xml'), '<project/>')
        await fs.writeFile(path.join(sharedLib, 'pom.xml'), '<project/>')
        await fs.writeFile(sharedFacts, 'committed')

        mockFacts(async ({ context, cwd }) => {
          return {
            ...(await writeIntoWorkDir(
              context!.workDir!,
              cwd,
              path.join(cwd, 'pom.xml.socket.facts.json'),
              'generated',
            )),
            projects:
              cwd === reactorA
                ? [
                    {
                      type: 'maven',
                      name: 'shared-lib',
                      id: 'shared-lib',
                      subprojectDir: `../${sharedLibName}`,
                      manifestFiles: [{ file: `../${sharedLibName}/pom.xml` }],
                      children: [],
                    },
                  ]
                : [],
          }
        })

        const outcomes = await generateRecursiveManifests({
          context: { workDir },
          cwd: outer,
          verbose: false,
        })

        const byDir = new Map(outcomes.map(o => [o.dir, o.status]))
        expect(byDir.get(reactorA)).toBe('generated')
        expect(byDir.get(sharedLib)).toBe('skippedCovered')
        expect(
          vi
            .mocked(runManifestFacts)
            .mock.calls.some(([opts]) => opts.cwd === sharedLib),
        ).toBe(builtAlone)
        expect(await fs.readFile(sharedFacts, 'utf8')).toBe('committed')
        expect(
          await fs.readFile(
            path.join(reactorA, 'pom.xml.socket.facts.json'),
            'utf8',
          ),
        ).toBe('generated')
        expect([...workDir.entries.keys()]).toEqual([
          path.join(reactorA, 'pom.xml.socket.facts.json'),
        ])
        // The file there is not this scan's, so it is not to be collected.
        expect(
          outcomes.find(o => o.dir === sharedLib)?.discardedFactsPath,
        ).toBe(builtAlone ? sharedFacts : undefined)
      } finally {
        await fs.rm(outer, { recursive: true, force: true })
      }
    },
  )

  it.for([
    // The build that redirects Gradle with `-p` runs second, then first.
    ['a-main', 'z-alias'],
    ['z-main', 'a-alias'],
  ])(
    'keeps the facts and sidecar entry of the kept run together when two runs write one facts file (%s, %s)',
    async ([mainName, aliasName]) => {
      const outer = await fs.realpath(
        await fs.mkdtemp(path.join(tmpdir(), 'shared-facts-')),
      )
      const main = path.join(outer, mainName!)
      const alias = path.join(outer, aliasName!)
      const workDir = newWorkDir(outer)
      try {
        for (const dir of [main, alias]) {
          for (const file of ['settings.gradle', 'build.gradle']) {
            // eslint-disable-next-line no-await-in-loop
            await fs.mkdir(dir, { recursive: true })
            // eslint-disable-next-line no-await-in-loop
            await fs.writeFile(path.join(dir, file), '')
          }
        }
        mockFacts(async ({ context, cwd }) => {
          return {
            ...(await writeIntoWorkDir(
              context!.workDir!,
              cwd,
              path.join(main, 'gradle.socket.facts.json'),
              cwd,
            )),
            projects: [
              {
                type: 'maven' as const,
                name: 'root',
                id: 'root',
                subprojectDir: '.',
                children: [],
              },
            ],
          }
        })

        const outcomes = await generateRecursiveManifests({
          context: { workDir },
          cwd: outer,
          verbose: false,
        })

        const generated = outcomes.filter(o => o.status === 'generated')
        expect(generated).toHaveLength(1)
        const { factsPath } = generated[0]!
        expect(generated[0]!.discardedFactsPath).toBeUndefined()
        // The kept build's own facts and sidecar entry, whichever ran last.
        expect(await fs.readFile(factsPath!, 'utf8')).toBe(generated[0]!.dir)
        expect([...workDir.entries.values()]).toEqual([
          {
            factsFile: factsPath,
            stateDir: path.join(
              workDir.dir,
              Buffer.from(generated[0]!.dir).toString('hex'),
            ),
          },
        ])
      } finally {
        await fs.rm(outer, { recursive: true, force: true })
      }
    },
  )

  it("places only the kept runs' facts, from a work dir of its own that it removes", async () => {
    const outer = await fs.realpath(
      await fs.mkdtemp(path.join(tmpdir(), 'dropped-run-')),
    )
    const lib = path.join(outer, 'aaa-lib')
    const app = path.join(outer, 'app')
    let ownWorkDir: SocketFactsWorkDir | undefined
    try {
      for (const dir of [lib, app]) {
        // eslint-disable-next-line no-await-in-loop
        await fs.mkdir(dir, { recursive: true })
        // eslint-disable-next-line no-await-in-loop
        await fs.writeFile(path.join(dir, 'pom.xml'), '<project/>')
      }
      mockFacts(async ({ context, cwd }) => {
        ownWorkDir = context!.workDir
        return {
          ...(await writeIntoWorkDir(
            context!.workDir!,
            cwd,
            path.join(cwd, 'pom.xml.socket.facts.json'),
            'generated',
          )),
          projects:
            cwd === app
              ? [
                  {
                    type: 'maven',
                    name: 'lib',
                    id: 'lib',
                    subprojectDir: '../aaa-lib',
                    manifestFiles: [{ file: '../aaa-lib/pom.xml' }],
                    children: [],
                  },
                ]
              : [],
        }
      })

      await generateRecursiveManifests({ cwd: outer, verbose: false })

      expect(existsSync(path.join(lib, 'pom.xml.socket.facts.json'))).toBe(
        false,
      )
      expect(existsSync(path.join(app, 'pom.xml.socket.facts.json'))).toBe(true)
      expect(ownWorkDir?.withFiles).toBe(false)
      expect(existsSync(ownWorkDir!.dir)).toBe(false)
    } finally {
      await fs.rm(outer, { recursive: true, force: true })
    }
  })

  it('covers only the build files a build reports, so an independent build sharing a member directory still runs', async () => {
    const outer = await fs.realpath(
      await fs.mkdtemp(path.join(tmpdir(), 'co-located-builds-')),
    )
    const shared = path.join(outer, 'shared')
    const gradleMember = path.join(outer, 'gradle-member')
    try {
      await fs.mkdir(shared, { recursive: true })
      await fs.mkdir(gradleMember, { recursive: true })
      await fs.writeFile(path.join(outer, 'pom.xml'), '<project/>')
      // The reactor declares `<module>shared/alt.xml</module>`.
      await fs.writeFile(path.join(shared, 'alt.xml'), '<project/>')
      await fs.writeFile(path.join(shared, 'pom.xml'), '<project/>')
      await fs.writeFile(path.join(outer, 'settings.gradle'), '')
      await fs.writeFile(path.join(gradleMember, 'build.gradle'), '')
      await fs.writeFile(path.join(gradleMember, 'pom.xml'), '<project/>')

      mockFacts(async ({ cwd, ecosystem }) => {
        if (cwd === outer && ecosystem === 'maven') {
          return {
            factsPath: path.join(cwd, 'pom.xml.socket.facts.json'),
            projects: [
              {
                type: 'maven',
                name: 'shared',
                subprojectDir: 'shared',
                manifestFiles: [{ file: 'shared/alt.xml' }],
                children: [],
              },
            ],
          }
        }
        if (cwd === outer && ecosystem === 'gradle') {
          return {
            factsPath: path.join(cwd, 'gradle.socket.facts.json'),
            projects: [
              {
                type: 'maven',
                name: 'gradle-member',
                subprojectDir: 'gradle-member',
                manifestFiles: [{ file: 'gradle-member/build.gradle' }],
                children: [],
              },
            ],
          }
        }
        return {
          factsPath: path.join(cwd, `${ecosystem}.socket.facts.json`),
          projects: [],
        }
      })

      const outcomes = await generateRecursiveManifests({
        cwd: outer,
        verbose: false,
      })

      const byKey = new Map(
        outcomes.map(o => [`${o.ecosystem}:${o.dir}`, o.status]),
      )
      expect(byKey.get(`maven:${shared}`)).toBe('generated')
      expect(byKey.get(`gradle:${gradleMember}`)).toBe('skippedCovered')
      expect(byKey.get(`maven:${gradleMember}`)).toBe('generated')
    } finally {
      await fs.rm(outer, { recursive: true, force: true })
    }
  })

  it('covers a build root through any of its build files, not only the one a build was run on', async () => {
    const outer = await fs.realpath(
      await fs.mkdtemp(path.join(tmpdir(), 'sbt-member-')),
    )
    const member = path.join(outer, 'member')
    try {
      await fs.mkdir(member, { recursive: true })
      await fs.writeFile(path.join(outer, 'build.sbt'), '')
      await fs.writeFile(path.join(member, 'build.sbt'), '')

      mockFacts(async ({ cwd }) => ({
        factsPath: path.join(cwd, 'sbt.socket.facts.json'),
        projects:
          cwd === outer
            ? [
                {
                  type: 'maven',
                  name: 'member',
                  subprojectDir: 'member',
                  manifestFiles: [
                    { file: 'build.sbt' },
                    { file: 'member/build.sbt' },
                  ],
                  children: [],
                },
              ]
            : [],
      }))

      const outcomes = await generateRecursiveManifests({
        cwd: outer,
        verbose: false,
      })

      const byDir = new Map(outcomes.map(o => [o.dir, o.status]))
      expect(byDir.get(member)).toBe('skippedCovered')
      expect(runManifestFacts).toHaveBeenCalledTimes(1)
    } finally {
      await fs.rm(outer, { recursive: true, force: true })
    }
  })

  it('does not cover a build root through a reported build file that is absent on disk', async () => {
    const outer = await fs.realpath(
      await fs.mkdtemp(path.join(tmpdir(), 'absent-build-file-')),
    )
    const tools = path.join(outer, 'tools')
    try {
      await fs.mkdir(tools, { recursive: true })
      await fs.writeFile(path.join(outer, 'settings.gradle'), "include 'tools'")
      await fs.writeFile(path.join(tools, 'settings.gradle'), '')

      mockFacts(async ({ cwd }) => ({
        factsPath: path.join(cwd, 'gradle.socket.facts.json'),
        projects:
          cwd === outer
            ? [
                {
                  type: 'maven',
                  name: 'tools',
                  subprojectDir: 'tools',
                  manifestFiles: [{ file: 'tools/build.gradle' }],
                  children: [],
                },
              ]
            : [],
      }))

      const outcomes = await generateRecursiveManifests({
        cwd: outer,
        verbose: false,
      })

      const byDir = new Map(outcomes.map(o => [o.dir, o.status]))
      expect(byDir.get(tools)).toBe('generated')
    } finally {
      await fs.rm(outer, { recursive: true, force: true })
    }
  })

  it('judges coverage against the reported build root, not the discovery directory, anywhere in the scan root', async () => {
    const outer = await fs.realpath(
      await fs.mkdtemp(path.join(tmpdir(), 'relocated-build-root-')),
    )
    const buildRoot = path.join(outer, 'build')
    const member = path.join(buildRoot, 'member')
    const escaped = path.join(outer, 'escaped')
    try {
      for (const dir of [outer, member, escaped]) {
        // eslint-disable-next-line no-await-in-loop
        await fs.mkdir(dir, { recursive: true })
        // eslint-disable-next-line no-await-in-loop
        await fs.writeFile(path.join(dir, 'pom.xml'), '<project/>')
      }
      mockFacts(async ({ cwd }) => {
        if (cwd === outer) {
          return {
            factsPath: path.join(buildRoot, 'x.xml.socket.facts.json'),
            projects: [
              {
                type: 'maven',
                name: 'member',
                subprojectDir: 'member',
                manifestFiles: [{ file: 'member/pom.xml' }],
                dependencies: [],
              },
              {
                type: 'maven',
                name: 'escaped',
                subprojectDir: '../escaped',
                manifestFiles: [{ file: '../escaped/pom.xml' }],
                dependencies: [],
              },
            ],
          }
        }
        return {
          factsPath: path.join(cwd, 'pom.xml.socket.facts.json'),
          projects: [],
        }
      })

      const outcomes = await generateRecursiveManifests({
        cwd: outer,
        verbose: false,
      })

      const byDir = new Map(outcomes.map(o => [o.dir, o.status]))
      expect(byDir.get(member)).toBe('skippedCovered')
      // Inside the scan root, though outside its build root.
      expect(byDir.get(escaped)).toBe('skippedCovered')
    } finally {
      await fs.rm(outer, { recursive: true, force: true })
    }
  })

  it("runs both ecosystems unconditionally at a dual-marker directory (matches auto's existing behavior)", async () => {
    mockFacts(async ({ cwd }) => ({
      factsPath: path.join(cwd, '.socket.facts.json'),
      projects: [],
    }))

    const outcomes = await generateRecursiveManifests({
      cwd: monorepo,
      verbose: false,
    })

    const atDualMarkerDir = outcomes.filter(o => o.dir === dualMarkerDir)
    expect(atDualMarkerDir.map(o => o.ecosystem).sort()).toEqual([
      'gradle',
      'maven',
    ])
    expect(atDualMarkerDir.every(o => o.status === 'generated')).toBe(true)
  })

  it('aborts only the build roots in and under a failed one, which may be its members, while siblings and other ecosystems proceed', async () => {
    mockFacts(async ({ cwd, ecosystem }) => {
      if (ecosystem === 'maven' && cwd === reactor) {
        process.exitCode = 1
        return null
      }
      return { factsPath: path.join(cwd, '.socket.facts.json'), projects: [] }
    })
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => logger)

    try {
      const outcomes = await generateRecursiveManifests({
        cwd: monorepo,
        verbose: false,
      })

      const byKey = new Map(
        outcomes.map(o => [`${o.ecosystem}:${relOf(o.dir)}`, o.status]),
      )
      expect(byKey.get('maven:reactor')).toBe('failed')
      // Without reactor's projects[], its members can't be told apart from
      // independent projects beneath it.
      for (const member of [
        'maven:reactor/moduleA',
        'maven:reactor/moduleB',
        'maven:reactor/moduleB/independent-submodule',
      ]) {
        expect(byKey.get(member)).toBe('aborted')
      }
      expect(
        vi
          .mocked(runManifestFacts)
          .mock.calls.filter(([opts]) => opts.ecosystem === 'maven')
          .map(([opts]) => relOf(opts.cwd))
          .sort(),
      ).toEqual(['dual-marker-dir', 'reactor'])
      expect(byKey.get('maven:dual-marker-dir')).toBe('generated')
      expect(byKey.get('gradle:reactor/moduleA/nested-gradle')).toBe(
        'generated',
      )
      expect(
        warnSpy.mock.calls.some(c =>
          /Not building 3 maven build root\(s\) in or under \S*reactor:/.test(
            String(c[0]),
          ),
        ),
      ).toBe(true)
      expect(process.exitCode).toBe(1)
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('excuses the failure of a member built on its own before the build that loads it', async () => {
    const outer = await fs.realpath(
      await fs.mkdtemp(path.join(tmpdir(), 'misordered-member-')),
    )
    const core = path.join(outer, 'core')
    const parent = path.join(outer, 'parent')
    try {
      for (const dir of [core, parent]) {
        // eslint-disable-next-line no-await-in-loop
        await fs.mkdir(dir, { recursive: true })
        // eslint-disable-next-line no-await-in-loop
        await fs.writeFile(path.join(dir, 'pom.xml'), '<project/>')
      }
      mockFacts(async ({ cwd }) => {
        if (cwd === core) {
          process.exitCode = 1
          return null
        }
        return {
          factsPath: path.join(cwd, 'pom.xml.socket.facts.json'),
          projects: [
            {
              type: 'maven',
              name: 'core',
              id: 'core',
              subprojectDir: '../core',
              manifestFiles: [{ file: '../core/pom.xml' }],
              children: [],
            },
          ],
        }
      })

      const outcomes = await generateRecursiveManifests({
        cwd: outer,
        verbose: false,
      })

      const byDir = new Map(outcomes.map(o => [o.dir, o.status]))
      expect(byDir.get(core)).toBe('skippedCovered')
      expect(byDir.get(parent)).toBe('generated')
      expect(process.exitCode).toBeUndefined()
    } finally {
      await fs.rm(outer, { recursive: true, force: true })
    }
  })

  it('still classifies a failure as failed (not empty) when process.exitCode was already non-zero beforehand', async () => {
    process.exitCode = 1
    mockFacts(async ({ cwd, ecosystem }) => {
      if (ecosystem === 'maven' && cwd === dualMarkerDir) {
        process.exitCode = 1
        return null
      }
      return { factsPath: path.join(cwd, '.socket.facts.json'), projects: [] }
    })
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => logger)

    try {
      const outcomes = await generateRecursiveManifests({
        cwd: monorepo,
        verbose: false,
      })

      const byKey = new Map(
        outcomes.map(o => [`${o.ecosystem}:${relOf(o.dir)}`, o.status]),
      )
      expect(byKey.get('maven:dual-marker-dir')).toBe('failed')
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('reports a non-fatal empty result distinctly from a failure', async () => {
    mockFacts(async ({ cwd, ecosystem }) => {
      if (ecosystem === 'maven' && cwd === dualMarkerDir) {
        // No resolvable dependencies; runManifestFacts warns but does not fail.
        return undefined
      }
      return { factsPath: path.join(cwd, '.socket.facts.json'), projects: [] }
    })

    const outcomes = await generateRecursiveManifests({
      cwd: monorepo,
      verbose: false,
    })

    const byKey = new Map(
      outcomes.map(o => [`${o.ecosystem}:${relOf(o.dir)}`, o.status]),
    )
    expect(byKey.get('maven:dual-marker-dir')).toBe('empty')
  })

  it('passes every build root the scan-root-relative --exclude-paths and the scan root', async () => {
    mockFacts(async ({ cwd }) => ({
      factsPath: path.join(cwd, '.socket.facts.json'),
      projects: [],
    }))

    await generateRecursiveManifests({
      cwd: monorepo,
      excludePaths: ['reactor/moduleB'],
      verbose: false,
    })

    const reactorCall = vi
      .mocked(runManifestFacts)
      .mock.calls.map(([opts]) => opts)
      .find(opts => opts.cwd === reactor)
    expect(reactorCall).toMatchObject({
      excludeBase: await fs.realpath(monorepo),
      excludePaths: ['reactor/moduleB'],
    })
  })

  it("does not list a solution's members for coverage another tool's builds recorded", async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'dsi-per-tool-'))
    try {
      await fs.writeFile(path.join(dir, 'pom.xml'), '<project/>')
      await fs.writeFile(path.join(dir, 'App.sln'), '')
      vi.mocked(listDotnetSolutionMembers).mockClear()
      mockFacts(async ({ cwd, entryFile }) => ({
        factsPath: path.join(cwd, `${entryFile}.socket.facts.json`),
        projects: [
          {
            type: 'maven',
            name: 'app',
            subprojectDir: '',
            manifestFiles: [{ file: 'pom.xml' }],
            children: [],
          },
        ],
      }))
      const outcomes = await generateRecursiveManifests({
        cwd: dir,
        verbose: false,
      })

      expect(
        outcomes.map(o => `${o.ecosystem}:${o.entryFile}:${o.status}`).sort(),
      ).toEqual(['dotnet:App.sln:generated', 'maven:pom.xml:generated'])
      expect(listDotnetSolutionMembers).not.toHaveBeenCalled()
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('resolves each build root its own nearest socket.json instead of only the root config', async () => {
    mockCascade(dir =>
      dir === dualMarkerDir
        ? { defaults: { manifest: { maven: { javaHome: '/opt/jdk-11' } } } }
        : {},
    )
    mockFacts(async ({ cwd }) => ({
      factsPath: path.join(cwd, '.socket.facts.json'),
      projects: [],
    }))

    await generateRecursiveManifests({
      cwd: monorepo,
      verbose: false,
    })

    const javaHomeByCall = new Map(
      vi
        .mocked(runManifestFacts)
        .mock.calls.map(([opts]) => [
          `${opts.ecosystem}:${relOf(opts.cwd)}`,
          opts.javaHome,
        ]),
    )
    expect(javaHomeByCall.get('maven:dual-marker-dir')).toBe('/opt/jdk-11')
    expect(javaHomeByCall.get('gradle:dual-marker-dir')).toBeUndefined()
    expect(javaHomeByCall.get('maven:reactor')).toBeUndefined()
  })

  describe('reachability settings', () => {
    let outer = ''
    beforeEach(async () => {
      outer = await fs.realpath(
        await fs.mkdtemp(path.join(tmpdir(), 'dsi-reachability-')),
      )
      for (const file of [
        'dotnet/App.sln',
        'gradle/build.gradle',
        'maven/pom.xml',
        'sbt/build.sbt',
      ]) {
        // eslint-disable-next-line no-await-in-loop
        await fs.mkdir(path.join(outer, path.dirname(file)))
        // eslint-disable-next-line no-await-in-loop
        await fs.writeFile(path.join(outer, file), '')
      }
      mockFacts(async ({ cwd }) => ({
        factsPath: path.join(cwd, '.socket.facts.json'),
        projects: [],
      }))
    })
    afterEach(async () => {
      await fs.rm(outer, { recursive: true, force: true })
    })

    it("sends each root's cascaded settings on a reachability scan", async () => {
      mockCascade(() => ({
        defaults: {
          manifest: {
            dotnet: {
              reachability: { build: 'compile', runtimeVersion: '8.0' },
            },
            gradle: {
              reachability: { build: 'compile', javaHome: '$GRADLE_JDK' },
            },
            maven: { reachability: { build: 'none' } },
          },
        },
      }))

      await generateRecursiveManifests({
        context: { workDir: newWorkDir() },
        cwd: outer,
        verbose: false,
      })

      expect(sentReachability()).toStrictEqual({
        dotnet: { build: 'compile', runtimeVersion: '8.0' },
        gradle: { build: 'compile', javaHome: '$GRADLE_JDK' },
        maven: { build: 'none' },
        sbt: undefined,
      })
    })

    it('neither sends nor checks them without a reachability scan', async () => {
      mockCascade(() => ({
        defaults: {
          manifest: { maven: { reachability: { build: 'always' } } },
        },
      }))

      const outcomes = await generateRecursiveManifests({
        cwd: outer,
        verbose: false,
      })

      expect(outcomes.every(o => o.status === 'generated')).toBe(true)
      expect(Object.values(sentReachability())).toEqual([
        undefined,
        undefined,
        undefined,
        undefined,
      ])
    })

    it('fails a reachability scan on an invalid setting of a tool it runs, before any build, not of one it does not', async () => {
      mockCascade(() => ({
        defaults: {
          manifest: { dotnet: { reachability: { runtimeVersion: 'net8.0' } } },
        },
      }))
      await expect(
        generateRecursiveManifests({
          context: { workDir: newWorkDir() },
          cwd: outer,
          purlTypes: ['maven'],
          verbose: false,
        }),
      ).resolves.toBeDefined()

      await expect(
        generateRecursiveManifests({
          context: { workDir: newWorkDir() },
          cwd: outer,
          purlTypes: ['nuget'],
          verbose: false,
        }),
      ).rejects.toThrow(/reachability\.runtimeVersion` in .* is "net8\.0"/)

      // sbt builds after Gradle and Maven.
      mockCascade(() => ({
        defaults: { manifest: { sbt: { reachability: { build: 'always' } } } },
      }))
      vi.mocked(runManifestFacts).mockClear()
      await expect(
        generateRecursiveManifests({
          context: { workDir: newWorkDir() },
          cwd: outer,
          purlTypes: ['maven'],
          verbose: false,
        }),
      ).rejects.toThrow(/sbt\.reachability\.build` in .* is "always"/)
      expect(runManifestFacts).not.toHaveBeenCalled()
    })

    it.for([
      {
        name: 'socket.json disables',
        manifest: {
          sbt: { disabled: true, reachability: { build: 'always' } },
        },
      },
      {
        name: 'generates pom files',
        manifest: {
          gradle: { facts: false, reachability: { build: 'always' } },
        },
      },
    ])('does not check the settings of a build $name', async ({ manifest }) => {
      mockCascade(() => ({ defaults: { manifest } }) as SocketJson)

      await expect(
        generateRecursiveManifests({
          context: { workDir: newWorkDir() },
          cwd: outer,
          purlTypes: ['maven'],
          verbose: false,
        }),
      ).resolves.toBeDefined()
    })
  })

  it('resolves an explicit null override back to the no-restriction default, not a literal null', async () => {
    mockCascade(dir =>
      dir === dualMarkerDir
        ? {
            defaults: {
              manifest: {
                maven: {
                  excludeConfigs: null,
                  javaHome: null,
                },
              },
            },
          }
        : {},
    )
    mockFacts(async ({ cwd }) => ({
      factsPath: path.join(cwd, '.socket.facts.json'),
      projects: [],
    }))

    await generateRecursiveManifests({
      cwd: monorepo,
      verbose: false,
    })

    const call = vi
      .mocked(runManifestFacts)
      .mock.calls.find(
        ([opts]) => opts.cwd === dualMarkerDir && opts.ecosystem === 'maven',
      )
    expect(call?.[0].excludeConfigs).toBe('')
    expect(call?.[0].javaHome).toBeUndefined()
  })

  it("honors a build root's own socket.json verbose and points hints at it", async () => {
    mockCascade(dir =>
      dir === dualMarkerDir
        ? { defaults: { manifest: { maven: { verbose: true } } } }
        : {},
    )
    mockFacts(async ({ cwd }) => ({
      factsPath: path.join(cwd, '.socket.facts.json'),
      projects: [],
    }))

    await generateRecursiveManifests({ cwd: monorepo, verbose: false })

    const calls = vi.mocked(runManifestFacts).mock.calls.map(([opts]) => opts)
    const verboseByCall = new Map(
      calls.map(opts => [`${opts.ecosystem}:${relOf(opts.cwd)}`, opts.verbose]),
    )
    expect(verboseByCall.get('maven:dual-marker-dir')).toBe(true)
    expect(verboseByCall.get('gradle:dual-marker-dir')).toBe(false)
    const hints = calls.find(
      opts =>
        `${opts.ecosystem}:${relOf(opts.cwd)}` === 'maven:dual-marker-dir',
    )?.hints
    expect(hints?.flags.size).toBe(0)
    expect(hints?.excludePathsFlag).toBe('--exclude-paths')
    expect(path.resolve(hints?.socketJson ?? '')).toBe(
      path.join(dualMarkerDir, 'socket.json'),
    )
  })

  it.each([true, false])(
    'lets an explicit ignoreUnresolved (%s) override every build root socket.json',
    async ignoreUnresolved => {
      mockCascade(dir =>
        dir === dualMarkerDir
          ? {
              defaults: {
                manifest: { maven: { ignoreUnresolved: !ignoreUnresolved } },
              },
            }
          : {},
      )
      mockFacts(async ({ cwd }) => ({
        factsPath: path.join(cwd, '.socket.facts.json'),
        projects: [],
      }))

      await generateRecursiveManifests({
        cwd: monorepo,
        ignoreUnresolved,
        verbose: false,
      })

      const calls = vi.mocked(runManifestFacts).mock.calls.map(([opts]) => opts)
      expect(calls.length).toBeGreaterThan(1)
      expect(
        calls.every(opts => opts.ignoreUnresolved === ignoreUnresolved),
      ).toBe(true)
    },
  )

  it("falls back to each build root's socket.json ignoreUnresolved when not overridden", async () => {
    mockCascade(dir =>
      dir === dualMarkerDir
        ? { defaults: { manifest: { maven: { ignoreUnresolved: true } } } }
        : {},
    )
    mockFacts(async ({ cwd }) => ({
      factsPath: path.join(cwd, '.socket.facts.json'),
      projects: [],
    }))

    await generateRecursiveManifests({
      cwd: monorepo,
      verbose: false,
    })

    const ignoreByCall = new Map(
      vi
        .mocked(runManifestFacts)
        .mock.calls.map(([opts]) => [
          `${opts.ecosystem}:${relOf(opts.cwd)}`,
          opts.ignoreUnresolved,
        ]),
    )
    expect(ignoreByCall.get('maven:dual-marker-dir')).toBe(true)
    expect(ignoreByCall.get('maven:reactor')).toBe(false)
  })

  it('skips (with a warning) a resolved config that sets facts: false, never invoking the build tool', async () => {
    mockCascade(dir =>
      dir === dualMarkerDir
        ? { defaults: { manifest: { gradle: { facts: false } } } }
        : {},
    )
    mockFacts(async ({ cwd }) => ({
      factsPath: path.join(cwd, '.socket.facts.json'),
      projects: [],
    }))
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => logger)

    try {
      const outcomes = await generateRecursiveManifests({
        cwd: monorepo,
        verbose: false,
      })

      const warned = warnSpy.mock.calls.map(c => String(c[0])).join('\n')
      expect(warned).toMatch(/facts is false/)

      const byKey = new Map(
        outcomes.map(o => [`${o.ecosystem}:${relOf(o.dir)}`, o.status]),
      )
      expect(byKey.get('gradle:dual-marker-dir')).toBe('skippedDisabled')
      expect(
        vi
          .mocked(runManifestFacts)
          .mock.calls.some(
            ([opts]) =>
              opts.cwd === dualMarkerDir && opts.ecosystem === 'gradle',
          ),
      ).toBe(false)
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('warns once per setting that disables build roots, not once per build root it skips', async () => {
    const independentSubmodule = path.join(
      reactor,
      'moduleB',
      'independent-submodule',
    )
    // Maven-only candidates nested under reactor; excludes the differently-
    // tooled reactor/moduleA/nested-gradle, which is its own gradle-ecosystem
    // candidate never marked disabled and correctly still walks from cwd.
    const nestedMavenDirs = new Set([
      path.join(reactor, 'moduleA'),
      path.join(reactor, 'moduleB'),
      independentSubmodule,
    ])
    mockCascade(dir =>
      dir === reactor || nestedMavenDirs.has(dir)
        ? { defaults: { manifest: { maven: { disabled: true } } } }
        : {},
    )
    mockFacts(async ({ cwd }) => ({
      factsPath: path.join(cwd, '.socket.facts.json'),
      projects: [],
    }))
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => logger)

    try {
      const outcomes = await generateRecursiveManifests({
        cwd: monorepo,
        verbose: false,
      })

      const byKey = new Map(
        outcomes.map(o => [`${o.ecosystem}:${relOf(o.dir)}`, o.status]),
      )
      expect(byKey.get('maven:reactor')).toBe('skippedDisabled')
      expect(byKey.get('maven:reactor/moduleB/independent-submodule')).toBe(
        'skippedDisabled',
      )
      expect(
        vi
          .mocked(runManifestFacts)
          .mock.calls.some(
            ([opts]) =>
              opts.ecosystem === 'maven' &&
              opts.cwd.startsWith(reactor) &&
              opts.cwd !== independentSubmodule,
          ),
      ).toBe(false)
      // Four maven candidates end up skippedDisabled (reactor + moduleA +
      // moduleB + independent-submodule), but only the root cause should
      // warn - otherwise a big disabled reactor spams one line per pom.
      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(String(warnSpy.mock.calls[0]?.[0])).toMatch(
        /sets defaults\.manifest\.maven\.disabled/,
      )
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('still honors a nested override that re-enables a build root under an otherwise-disabled ancestor', async () => {
    const independentSubmodule = path.join(
      reactor,
      'moduleB',
      'independent-submodule',
    )
    mockCascade(dir => {
      if (dir === reactor) {
        return { defaults: { manifest: { maven: { disabled: true } } } }
      }
      if (dir === independentSubmodule) {
        // Its own socket.json explicitly clears the inherited disable.
        return { defaults: { manifest: { maven: { disabled: false } } } }
      }
      return {}
    })
    mockFacts(async ({ cwd }) => ({
      factsPath: path.join(cwd, '.socket.facts.json'),
      projects: [],
    }))
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => logger)

    try {
      const outcomes = await generateRecursiveManifests({
        cwd: monorepo,
        verbose: false,
      })

      const byKey = new Map(
        outcomes.map(o => [`${o.ecosystem}:${relOf(o.dir)}`, o.status]),
      )
      expect(byKey.get('maven:reactor')).toBe('skippedDisabled')
      expect(byKey.get('maven:reactor/moduleB/independent-submodule')).toBe(
        'generated',
      )
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('still discovers a build root when the root socket.json disables its whole ecosystem, so a nested override can re-enable it', async () => {
    vi.mocked(readOrDefaultSocketJson).mockReturnValue({
      defaults: { manifest: { maven: { disabled: true } } },
    } as SocketJson)
    mockCascade(dir => ({
      defaults: { manifest: { maven: { disabled: dir !== reactor } } },
    }))
    mockFacts(async ({ cwd }) => ({
      factsPath: path.join(cwd, '.socket.facts.json'),
      projects: [],
    }))
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => logger)

    try {
      const outcomes = await generateRecursiveManifests({
        cwd: monorepo,
        verbose: false,
      })

      const byKey = new Map(
        outcomes.map(o => [`${o.ecosystem}:${relOf(o.dir)}`, o.status]),
      )
      // Root-disabled maven is still scanned for at all (not dropped
      // entirely), so the nested override is actually found and generated.
      expect(byKey.get('maven:reactor')).toBe('generated')
      expect(byKey.get('maven:dual-marker-dir')).toBe('skippedDisabled')
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('skips (with a warning) a resolved config that sets a cascaded disabled: true', async () => {
    mockCascade(dir =>
      dir === reactor
        ? { defaults: { manifest: { maven: { disabled: true } } } }
        : {},
    )
    mockFacts(async ({ cwd }) => ({
      factsPath: path.join(cwd, '.socket.facts.json'),
      projects: [],
    }))
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => logger)

    try {
      const outcomes = await generateRecursiveManifests({
        cwd: monorepo,
        verbose: false,
      })

      const warned = warnSpy.mock.calls.map(c => String(c[0])).join('\n')
      expect(warned).toMatch(/sets defaults\.manifest\.maven\.disabled/)

      const byKey = new Map(
        outcomes.map(o => [`${o.ecosystem}:${relOf(o.dir)}`, o.status]),
      )
      expect(byKey.get('maven:reactor')).toBe('skippedDisabled')
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('reads the socket.json files above a symlinked scan directory, through its real path', async () => {
    const actual = await vi.importActual<
      typeof import('../../utils/socket-json.mts')
    >('../../utils/socket-json.mts')
    vi.mocked(readOrDefaultSocketJson).mockImplementation(
      actual.readOrDefaultSocketJson,
    )
    vi.mocked(readSocketJsonChain).mockImplementation(
      actual.readSocketJsonChain,
    )

    const outer = await fs.realpath(
      await fs.mkdtemp(path.join(tmpdir(), 'symlink-cascade-')),
    )
    const realCwd = path.join(outer, 'real-cwd')
    const cwdLink = path.join(outer, 'cwd-link')
    const project = path.join(realCwd, 'project')
    try {
      await fs.mkdir(project, { recursive: true })
      await fs.writeFile(path.join(project, 'pom.xml'), '<project/>')
      await fs.writeFile(
        path.join(outer, 'socket.json'),
        JSON.stringify({
          version: 1,
          defaults: { manifest: { maven: { bin: 'ABOVE-BIN' } } },
        }),
      )
      await fs.symlink(realCwd, cwdLink)
      mockFacts(async ({ cwd }) => ({
        factsPath: path.join(cwd, '.socket.facts.json'),
        projects: [],
      }))

      await generateRecursiveManifests({ cwd: cwdLink, verbose: false })

      expect(
        vi.mocked(runManifestFacts).mock.calls.map(([opts]) => opts.bin),
      ).toEqual(['ABOVE-BIN'])
    } finally {
      await fs.rm(outer, { recursive: true, force: true })
    }
  })

  it('threads the work dir through to every build root, not just the first', async () => {
    mockFacts(async ({ cwd }) => ({
      factsPath: path.join(cwd, '.socket.facts.json'),
      projects: [],
    }))

    const context = { orgSlug: 'acme', workDir: newWorkDir() }
    await generateRecursiveManifests({ context, cwd: monorepo, verbose: false })

    expect(vi.mocked(runManifestFacts).mock.calls.length).toBeGreaterThan(1)
    for (const [opts] of vi.mocked(runManifestFacts).mock.calls) {
      expect(opts.context).toEqual(context)
      expect(opts.hints?.continueOnInstallErrorsFlag).toBe(
        '--reach-continue-on-install-errors',
      )
    }
  })

  it('runs every POM in a directory as its own build', async () => {
    mockFacts(async ({ cwd, entryFile }) => ({
      factsPath: path.join(cwd, `${entryFile}.socket.facts.json`),
      projects: [],
    }))

    const outcomes = await generateRecursiveManifests({
      cwd: pomNames,
      verbose: false,
    })

    const calls = vi
      .mocked(runManifestFacts)
      .mock.calls.map(([opts]) => [
        path.relative(pomNames, opts.cwd).replaceAll('\\', '/'),
        opts.entryFile,
      ])
    expect(calls).toEqual([
      ['', 'app-dev.pom.xml'],
      ['', 'pom.xml'],
      ['bare', 'pom'],
      ['upper', 'POM.XML'],
      ['vendored', 'lib-1.0.pom'],
    ])
    expect(outcomes.every(o => o.status === 'generated')).toBe(true)
  })

  it('covers a POM by file, so a sibling POM in the same directory still runs', async () => {
    mockFacts(async ({ cwd, entryFile }) => ({
      factsPath: path.join(cwd, `${entryFile}.socket.facts.json`),
      projects:
        cwd === pomNames && entryFile === 'pom.xml'
          ? [
              {
                type: 'maven',
                name: 'bare',
                subprojectDir: 'bare',
                manifestFiles: [{ file: 'bare/pom' }],
                children: [],
              },
            ]
          : [],
    }))

    const outcomes = await generateRecursiveManifests({
      cwd: pomNames,
      verbose: false,
    })

    const statusOf = (rel: string) =>
      outcomes.find(o => buildRootPath(o) === path.join(pomNames, rel))?.status
    expect(statusOf('pom.xml')).toBe('generated')
    expect(statusOf('app-dev.pom.xml')).toBe('generated')
    expect(statusOf('bare/pom')).toBe('skippedCovered')
  })

  it('resolves settings once per directory and drops a --file in mavenOpts with a warning', async () => {
    mockCascade(() => ({
      defaults: {
        manifest: {
          maven: {
            mavenOpts:
              '--file other.xml -P ci -fae -fother.xml -fail-fast -file=x.xml',
          },
        },
      },
    }))
    vi.mocked(readSocketJsonChain).mockClear()
    mockFacts(async ({ cwd, entryFile }) => ({
      factsPath: path.join(cwd, `${entryFile}.socket.facts.json`),
      projects: [],
    }))
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => logger)

    try {
      await generateRecursiveManifests({ cwd: pomNames, verbose: false })

      const cascadeDirs = vi
        .mocked(readSocketJsonChain)
        .mock.calls.map(([dir]) => dir)
      expect(cascadeDirs.length).toBeGreaterThan(0)
      expect(cascadeDirs).toEqual([...new Set(cascadeDirs)])
      expect(
        warnSpy.mock.calls.filter(c => String(c[0]).includes('--file')),
      ).toHaveLength(cascadeDirs.length)
      expect(
        vi.mocked(runManifestFacts).mock.calls.map(([o]) => o.buildOpts),
      ).toEqual(
        vi
          .mocked(runManifestFacts)
          .mock.calls.map(() => ['-P', 'ci', '-fae', '-fail-fast']),
      )
    } finally {
      warnSpy.mockRestore()
    }
  })

  describe('with a Gradle build nested in another that includes its directory', () => {
    let outer = ''
    const gradleFacts = (cwd: string, dirs: string[]) => ({
      factsPath: path.join(cwd, 'gradle.socket.facts.json'),
      projects: dirs.map(subprojectDir => ({
        type: 'maven' as const,
        name: subprojectDir,
        id: subprojectDir,
        subprojectDir,
        children: [],
      })),
    })

    beforeEach(async () => {
      outer = await fs.realpath(
        await fs.mkdtemp(path.join(tmpdir(), 'nested-gradle-build-')),
      )
      for (const file of [
        'settings.gradle',
        'build.gradle',
        'sub/settings.gradle',
        'sub/build.gradle',
        'sub/a/build.gradle',
      ]) {
        // eslint-disable-next-line no-await-in-loop
        await fs.mkdir(path.dirname(path.join(outer, file)), {
          recursive: true,
        })
        // eslint-disable-next-line no-await-in-loop
        await fs.writeFile(path.join(outer, file), '')
      }
    })
    afterEach(async () => {
      await fs.rm(outer, { recursive: true, force: true })
    })

    it.for([
      // sub's own settings include `a`, which the outer build does not load.
      [['.', 'a'], 'generated'],
      // Everything sub loads, the outer build loads too.
      [['.'], 'skippedCovered'],
    ] as const)(
      'runs the nested build and keeps it only when it loads more (%j)',
      async ({ 0: subProjects, 1: subStatus }) => {
        const sub = path.join(outer, 'sub')
        mockFacts(async ({ cwd }) =>
          cwd === outer
            ? gradleFacts(cwd, [
                '.',
                'sub',
                ...(subProjects.length > 1 ? [] : ['sub/a']),
              ])
            : gradleFacts(cwd, [...subProjects]),
        )

        const outcomes = await generateRecursiveManifests({
          cwd: outer,
          purlTypes: ['maven'],
          verbose: false,
        })

        const byDir = new Map(
          outcomes
            .filter(o => o.ecosystem === 'gradle')
            .map(o => [path.relative(outer, o.dir) || '.', o.status]),
        )
        expect(byDir.get('.')).toBe('generated')
        expect(byDir.get('sub')).toBe(subStatus)
        expect(byDir.get('sub/a')).toBe('skippedCovered')
        expect(
          vi
            .mocked(runManifestFacts)
            .mock.calls.map(([o]) => path.relative(outer, o.cwd) || '.'),
        ).toEqual(['.', 'sub'])
      },
    )

    it('ignores the failure of a nested build of its own when the build that includes its directory succeeds', async () => {
      mockFacts(async ({ cwd }) => {
        if (cwd === path.join(outer, 'sub')) {
          process.exitCode = 1
          return null
        }
        return gradleFacts(cwd, ['.', 'sub', 'sub/a'])
      })
      vi.spyOn(logger, 'info').mockImplementation(() => logger)

      const outcomes = await generateRecursiveManifests({
        cwd: outer,
        purlTypes: ['maven'],
        verbose: false,
      })

      expect(
        outcomes.find(o => o.dir === path.join(outer, 'sub'))?.status,
      ).toBe('skippedCovered')
      expect(outcomes.some(o => o.status === 'failed')).toBe(false)
      expect(process.exitCode).toBeUndefined()
    })

    it.for([
      // `a` is a project of sub: skipped with what sub loads.
      [['.', 'a'], 'and its 1 module'],
      // `a` isn't: Gradle can only run it through sub, which is skipped.
      [['.'], ''],
    ] as const)(
      'skips a skipped settings build and the Gradle directories beneath it that belong to it (%j)',
      async ({ 0: subProjects, 1: modules }) => {
        const sub = path.join(outer, 'sub')
        mockOwnSettings({
          [sub]: {
            defaults: {
              manifest: { builds: { 'settings.gradle': { disabled: true } } },
            },
          },
        })
        vi.mocked(listBuildProjects).mockResolvedValue(
          listed(sub, gradleFacts(sub, [...subProjects]).projects),
        )
        mockFacts(async ({ cwd }) => gradleFacts(cwd, ['.']))
        const warnSpy = vi
          .spyOn(logger, 'warn')
          .mockImplementation(() => logger)

        try {
          const outcomes = await generateRecursiveManifests({
            cwd: outer,
            purlTypes: ['maven'],
            verbose: false,
          })

          const byDir = new Map(
            outcomes.map(o => [path.relative(outer, o.dir) || '.', o.status]),
          )
          expect(byDir.get('sub')).toBe('skippedDisabled')
          expect(byDir.get('sub/a')).toBe('skippedDisabled')
          expect(
            vi
              .mocked(runManifestFacts)
              .mock.calls.map(([o]) => path.relative(outer, o.cwd) || '.'),
          ).toEqual(['.'])
          expect(warnSpy.mock.calls.map(c => String(c[0]))).toEqual([
            expect.stringMatching(
              new RegExp(
                `^Skipping \\S*sub${modules ? ` ${modules}` : ''}: \\S*sub/socket\\.json sets defaults\\.manifest\\.builds\\["settings\\.gradle"\\]\\.disabled\\.$`,
              ),
            ),
          ])
        } finally {
          warnSpy.mockRestore()
        }
      },
    )
  })

  it('configures each POM of a directory through its own builds entry', async () => {
    mockOwnSettings({
      [pomNames]: {
        defaults: {
          manifest: {
            maven: { mavenOpts: '-B' },
            builds: { 'app-dev.pom.xml': { mavenOpts: '-Pdev' } },
          },
        },
      },
    })
    mockFacts(async ({ cwd, entryFile }) => ({
      factsPath: path.join(cwd, `${entryFile}.socket.facts.json`),
      projects: [],
    }))

    await generateRecursiveManifests({ cwd: pomNames, verbose: false })

    const optsByRoot = new Map(
      vi
        .mocked(runManifestFacts)
        .mock.calls.map(([o]) => [
          path.relative(pomNames, path.join(o.cwd, o.entryFile ?? '')),
          o.buildOpts,
        ]),
    )
    expect(optsByRoot.get('app-dev.pom.xml')).toEqual(['-Pdev'])
    expect(optsByRoot.get('pom.xml')).toEqual(['-B'])
  })

  it('warns that a builds entry naming a member of another build does not apply', async () => {
    mockOwnSettings({
      [path.join(reactor, 'moduleA')]: {
        defaults: {
          manifest: { builds: { 'pom.xml': { mavenOpts: '-Pa' } } },
        },
      },
    })
    mockFacts(async ({ cwd, ecosystem }) => ({
      factsPath: path.join(cwd, '.socket.facts.json'),
      projects:
        cwd === reactor && ecosystem === 'maven'
          ? [
              {
                type: 'maven',
                name: 'moduleA',
                id: 'moduleA',
                subprojectDir: 'moduleA',
                manifestFiles: [{ file: 'moduleA/pom.xml' }],
                children: [],
              },
            ]
          : [],
    }))
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => logger)

    try {
      const outcomes = await generateRecursiveManifests({
        cwd: monorepo,
        verbose: false,
      })

      expect(
        outcomes.find(
          o => o.ecosystem === 'maven' && relOf(o.dir) === 'reactor/moduleA',
        )?.status,
      ).toBe('skippedCovered')
      const warned = warnSpy.mock.calls.map(c => String(c[0]))
      expect(
        warned.filter(w => w.includes('defaults.manifest.builds["pom.xml"]')),
      ).toEqual([
        expect.stringMatching(
          /in \S*reactor\/moduleA\/socket\.json does not apply: \S*reactor\/pom\.xml builds \S*reactor\/moduleA\/pom\.xml with its own settings\.$/,
        ),
      ])
    } finally {
      warnSpy.mockRestore()
    }
  })

  describe('with a Maven build skipped by its own entry', () => {
    let outer = ''
    const pom = (rel: string) => path.join(outer, rel, 'pom.xml')

    beforeEach(async () => {
      outer = await fs.realpath(
        await fs.mkdtemp(path.join(tmpdir(), 'skipped-reactor-')),
      )
      for (const rel of ['aaa-module', 'legacy', 'legacy/old', 'legacy/tool']) {
        // eslint-disable-next-line no-await-in-loop
        await fs.mkdir(path.join(outer, rel), { recursive: true })
        // eslint-disable-next-line no-await-in-loop
        await fs.writeFile(pom(rel), '<project/>')
      }
      await fs.writeFile(
        path.join(outer, 'legacy/legacy-keep.pom.xml'),
        '<project/>',
      )
      mockOwnSettings({
        [path.join(outer, 'legacy')]: {
          defaults: {
            manifest: { builds: { 'pom.xml': { disabled: true } } },
          },
        },
      })
      mockFacts(async ({ context, cwd, entryFile }) => ({
        ...(await writeIntoWorkDir(
          context!.workDir!,
          `${cwd}/${entryFile}`,
          path.join(cwd, `${entryFile}.socket.facts.json`),
          'generated',
        )),
        projects: [
          {
            ...mavenProject('.'),
            manifestFiles: [{ file: entryFile ?? 'pom.xml' }],
          },
        ],
      }))
    })
    afterEach(async () => {
      await fs.rm(outer, { recursive: true, force: true })
    })

    it('loads it without resolving, and skips what it loads with it, wherever that is', async () => {
      vi.mocked(listBuildProjects).mockResolvedValue(
        listed(path.join(outer, 'legacy'), [
          mavenProject('.'),
          mavenProject('old'),
          mavenProject('../aaa-module'),
        ]),
      )
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => logger)

      try {
        const outcomes = await generateRecursiveManifests({
          cwd: outer,
          verbose: false,
        })

        const byRoot = new Map(
          outcomes.map(o => [path.relative(outer, buildRootPath(o)), o.status]),
        )
        expect(Object.fromEntries(byRoot)).toEqual({
          'aaa-module/pom.xml': 'skippedDisabled',
          'legacy/legacy-keep.pom.xml': 'generated',
          'legacy/pom.xml': 'skippedDisabled',
          'legacy/old/pom.xml': 'skippedDisabled',
          'legacy/tool/pom.xml': 'generated',
        })
        // aaa-module sorts first, so it ran before legacy was loaded.
        expect(
          existsSync(path.join(outer, 'aaa-module/pom.xml.socket.facts.json')),
        ).toBe(false)
        expect(listBuildProjects).toHaveBeenCalledWith(
          expect.objectContaining({
            cwd: path.join(outer, 'legacy'),
            entryFile: 'pom.xml',
          }),
        )
        expect(warnSpy.mock.calls.map(c => String(c[0]))).toEqual([
          expect.stringMatching(
            /^Skipping \S*legacy\/pom\.xml and its 2 modules: \S*legacy\/socket\.json sets defaults\.manifest\.builds\["pom\.xml"\]\.disabled\.$/,
          ),
        ])
      } finally {
        warnSpy.mockRestore()
      }
    })

    it('loads it with the Coana, org and hints its build would run with', async () => {
      vi.mocked(listBuildProjects).mockResolvedValue(
        listed(path.join(outer, 'legacy'), [mavenProject('.')]),
      )
      const context = { coanaVersion: '1.2.3', orgSlug: 'acme' }
      vi.spyOn(logger, 'warn').mockImplementation(() => logger)

      await generateRecursiveManifests({
        context,
        cwd: outer,
        optionFlags: new Set(['verbose']),
        verbose: false,
      })

      expect(listBuildProjects).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining(context),
          cwd: path.join(outer, 'legacy'),
          entryFile: 'pom.xml',
          hints: {
            continueOnInstallErrorsFlag: undefined,
            excludePathsFlag: '--exclude-paths',
            flags: new Set(['verbose']),
            setupCommand: 'socket manifest setup --dynamic-sbom-inference',
            socketJson: expect.stringMatching(/legacy\/socket\.json$/),
          },
        }),
      )
    })

    it('reports a skipped build that another build includes as part of that build, warning that the skip does not apply', async () => {
      await fs.mkdir(path.join(outer, 'zzz-reactor'), { recursive: true })
      await fs.writeFile(pom('zzz-reactor'), '<project/>')
      vi.mocked(listBuildProjects).mockResolvedValue(
        listed(path.join(outer, 'legacy'), [mavenProject('.')]),
      )
      mockFacts(async ({ cwd, entryFile }) => ({
        factsPath: path.join(cwd, `${entryFile}.socket.facts.json`),
        projects:
          cwd === path.join(outer, 'zzz-reactor')
            ? [mavenProject('.'), mavenProject('../legacy')]
            : [
                {
                  ...mavenProject('.'),
                  manifestFiles: [{ file: entryFile ?? 'pom.xml' }],
                },
              ],
      }))
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => logger)

      try {
        const outcomes = await generateRecursiveManifests({
          cwd: outer,
          verbose: false,
        })

        expect(
          outcomes.find(
            o =>
              o.dir === path.join(outer, 'legacy') && o.entryFile === 'pom.xml',
          )?.status,
        ).toBe('skippedCovered')
        const warned = warnSpy.mock.calls.map(c => String(c[0]))
        expect(warned.some(w => w.startsWith('Skipping'))).toBe(false)
        expect(warned).toContainEqual(
          expect.stringMatching(
            /does not apply: \S*zzz-reactor\/pom\.xml builds \S*legacy\/pom\.xml/,
          ),
        )
      } finally {
        warnSpy.mockRestore()
      }
    })

    it('fails, without building what lies beneath it, when it cannot be loaded', async () => {
      vi.mocked(listBuildProjects).mockImplementation(async () => {
        process.exitCode = 1
        return undefined
      })
      const failSpy = vi.spyOn(logger, 'fail').mockImplementation(() => logger)
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => logger)

      try {
        const outcomes = await generateRecursiveManifests({
          cwd: outer,
          verbose: false,
        })

        const byRoot = new Map(
          outcomes.map(o => [path.relative(outer, buildRootPath(o)), o.status]),
        )
        expect(byRoot.get('legacy/pom.xml')).toBe('failed')
        expect(byRoot.get('legacy/old/pom.xml')).toBe('aborted')
        expect(byRoot.get('aaa-module/pom.xml')).toBe('generated')
        expect(String(failSpy.mock.calls.at(-1)?.[0])).toMatch(
          /^Could not load \S*legacy\/pom\.xml .* with `socket manifest setup --dynamic-sbom-inference`\.$/,
        )
        expect(process.exitCode).toBe(1)
      } finally {
        failSpy.mockRestore()
        warnSpy.mockRestore()
      }
    })
  })

  it('reports a build a kept build covers as part of it, even when a skipped build loads it too or its own entry skips it', async () => {
    const outer = await fs.realpath(
      await fs.mkdtemp(path.join(tmpdir(), 'covered-solution-')),
    )
    const at = (rel: string) => path.join(outer, rel)
    const projectRecord = (file: string) => ({
      type: 'nuget' as const,
      name: file,
      id: file,
      subprojectDir: path.dirname(file),
      manifestFiles: [{ file }],
      children: [],
    })
    const members: Record<string, string[]> = {
      'App.sln': [at('p/a/A.csproj')],
      'R.sln': [at('p/a/A.csproj'), at('p/c/C.csproj')],
      'Skip.sln': [at('p/a/A.csproj'), at('gone/Gone.csproj')],
      'Y.sln': [at('p/a/A.csproj')],
    }
    try {
      for (const rel of [
        'p/a/A.csproj',
        'p/c/C.csproj',
        'r/R.sln',
        'skip/Skip.sln',
        'y/Y.sln',
        'z/App.sln',
      ]) {
        // eslint-disable-next-line no-await-in-loop
        await fs.mkdir(path.dirname(at(rel)), { recursive: true })
        // eslint-disable-next-line no-await-in-loop
        await fs.writeFile(at(rel), '')
      }
      mockOwnSettings({
        [at('skip')]: {
          defaults: {
            manifest: { builds: { 'Skip.sln': { disabled: true } } },
          },
        },
        [at('y')]: {
          defaults: { manifest: { builds: { 'Y.sln': { disabled: true } } } },
        },
      })
      vi.mocked(listDotnetSolutionMembers).mockImplementation(
        async ({ entryFile }) => members[entryFile ?? ''],
      )
      vi.mocked(listBuildProjects).mockResolvedValue(
        listed(at('skip'), [projectRecord('../p/a/A.csproj')]),
      )
      mockFacts(async ({ cwd, entryFile }) => ({
        factsPath: path.join(cwd, `${entryFile}.socket.facts.json`),
        projects:
          entryFile === 'R.sln'
            ? [
                projectRecord('../p/a/A.csproj'),
                projectRecord('../p/c/C.csproj'),
              ]
            : [projectRecord(entryFile ?? '')],
      }))
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => logger)

      const outcomes = await generateRecursiveManifests({
        cwd: outer,
        purlTypes: ['nuget'],
        verbose: false,
      })

      expect(
        Object.fromEntries(
          outcomes.map(o => [path.relative(outer, buildRootPath(o)), o.status]),
        ),
      ).toEqual({
        'p/a/A.csproj': 'skippedCovered',
        'p/c/C.csproj': 'skippedCovered',
        'r/R.sln': 'generated',
        'skip/Skip.sln': 'skippedDisabled',
        'y/Y.sln': 'skippedCovered',
        'z/App.sln': 'skippedCovered',
      })
      expect(warnSpy.mock.calls.map(c => String(c[0]))).toContainEqual(
        expect.stringMatching(
          /^defaults\.manifest\.builds\["Y\.sln"\] in \S*y\/socket\.json does not apply: \S*r\/R\.sln builds \S*y\/Y\.sln with its own settings\.$/,
        ),
      )
    } finally {
      vi.mocked(listDotnetSolutionMembers).mockImplementation(
        async () => undefined,
      )
      await fs.rm(outer, { recursive: true, force: true })
    }
  })
})
