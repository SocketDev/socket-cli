import { existsSync, promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./discover-manifest-roots.mts', async importOriginal => {
  const actual =
    await importOriginal<typeof import('./discover-manifest-roots.mts')>()
  return {
    ...actual,
    findBuildToolCandidates: vi.fn(actual.findBuildToolCandidates),
  }
})
vi.mock('./run-manifest-facts.mts', async importOriginal => ({
  ...(await importOriginal<typeof import('./run-manifest-facts.mts')>()),
  listBuildProjects: vi.fn(),
}))
vi.mock('@socketsecurity/registry/lib/prompts', () => ({
  input: vi.fn(),
  select: vi.fn(),
}))
vi.mock('./setup-manifest-config.mts', () => ({
  setupDotnet: vi.fn(),
  setupGradle: vi.fn(),
  setupMaven: vi.fn(),
  setupSbt: vi.fn(),
}))

import { logger } from '@socketsecurity/registry/lib/logger'
import { input, select } from '@socketsecurity/registry/lib/prompts'

import { findBuildToolCandidates } from './discover-manifest-roots.mts'
import { listBuildProjects } from './run-manifest-facts.mts'
import { setupMaven } from './setup-manifest-config.mts'
import {
  discoverBuildRoots,
  scanBuildRoots,
  setupRecursiveManifestConfig,
} from './setup-recursive-manifest-config.mts'

import type { BuildRoot } from './discover-manifest-roots.mts'
import type { SocketFactsProject } from './run-manifest-facts.mts'
import type { SocketJson } from '../../utils/socket-json.mts'

function dirRoots(...dirs: string[]): BuildRoot[] {
  return dirs.map(dir => ({ dir }))
}

function mavenRoots(...dirs: string[]): BuildRoot[] {
  return dirs.map(dir => ({ dir, entryFile: 'pom.xml' }))
}

// A Maven project of the build at `buildRoot`, loaded from `pomFile`.
function project(
  buildRoot: string,
  subprojectDir: string,
  pomFile = 'pom.xml',
): SocketFactsProject {
  const dir = path.resolve(buildRoot, subprojectDir)
  return { buildFiles: [path.join(dir, pomFile)], dir }
}

describe('scanBuildRoots', () => {
  it('runs the unfiltered and excludePaths-filtered walks once each and returns both', async () => {
    const unfiltered = new Map([
      ['gradle', dirRoots('/repo/a', '/repo/legacy')],
    ])
    const filtered = new Map([['gradle', dirRoots('/repo/a')]])
    const walk = async ({
      excludePaths,
    }: {
      excludePaths?: string[] | undefined
    }) => (excludePaths?.length ? filtered : unfiltered)
    vi.mocked(findBuildToolCandidates)
      .mockImplementationOnce(walk)
      .mockImplementationOnce(walk)

    const result = await scanBuildRoots({
      cwd: '/repo',
      excludePaths: ['legacy'],
      sockJson: { version: 1 } as SocketJson,
    })

    expect(result).toEqual({ fullByTool: unfiltered, includedByTool: filtered })
  })
})

describe('discoverBuildRoots', () => {
  const cwd = '/repo'

  it('leaves out cwd itself', async () => {
    const result = await discoverBuildRoots({
      cwd,
      fullByTool: new Map([['gradle', dirRoots(cwd)]]),
      includedByTool: new Map([['gradle', dirRoots(cwd)]]),
    })

    expect(result).toEqual({ excluded: [], excludedBuilds: [], included: [] })
  })

  it('groups the builds --exclude-paths excludes under the shallowest excluded directory', async () => {
    const result = await discoverBuildRoots({
      cwd,
      excludePaths: ['legacy'],
      fullByTool: new Map([
        ['maven', mavenRoots('/repo/legacy/a', '/repo/active')],
        ['gradle', dirRoots('/repo/legacy/b')],
      ]),
      includedByTool: new Map([
        ['maven', mavenRoots('/repo/active')],
        ['gradle', dirRoots()],
      ]),
    })

    expect(result).toEqual({
      excluded: [{ dir: '/repo/legacy', ecosystems: ['gradle', 'maven'] }],
      excludedBuilds: [],
      included: [
        {
          dir: '/repo/active',
          ecosystem: 'maven',
          roots: mavenRoots('/repo/active'),
        },
      ],
    })
  })

  it('excludes one POM by itself while a sibling POM there stays included', async () => {
    const service = '/repo/service'
    const result = await discoverBuildRoots({
      cwd,
      excludePaths: ['service/app-dev.pom.xml'],
      fullByTool: new Map([
        [
          'maven',
          [
            { dir: service, entryFile: 'app-dev.pom.xml' },
            { dir: service, entryFile: 'pom.xml' },
          ],
        ],
      ]),
      includedByTool: new Map([['maven', mavenRoots(service)]]),
    })

    expect(result).toEqual({
      excluded: [],
      excludedBuilds: [
        {
          ecosystem: 'maven',
          root: { dir: service, entryFile: 'app-dev.pom.xml' },
        },
      ],
      included: [
        { dir: service, ecosystem: 'maven', roots: mavenRoots(service) },
      ],
    })
  })
})

// Each prompt is answered by the first rule its message starts with; any
// other prompt fails the test.
type Answers = Array<[string, unknown]>

type Choice = { description?: string; name: string; value: string }

describe('setupRecursiveManifestConfig', () => {
  let repo = ''
  let asked: string[] = []
  let choicesOf = new Map<string, Choice[]>()

  const file = (rel: string) => path.join(repo, rel)
  const readSettings = async (rel: string) =>
    JSON.parse(
      await fs.readFile(file(path.join(rel, 'socket.json')), 'utf8'),
    ) as SocketJson
  const writeSettings = async (rel: string, manifest: unknown) =>
    await fs.writeFile(
      file(path.join(rel, 'socket.json')),
      JSON.stringify({ version: 1, defaults: { manifest } }),
    )
  // Each build loads its own POM and the modules listed for it; a build
  // listed as undefined can't be loaded.
  const loads = (modules: Record<string, string[] | undefined>) =>
    vi
      .mocked(listBuildProjects)
      .mockImplementation(async ({ cwd, entryFile }) => {
        const rel = path.relative(repo, path.join(cwd, entryFile ?? ''))
        if (rel in modules && !modules[rel]) {
          return undefined
        }
        return [
          project(cwd, '.', entryFile),
          ...(modules[rel] ?? []).map(dir => project(cwd, dir)),
        ]
      })
  const answer = (answers: Answers) =>
    vi.mocked(select).mockImplementation(async ({ choices, message }) => {
      asked.push(message)
      choicesOf.set(message, choices as Choice[])
      const rule = answers.find(({ 0: start }) => message.startsWith(start))
      if (!rule) {
        throw new Error(`Unexpected prompt: ${message}`)
      }
      return rule[1] as never
    })

  beforeEach(async () => {
    repo = await fs.realpath(
      await fs.mkdtemp(path.join(tmpdir(), 'setup-recursive-')),
    )
    asked = []
    choicesOf = new Map()
    for (const rel of [
      'pom.xml',
      'api/pom.xml',
      'legacy/pom.xml',
      'legacy/old/pom.xml',
      'legacy/tool/pom.xml',
    ]) {
      // eslint-disable-next-line no-await-in-loop
      await fs.mkdir(path.dirname(file(rel)), { recursive: true })
      // eslint-disable-next-line no-await-in-loop
      await fs.writeFile(file(rel), '<project/>')
    }
    vi.mocked(listBuildProjects).mockReset()
    vi.mocked(setupMaven).mockReset()
    vi.spyOn(logger, 'log').mockImplementation(() => logger)
    vi.spyOn(logger, 'info').mockImplementation(() => logger)
    vi.spyOn(logger, 'success').mockImplementation(() => logger)
    vi.spyOn(logger, 'fail').mockImplementation(() => logger)
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await fs.rm(repo, { recursive: true, force: true })
  })

  it('asks only about builds no other build includes, and writes nothing when nothing changes', async () => {
    loads({ 'pom.xml': ['api'], 'legacy/pom.xml': ['old'] })
    answer([
      ['This project (maven)', 'inherit'],
      ['Review the', true],
      ['legacy (maven)', 'inherit'],
      ['legacy/tool (maven)', 'inherit'],
    ])

    const result = await setupRecursiveManifestConfig(repo, false)

    expect(result).toEqual({ ok: true, data: { canceled: false } })
    expect(asked).toEqual([
      'This project (maven)',
      'Review the 4 other builds found beneath this one?',
      'legacy (maven)',
      'legacy/tool (maven)',
    ])
    expect(existsSync(file('socket.json'))).toBe(false)
  })

  it('skips a build it can load with exactly what it loads, and keeps asking about the separate builds beneath it', async () => {
    loads({ 'pom.xml': ['api'], 'legacy/pom.xml': ['old'] })
    answer([
      ['This project (maven)', 'inherit'],
      ['Review the', true],
      ['legacy (maven)', 'skip'],
      ['legacy/tool (maven)', 'inherit'],
      ['Write it?', true],
    ])

    await setupRecursiveManifestConfig(repo, false)

    expect(asked).toContain('legacy/tool (maven)')
    expect(asked.some(message => message.startsWith('legacy/old'))).toBe(false)
    expect(await readSettings('legacy')).toMatchObject({
      defaults: { manifest: { builds: { 'pom.xml': { disabled: true } } } },
    })
    expect(vi.mocked(logger.success).mock.calls.map(c => c[0])).toContain(
      'Skipped legacy/pom.xml and its 1 module.',
    )
  })

  it('offers to fix a build it cannot load first, and otherwise skips its directory and everything beneath it', async () => {
    loads({ 'pom.xml': ['api'], 'legacy/pom.xml': undefined })
    answer([
      ['This project (maven)', 'inherit'],
      ['Review the', true],
      ['legacy (maven)', 'skip'],
      ['Socket could not load legacy (maven)', 'directory'],
      ['Write it?', true],
    ])

    await setupRecursiveManifestConfig(repo, false)

    const message = asked.find(m =>
      m.startsWith('Socket could not load legacy (maven)'),
    )!
    expect(message).toContain(
      'Builds Socket can load are built once with all their modules',
    )
    const choices = choicesOf.get(message)!
    expect(choices.map(choice => choice.value)).toEqual([
      'configure',
      'directory',
      'stop',
    ])
    expect(choices[1]!.name).toBe(
      'Skip legacy/ and everything beneath it, without loading it',
    )
    expect(choices[1]!.description).toBe(
      "Also skips the 2 other builds in and beneath legacy/. To build one of them, run `socket manifest setup --dynamic-sbom-inference` in its directory. Modules of legacy/pom.xml outside legacy/ can't be found without loading it, so they are asked about separately.",
    )
    expect(asked.some(m => m.startsWith('legacy/tool'))).toBe(false)
    expect(await readSettings('legacy')).toMatchObject({
      defaults: { manifest: { maven: { disabled: true } } },
    })
  })

  it('loads a build again after configuring it, and skips it once it loads', async () => {
    let attempts = 0
    vi.mocked(listBuildProjects).mockImplementation(async ({ cwd }) => {
      if (cwd === file('legacy') && (attempts += 1) === 1) {
        return undefined
      }
      return [project(cwd, '.')]
    })
    vi.mocked(setupMaven).mockImplementation(async config => {
      config.javaHome = '/opt/jdk-8'
      return { ok: true, data: { canceled: false } }
    })
    answer([
      ['This project (maven)', 'inherit'],
      ['Review the', true],
      ['legacy (maven)', 'skip'],
      ['Socket could not load legacy (maven)', 'configure'],
      ['legacy/old (maven)', 'inherit'],
      ['legacy/tool (maven)', 'inherit'],
      ['api (maven)', 'inherit'],
      ['Write it?', true],
    ])

    await setupRecursiveManifestConfig(repo, false)

    expect(attempts).toBe(2)
    // A listing's remedies point at this wizard, not at flags.
    expect(
      vi
        .mocked(listBuildProjects)
        .mock.calls.map(([{ hints }]) => [hints?.setupCommand, hints?.flags]),
    ).toEqual(
      vi
        .mocked(listBuildProjects)
        .mock.calls.map(() => [
          'socket manifest setup --dynamic-sbom-inference',
          new Set(),
        ]),
    )
    expect(await readSettings('legacy')).toMatchObject({
      defaults: {
        manifest: {
          builds: { 'pom.xml': { disabled: true } },
          maven: { javaHome: '/opt/jdk-8' },
        },
      },
    })
  })

  it('asks about each build file of a directory, and keeps settings for one under its name', async () => {
    await fs.writeFile(file('legacy/legacy-cli.pom.xml'), '<project/>')
    loads({ 'pom.xml': ['api'], 'legacy/pom.xml': ['old'] })
    vi.mocked(setupMaven).mockImplementation(async config => {
      config.mavenOpts = '-Pcli'
      return { ok: true, data: { canceled: false } }
    })
    answer([
      ['This project (maven)', 'inherit'],
      ['Review the', true],
      ['legacy/legacy-cli.pom.xml (maven)', 'configure'],
      ['legacy/pom.xml (maven)', 'skip'],
      ['legacy/tool (maven)', 'inherit'],
      ['Write it?', true],
    ])

    await setupRecursiveManifestConfig(repo, false)

    expect(await readSettings('legacy')).toMatchObject({
      defaults: {
        manifest: {
          builds: {
            'legacy-cli.pom.xml': { mavenOpts: '-Pcli' },
            'pom.xml': { disabled: true },
          },
        },
      },
    })
  })

  it('offers a build skipped under its own name back, and drops the skip when taken', async () => {
    await writeSettings('legacy', {
      builds: { 'pom.xml': { disabled: true } },
    })
    loads({ 'pom.xml': ['api'], 'legacy/pom.xml': ['old'] })
    answer([
      ['This project (maven)', 'inherit'],
      ['Review the', true],
      ['legacy (maven) is skipped. Build it again?', true],
      ['legacy (maven)', 'inherit'],
      ['legacy/tool (maven)', 'inherit'],
      ['Write it?', true],
    ])

    await setupRecursiveManifestConfig(repo, false)

    expect(
      (await readSettings('legacy')).defaults?.manifest?.builds?.['pom.xml'],
    ).toEqual({})
  })

  it('run beneath a skipped directory, offers to build the projects there again', async () => {
    await writeSettings('legacy', { maven: { disabled: true } })
    loads({ 'legacy/tool/pom.xml': [] })
    answer([
      ['This project (maven)', 'inherit'],
      ['', true],
    ])

    await setupRecursiveManifestConfig(file('legacy/tool'), false)

    expect(asked[0]).toMatch(
      /^\S*legacy\/socket\.json skips Maven builds in and beneath \S*legacy, including this directory\. Build the Maven projects here\?$/,
    )
    expect(await readSettings('legacy/tool')).toMatchObject({
      defaults: { manifest: { maven: { disabled: false } } },
    })
  })

  it('asks about the build here like any other, offering its own skip back after the defaults', async () => {
    await writeSettings('.', { builds: { 'pom.xml': { disabled: true } } })
    loads({ 'pom.xml': ['api'], 'legacy/pom.xml': ['old'] })
    answer([
      ['Configure Maven defaults', false],
      ['This project (maven) is skipped. Build it again?', true],
      ['This project (maven)', 'inherit'],
      ['Review the', false],
      ['Write it?', true],
    ])

    await setupRecursiveManifestConfig(repo, false)

    // Its own entry would override defaults set through its prompt.
    expect(asked).toEqual([
      'Configure Maven defaults for the projects here and beneath?',
      'This project (maven) is skipped. Build it again?',
      'This project (maven)',
      'Review the 4 other builds found beneath this one?',
      'Write it?',
    ])
    expect(
      (await readSettings('.')).defaults?.manifest?.builds?.['pom.xml'],
    ).toEqual({})
  })

  it('asks about each build file here, after the defaults they share', async () => {
    await fs.writeFile(file('app-alt.pom.xml'), '<project/>')
    loads({ 'pom.xml': ['api'], 'legacy/pom.xml': ['old'] })
    answer([
      ['Configure Maven defaults for the projects here and beneath?', false],
      ['app-alt.pom.xml (maven)', 'skip'],
      ['pom.xml (maven)', 'inherit'],
      ['Review the', false],
      ['Write it?', true],
    ])

    await setupRecursiveManifestConfig(repo, false)

    expect(asked.slice(0, 3)).toEqual([
      'Configure Maven defaults for the projects here and beneath?',
      'app-alt.pom.xml (maven)',
      'pom.xml (maven)',
    ])
    expect((await readSettings('.')).defaults?.manifest?.builds).toEqual({
      'app-alt.pom.xml': { disabled: true },
    })
  })

  it("writes a Gradle build's choice under the build file its entry already names", async () => {
    await fs.mkdir(file('app'))
    await fs.writeFile(file('app/build.gradle'), '')
    await fs.writeFile(file('app/settings.gradle'), '')
    await writeSettings('app', {
      builds: { 'settings.gradle': { disabled: false } },
    })
    loads({ 'pom.xml': ['api'], 'legacy/pom.xml': ['old'] })
    answer([
      ['Configure Gradle defaults', false],
      ['This project (maven)', 'inherit'],
      ['Review the', true],
      ['app (gradle)', 'skip'],
      ['legacy (maven)', 'inherit'],
      ['legacy/tool (maven)', 'inherit'],
      ['Write it?', true],
    ])

    await setupRecursiveManifestConfig(repo, false)

    expect((await readSettings('app')).defaults?.manifest?.builds).toEqual({
      'settings.gradle': { disabled: true },
    })
  })

  it('drops an override for an answer the user leaves to its default', async () => {
    await writeSettings('legacy', {
      maven: { ignoreUnresolved: true, javaHome: '/opt/jdk-17', verbose: true },
    })
    loads({ 'pom.xml': ['api'], 'legacy/pom.xml': ['old'] })
    vi.mocked(setupMaven).mockImplementation(async config => {
      delete config.ignoreUnresolved
      delete config.verbose
      return { ok: true, data: { canceled: false } }
    })
    answer([
      ['This project (maven)', 'inherit'],
      ['Review the', true],
      ['legacy (maven)', 'configure'],
      ['legacy/tool (maven)', 'inherit'],
      ['Write it?', true],
    ])

    await setupRecursiveManifestConfig(repo, false)

    expect((await readSettings('legacy')).defaults?.manifest?.maven).toEqual({
      javaHome: '/opt/jdk-17',
    })
  })

  it('drops an override the user sets back to the inherited value', async () => {
    await writeSettings('.', { maven: { javaHome: '/opt/jdk-17' } })
    await writeSettings('legacy', { maven: { javaHome: '/opt/jdk-8' } })
    loads({ 'pom.xml': ['api'], 'legacy/pom.xml': ['old'] })
    vi.mocked(setupMaven).mockImplementation(async config => {
      config.javaHome = '/opt/jdk-17'
      return { ok: true, data: { canceled: false } }
    })
    answer([
      ['This project (maven)', 'inherit'],
      ['Review the', true],
      ['legacy (maven)', 'configure'],
      ['legacy/tool (maven)', 'inherit'],
      ['Write it?', true],
    ])

    await setupRecursiveManifestConfig(repo, false)

    expect((await readSettings('legacy')).defaults?.manifest?.maven).toEqual({})
  })

  it('writes an inherited reachability setting only where it differs, field by field', async () => {
    await writeSettings('.', {
      maven: { reachability: { javaHome: '/opt/jdk-17' } },
    })
    loads({ 'pom.xml': ['api'], 'legacy/pom.xml': ['old'] })
    vi.mocked(setupMaven).mockResolvedValue({
      ok: true,
      data: { canceled: false },
    })
    const answers: Answers = [
      ['This project (maven)', 'inherit'],
      ['Review the', true],
      ['legacy (maven)', 'configure'],
      ['legacy/tool (maven)', 'inherit'],
      ['Write it?', true],
    ]
    answer(answers)

    await setupRecursiveManifestConfig(repo, false)
    expect(existsSync(file('legacy/socket.json'))).toBe(false)

    vi.mocked(setupMaven).mockImplementation(async config => {
      config.reachability = { javaHome: null }
      return { ok: true, data: { canceled: false } }
    })
    answer(answers)

    await setupRecursiveManifestConfig(repo, false)
    expect((await readSettings('legacy')).defaults?.manifest?.maven).toEqual({
      reachability: { javaHome: null },
    })
  })

  it('seeds reachability with both the inherited and the own fields', async () => {
    await writeSettings('.', {
      maven: { reachability: { javaHome: '/opt/jdk-17' } },
    })
    await writeSettings('legacy', { maven: { reachability: { other: 'x' } } })
    loads({ 'pom.xml': ['api'], 'legacy/pom.xml': ['old'] })
    let seeded: unknown
    vi.mocked(setupMaven).mockImplementation(async config => {
      seeded = structuredClone(config)
      return { ok: true, data: { canceled: false } }
    })
    answer([
      ['This project (maven)', 'inherit'],
      ['Review the', true],
      ['legacy (maven)', 'configure'],
      ['legacy/tool (maven)', 'inherit'],
    ])

    await setupRecursiveManifestConfig(repo, false)

    expect(seeded).toEqual({
      reachability: { javaHome: '/opt/jdk-17', other: 'x' },
    })
    expect((await readSettings('legacy')).defaults?.manifest?.maven).toEqual({
      reachability: { other: 'x' },
    })
  })

  it('loads and configures a build whose socket.json sets an invalid reachability value, replacing it', async () => {
    const actual = await vi.importActual<
      typeof import('./setup-manifest-config.mts')
    >('./setup-manifest-config.mts')
    vi.mocked(setupMaven).mockImplementation(actual.setupMaven)
    vi.mocked(input).mockImplementation(async ({ default: def }) => def ?? '')
    vi.spyOn(logger, 'warn').mockImplementation(() => logger)
    await writeSettings('legacy', {
      maven: {
        mavenOpts: '-B',
        reachability: { build: 'always', javaHome: 17 },
      },
    })
    loads({ 'pom.xml': ['api'], 'legacy/pom.xml': ['old'] })
    const rules: Answers = [
      ['This project (maven)', 'inherit'],
      ['Review the', true],
      ['legacy (maven)', 'configure'],
      ['legacy/tool (maven)', 'inherit'],
      ['Write it?', true],
    ]
    vi.mocked(select).mockImplementation(async ({ default: def, message }) => {
      const rule = rules.find(({ 0: start }) => message.startsWith(start))
      return (rule ? rule[1] : (def ?? '')) as never
    })

    expect(await setupRecursiveManifestConfig(repo, false)).toEqual({
      ok: true,
      data: { canceled: false },
    })

    expect((await readSettings('legacy')).defaults?.manifest?.maven).toEqual({
      mavenOpts: '-B',
    })
  })

  describe('after a no to building before reachability analysis', () => {
    const BUILD_QUESTION =
      'Build project before reachability analysis? Note: A failed build fails the scan.'

    // Runs the real Maven wizard for legacy under a parent with `parentBuild`,
    // answering no to the build question and the defaults elsewhere.
    async function configureUnder(
      parentBuild: 'compile' | 'none' | undefined,
    ): Promise<void> {
      const actual = await vi.importActual<
        typeof import('./setup-manifest-config.mts')
      >('./setup-manifest-config.mts')
      vi.mocked(setupMaven).mockImplementation(actual.setupMaven)
      vi.mocked(input).mockImplementation(async ({ default: def }) => def ?? '')
      await writeSettings(
        '.',
        parentBuild ? { maven: { reachability: { build: parentBuild } } } : {},
      )
      loads({ 'pom.xml': ['api'], 'legacy/pom.xml': ['old'] })
      const rules: Answers = [
        ['This project (maven)', 'inherit'],
        ['Review the', true],
        ['legacy (maven)', 'configure'],
        ['legacy/tool (maven)', 'inherit'],
        ['Write it?', true],
      ]
      vi.mocked(select).mockImplementation(
        async ({ default: def, message }) => {
          asked.push(message)
          if (message === BUILD_QUESTION) {
            return false as never
          }
          const rule = rules.find(({ 0: start }) => message.startsWith(start))
          return (rule ? rule[1] : (def ?? '')) as never
        },
      )

      const result = await setupRecursiveManifestConfig(repo, false)
      expect(result).toEqual({ ok: true, data: { canceled: false } })
      expect(asked).toContain(BUILD_QUESTION)
    }

    it('writes none under a parent that sets compile', async () => {
      await configureUnder('compile')

      expect((await readSettings('legacy')).defaults?.manifest?.maven).toEqual({
        reachability: { build: 'none' },
      })
    })

    it.for(['none', undefined] as const)(
      'leaves the build unset under a parent whose build is %s',
      async parentBuild => {
        await configureUnder(parentBuild)

        expect(existsSync(file('legacy/socket.json'))).toBe(false)
      },
    )
  })

  it('loads a build left skipped under its own name, so its modules are not asked about', async () => {
    await writeSettings('legacy', {
      builds: { 'pom.xml': { disabled: true } },
    })
    loads({ 'pom.xml': ['api'], 'legacy/pom.xml': ['old'] })
    answer([
      ['This project (maven)', 'inherit'],
      ['Review the', true],
      ['legacy (maven) is skipped. Build it again?', false],
      ['legacy/tool (maven)', 'inherit'],
    ])

    await setupRecursiveManifestConfig(repo, false)

    expect(asked.some(m => m.startsWith('legacy/old'))).toBe(false)
  })

  it('writes nothing when the user declines the changes', async () => {
    loads({ 'pom.xml': ['api'], 'legacy/pom.xml': ['old'] })
    answer([
      ['This project (maven)', 'inherit'],
      ['Review the', true],
      ['legacy (maven)', 'skip'],
      ['legacy/tool (maven)', 'inherit'],
      ['Write it?', false],
    ])

    await setupRecursiveManifestConfig(repo, false)

    expect(existsSync(file('legacy/socket.json'))).toBe(false)
  })

  it('skips what --exclude-paths excludes without asking about it', async () => {
    loads({ 'pom.xml': ['api'] })
    answer([
      ['This project (maven)', 'inherit'],
      ['Review the', true],
      ['Write it?', true],
    ])

    await setupRecursiveManifestConfig(repo, false, ['legacy'])

    expect(asked).toEqual([
      'This project (maven)',
      'Review the other build found beneath this one?',
      'Write it?',
    ])
    expect(await readSettings('legacy')).toMatchObject({
      defaults: { manifest: { maven: { disabled: true } } },
    })
  })

  it('stops, writing nothing, when the user cancels a prompt', async () => {
    loads({ 'pom.xml': ['api'], 'legacy/pom.xml': ['old'] })
    answer([
      ['This project (maven)', 'inherit'],
      ['Review the', true],
      ['legacy (maven)', null],
    ])

    const result = await setupRecursiveManifestConfig(repo, false)

    expect(result).toEqual({ ok: true, data: { canceled: true } })
    expect(existsSync(file('legacy/socket.json'))).toBe(false)
  })

  it('fails when no build is found at all', async () => {
    const empty = await fs.realpath(
      await fs.mkdtemp(path.join(tmpdir(), 'setup-recursive-empty-')),
    )
    try {
      const result = await setupRecursiveManifestConfig(empty, false)
      expect(result).toMatchObject({ ok: false, code: 1 })
    } finally {
      await fs.rm(empty, { recursive: true, force: true })
    }
  })
})
