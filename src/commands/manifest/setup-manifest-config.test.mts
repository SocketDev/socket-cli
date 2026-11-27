import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Simulates a real prompt: pressing Enter with nothing typed returns
// whatever `default` was shown - the same contract inquirer honors. This is
// exactly the behavior that made `askForBin` freeze a hardcoded tool
// fallback (e.g. 'mvn') into socket.json when the user never typed anything.
vi.mock('../../utils/prompts.mts', () => ({
  input: vi.fn(async ({ default: def }: { default?: string }) => def ?? ''),
  select: vi.fn(async ({ default: def }: { default?: string }) => def ?? ''),
}))

import { cascadedReachability } from './build-root-config.mts'
import {
  setupDotnet,
  setupGradle,
  setupManifestConfig,
  setupMaven,
  setupSbt,
} from './setup-manifest-config.mts'
import {
  BUILD_QUESTION,
  ECOSYSTEM_QUESTION,
  JDK_PROMPT,
  JDK_QUESTION,
  RUNTIME_PROMPT,
  RUNTIME_QUESTION,
  WRITE_QUESTION,
  answerPrompts,
} from '../../../test/setup-prompts.mts'
import { logger } from '../../utils/logger.mts'
import { input, select } from '../../utils/prompts.mts'
import {
  getDefaultSocketJson,
  readSocketJsonChain,
  writeSocketJson,
} from '../../utils/socket-json.mts'

afterEach(() => {
  vi.restoreAllMocks()
  answerPrompts()
  vi.mocked(input).mockClear()
  vi.mocked(select).mockClear()
})

describe('setup wizards', () => {
  it.for([
    ['dotnet', setupDotnet],
    ['gradle', setupGradle],
    ['maven', setupMaven],
    ['sbt', setupSbt],
  ] as const)(
    '%s leaves a fresh config empty when every prompt is left blank, instead of freezing the hardcoded bin fallback',
    async ({ 1: setup }) => {
      const config: Record<string, unknown> = {}

      const result = await setup(config)

      expect(result).toEqual({ ok: true, data: { canceled: false } })
      expect(config).toEqual({})
    },
  )
})

describe('setupGradle/setupMaven/setupSbt', () => {
  it('still shows and accepts a prior explicit bin value unchanged', async () => {
    const config: Record<string, unknown> = { bin: './custom-gradlew' }

    await setupGradle(config)

    expect(config['bin']).toBe('./custom-gradlew')
  })

  it('preserves an explicit null (already-cleared) field on a blank re-prompt, instead of deleting it back into inheriting', async () => {
    const config: Record<string, unknown> = {
      bin: null,
      gradleOpts: null,
      javaHome: null,
    }

    await setupGradle(config)

    expect(config['bin']).toBeNull()
    expect(config['javaHome']).toBeNull()
    expect(config['gradleOpts']).toBeNull()
  })

  it('asks the facts/pom question by default', async () => {
    const { messages } = answerPrompts()

    await setupGradle({})
    await setupSbt({})

    expect(messages.some(m => m.includes('--facts / --pom'))).toBe(true)
  })

  it('skips the facts/pom question entirely when factsOnly is set, going straight to facts-only options', async () => {
    const { messages } = answerPrompts()

    await setupGradle({}, { factsOnly: true })
    await setupSbt({}, { factsOnly: true })

    expect(messages.some(m => m.includes('--facts / --pom'))).toBe(false)
    // The facts-only options (config filters) still ask, just without the
    // facts/pom choice gating them.
    expect(messages.some(m => m.includes('--ignore-unresolved'))).toBe(true)
  })
})

describe('reachability step', () => {
  it.for([
    ['gradle', setupGradle],
    ['maven', setupMaven],
    ['sbt', setupSbt],
  ] as const)(
    '%s writes the JDK named after a yes to reachability.javaHome',
    async ({ 1: setup }) => {
      answerPrompts({ [JDK_PROMPT]: '$JAVA17_HOME', [JDK_QUESTION]: true })
      const config: Record<string, unknown> = { javaHome: '/opt/jdk-11' }

      const result = await setup(config)

      expect(result).toEqual({ ok: true, data: { canceled: false } })
      expect(config).toEqual({
        javaHome: '/opt/jdk-11',
        reachability: { javaHome: '$JAVA17_HOME' },
      })
    },
  )

  it('writes nothing on a no and never asks for the JDK', async () => {
    const { asked } = answerPrompts({
      [JDK_PROMPT]: '/never-asked',
      [JDK_QUESTION]: false,
    })
    const config: Record<string, unknown> = {}

    await setupMaven(config)

    expect(config).toEqual({})
    expect(asked[JDK_PROMPT]).toBeUndefined()
  })

  it('leaves a value it shows as is on a no, neither clearing nor restating it', async () => {
    answerPrompts({ [JDK_QUESTION]: false })
    const config: Record<string, unknown> = {
      reachability: { javaHome: '/opt/jdk-17' },
    }

    await setupMaven(config)

    expect(config['reachability']).toEqual({ javaHome: '/opt/jdk-17' })
  })

  it.for([
    [
      { javaHome: '/opt/jdk-17' },
      {},
      'Keep /opt/jdk-17 as the JDK for reachability analysis',
    ],
    [{}, {}, 'Leave the JDK for reachability analysis unset'],
    [
      { javaHome: '/opt/jdk-17' },
      { javaHome: '/opt/jdk-17' },
      'Keep /opt/jdk-17 as the JDK for reachability analysis',
    ],
    [
      {},
      { javaHome: '/opt/jdk-11' },
      'Keep /opt/jdk-11 as the JDK for reachability analysis, as a parent socket.json sets it',
    ],
    [
      { javaHome: null },
      { javaHome: '/opt/jdk-11' },
      'Leave the JDK for reachability analysis unset',
    ],
  ] as const)(
    'labels the no to the JDK %j, inheriting %j, by what it does',
    async ({ 0: reachability, 1: inherited, 2: label }) => {
      const { asked } = answerPrompts({ [JDK_QUESTION]: false })

      await setupMaven(
        { reachability: { ...reachability } },
        { inheritedReachability: inherited },
      )

      expect(asked[JDK_QUESTION]).toEqual([
        expect.objectContaining({
          choices: expect.arrayContaining([
            expect.objectContaining({ description: label, name: 'no' }),
          ]),
        }),
      ])
    },
  )

  it.for([
    {
      name: 'the shown value',
      config: { reachability: { javaHome: '/opt/jdk-17' } },
      inheritedReachability: undefined,
      offered: '/opt/jdk-17',
    },
    {
      name: 'an inherited JDK',
      config: {},
      inheritedReachability: { javaHome: '/opt/jdk-11' },
      offered: '/opt/jdk-11',
    },
  ])(
    'offers $name as the default and clears it on a blank answer',
    async ({ config, inheritedReachability, offered }) => {
      const { shown } = answerPrompts({
        [JDK_PROMPT]: '',
        [JDK_QUESTION]: true,
      })
      const written: Record<string, unknown> = structuredClone(config)

      await setupMaven(written, { inheritedReachability })

      expect(shown(JDK_PROMPT)).toEqual([offered])
      expect(written['reachability']).toEqual({ javaHome: null })
    },
  )

  it('does not ask in pom mode, where no facts reach a reachability run', async () => {
    const { messages } = answerPrompts()

    await setupGradle({ facts: false })
    await setupSbt({ facts: false })

    expect(messages).not.toContain(BUILD_QUESTION)
    expect(messages).not.toContain(JDK_QUESTION)
  })
})

describe('reachability build step', () => {
  it.for([
    ['dotnet', setupDotnet],
    ['gradle', setupGradle],
    ['maven', setupMaven],
    ['sbt', setupSbt],
  ] as const)(
    '%s writes compile to reachability.build after a yes',
    async ({ 1: setup }) => {
      answerPrompts({ [BUILD_QUESTION]: true })
      const config: Record<string, unknown> = {}

      const result = await setup(config)

      expect(result).toEqual({ ok: true, data: { canceled: false } })
      expect(config).toEqual({ reachability: { build: 'compile' } })
    },
  )

  it.for([
    ['dotnet', setupDotnet],
    ['gradle', setupGradle],
    ['maven', setupMaven],
    ['sbt', setupSbt],
  ] as const)(
    '%s leaves reachability.build unset after a no at the top level, never writing none',
    async ({ 1: setup }) => {
      answerPrompts({ [BUILD_QUESTION]: false })
      const config: Record<string, unknown> = {}

      await setup(config)

      expect(config).toEqual({})
    },
  )

  it.for([
    ['dotnet', setupDotnet],
    ['gradle', setupGradle],
    ['maven', setupMaven],
    ['sbt', setupSbt],
  ] as const)(
    '%s writes none after a no when the project inherits compile',
    async ({ 1: setup }) => {
      const { shown } = answerPrompts({ [BUILD_QUESTION]: false })
      const config: Record<string, unknown> = {
        reachability: { build: 'compile' },
      }

      await setup(config, { inheritedReachability: { build: 'compile' } })

      expect(shown(BUILD_QUESTION)).toEqual([true])
      expect(config).toEqual({ reachability: { build: 'none' } })
    },
  )

  it('leaves the build unset after a no when the project inherits none', async () => {
    answerPrompts({ [BUILD_QUESTION]: false })
    const config: Record<string, unknown> = { reachability: { build: 'none' } }

    await setupGradle(config, { inheritedReachability: { build: 'none' } })

    expect(config).toEqual({})
  })

  it('unsets a build it shows as the default after a no, keeping the JDK', async () => {
    const { shown } = answerPrompts({ [BUILD_QUESTION]: false })
    const config: Record<string, unknown> = {
      reachability: { build: 'compile', javaHome: '/opt/jdk-17' },
    }

    await setupMaven(config)

    expect(shown(BUILD_QUESTION)).toEqual([true])
    expect(config['reachability']).toEqual({ javaHome: '/opt/jdk-17' })
  })

  it('removes a written none after a no', async () => {
    const { shown } = answerPrompts({ [BUILD_QUESTION]: false })
    const config: Record<string, unknown> = { reachability: { build: 'none' } }

    await setupDotnet(config)

    expect(shown(BUILD_QUESTION)).toEqual([false])
    expect(config).toEqual({})
  })

  it('never asks dotnet for a reachability JDK', async () => {
    const { messages } = answerPrompts({ [BUILD_QUESTION]: true })
    const config: Record<string, unknown> = {}

    await setupDotnet(config)

    expect(messages).toContain(BUILD_QUESTION)
    expect(messages.some(m => m.includes('Java'))).toBe(false)
    expect(config).toEqual({ reachability: { build: 'compile' } })
  })
})

describe('reachability runtime step', () => {
  it('writes the runtime named after a yes to reachability.runtimeVersion', async () => {
    answerPrompts({ [RUNTIME_PROMPT]: '8.0', [RUNTIME_QUESTION]: true })
    const config: Record<string, unknown> = {}

    expect(await setupDotnet(config)).toEqual({
      ok: true,
      data: { canceled: false },
    })
    expect(config).toEqual({ reachability: { runtimeVersion: '8.0' } })
  })

  it.for([
    ['8.0', true],
    ['8.0.11', true],
    ['', true],
    ['net8.0', false],
    ['8', false],
  ] as const)('takes %j as an answer: %j', async ({ 0: answer, 1: valid }) => {
    const { asked } = answerPrompts({
      [RUNTIME_PROMPT]: '8.0',
      [RUNTIME_QUESTION]: true,
    })

    await setupDotnet({})

    const result = await asked[RUNTIME_PROMPT]?.[0]?.validate?.(answer)
    if (valid) {
      expect(result).toBe(true)
    } else {
      expect(result).toEqual(expect.stringContaining('major.minor'))
    }
  })

  it('offers an inherited runtime as the default and clears it on a blank answer', async () => {
    const { shown } = answerPrompts({
      [RUNTIME_PROMPT]: '',
      [RUNTIME_QUESTION]: true,
    })
    const config: Record<string, unknown> = {}

    await setupDotnet(config, {
      inheritedReachability: { runtimeVersion: '9.0' },
    })

    expect(shown(RUNTIME_PROMPT)).toEqual(['9.0'])
    expect(config).toEqual({ reachability: { runtimeVersion: null } })
  })

  it('never asks a JVM build tool for a .NET runtime', async () => {
    const { messages } = answerPrompts()

    await setupMaven({})

    expect(messages).not.toContain(RUNTIME_QUESTION)
  })
})

describe('reachability settings written invalid', () => {
  it.for([
    [
      'maven',
      { build: 'always', java_home: '/jdk', javaHome: '/opt/jdk-17' },
      { javaHome: '/opt/jdk-17' },
      ['reachability.build', 'reachability.java_home'],
    ],
    [
      'dotnet',
      { javaHome: '/jdk', runtimeVersion: 'net8.0' },
      undefined,
      ['reachability.javaHome', 'reachability.runtimeVersion'],
    ],
    ['gradle', 'compile', undefined, ['`reachability`']],
  ] as const)(
    '%s replaces %j, keeping only what its builds take',
    async ({ 0: tool, 1: reachability, 2: kept, 3: warned }) => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger)
      const config: Record<string, unknown> = { reachability }
      const setup = {
        dotnet: setupDotnet,
        gradle: setupGradle,
        maven: setupMaven,
      }[tool]

      expect(await setup(config)).toEqual({
        ok: true,
        data: { canceled: false },
      })

      expect(config['reachability']).toEqual(kept)
      for (const field of warned) {
        expect(warn).toHaveBeenCalledWith(expect.stringContaining(field))
      }
    },
  )

  it('ignores an invalid inherited value for its defaults', async () => {
    const { shown } = answerPrompts({ [BUILD_QUESTION]: false })
    const config: Record<string, unknown> = {}

    await setupGradle(config, {
      inheritedReachability: { build: 'always', javaHome: 17 },
    })

    expect(shown(BUILD_QUESTION)).toEqual([false])
    expect(config).toEqual({})
  })

  it('does not claim to replace an invalid value the merged settings inherit', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger)
    const inheritedReachability = { build: 'compile', javaHome: 17 }
    const config: Record<string, unknown> = {
      reachability: { ...inheritedReachability, build: 'always' },
    }

    await setupGradle(config, { factsOnly: true, inheritedReachability })

    expect(warn.mock.calls.map(c => c[0])).toEqual([
      expect.stringContaining('reachability.build'),
    ])
  })
})

describe('setupManifestConfig', () => {
  let parent = ''

  beforeEach(async () => {
    parent = await fs.realpath(
      await fs.mkdtemp(path.join(tmpdir(), 'setup-manifest-config-')),
    )
  })
  afterEach(async () => {
    await fs.rm(parent, { recursive: true, force: true })
  })

  it('writes none after a no under an ancestor socket.json that sets compile, showing compile as the default', async () => {
    await writeSocketJson(parent, {
      ...getDefaultSocketJson(),
      defaults: { manifest: { maven: { reachability: { build: 'compile' } } } },
    })
    const cwd = path.join(parent, 'app')
    await fs.mkdir(cwd)
    const { shown } = answerPrompts({
      [BUILD_QUESTION]: false,
      [ECOSYSTEM_QUESTION]: 'maven',
      [WRITE_QUESTION]: true,
    })
    vi.spyOn(logger, 'log').mockImplementation(() => logger)
    vi.spyOn(logger, 'info').mockImplementation(() => logger)

    expect(await setupManifestConfig(cwd)).toEqual({
      ok: true,
      data: undefined,
    })

    expect(shown(BUILD_QUESTION)).toEqual([true])
    const written = JSON.parse(
      await fs.readFile(path.join(cwd, 'socket.json'), 'utf8'),
    )
    expect(written.defaults.manifest.maven).toEqual({
      reachability: { build: 'none' },
    })
  })

  it.for([
    [
      'keeps the parent JDK for a scan here after a no',
      false,
      {
        javaHome: '/opt/jdk-17',
      },
    ],
    [
      'clears the parent JDK for a scan here after a blank JDK',
      true,
      undefined,
    ],
  ] as const)('%s', async ({ 1: wantsJavaHome, 2: scanned }) => {
    await writeSocketJson(parent, {
      ...getDefaultSocketJson(),
      defaults: {
        manifest: { maven: { reachability: { javaHome: '/opt/jdk-17' } } },
      },
    })
    const cwd = path.join(parent, 'app')
    await fs.mkdir(cwd)
    answerPrompts({
      [ECOSYSTEM_QUESTION]: 'maven',
      [JDK_PROMPT]: '',
      [JDK_QUESTION]: wantsJavaHome,
      [WRITE_QUESTION]: true,
    })
    vi.spyOn(logger, 'log').mockImplementation(() => logger)
    vi.spyOn(logger, 'info').mockImplementation(() => logger)

    await setupManifestConfig(cwd)

    expect(cascadedReachability('maven', readSocketJsonChain(cwd))).toEqual(
      scanned,
    )
  })
})

describe('setupManifestConfig with an invalid ancestor socket.json', () => {
  let parent = ''

  beforeEach(async () => {
    parent = await fs.realpath(
      await fs.mkdtemp(path.join(tmpdir(), 'setup-manifest-config-')),
    )
    await fs.writeFile(
      path.join(parent, 'socket.json'),
      JSON.stringify({
        version: 1,
        defaults: { manifest: { maven: { reachability: { javaHome: 17 } } } },
      }),
    )
  })
  afterEach(async () => {
    await fs.rm(parent, { recursive: true, force: true })
  })

  it('configures a build beneath it, replacing what it cannot take', async () => {
    const cwd = path.join(parent, 'app')
    await fs.mkdir(cwd)
    await fs.writeFile(
      path.join(cwd, 'socket.json'),
      JSON.stringify({
        version: 1,
        defaults: {
          manifest: { maven: { reachability: { build: 'always' } } },
        },
      }),
    )
    answerPrompts({ [ECOSYSTEM_QUESTION]: 'maven', [WRITE_QUESTION]: true })
    vi.spyOn(logger, 'log').mockImplementation(() => logger)
    vi.spyOn(logger, 'info').mockImplementation(() => logger)
    vi.spyOn(logger, 'warn').mockImplementation(() => logger)

    expect(await setupManifestConfig(cwd)).toEqual({
      ok: true,
      data: undefined,
    })

    const written = JSON.parse(
      await fs.readFile(path.join(cwd, 'socket.json'), 'utf8'),
    )
    expect(written.defaults.manifest.maven).toEqual({})
  })

  it('exits without reading it when no build tool is chosen', async () => {
    const cwd = path.join(parent, 'app')
    await fs.mkdir(cwd)
    answerPrompts({ [ECOSYSTEM_QUESTION]: '' })
    vi.spyOn(logger, 'log').mockImplementation(() => logger)
    vi.spyOn(logger, 'info').mockImplementation(() => logger)

    await expect(setupManifestConfig(cwd)).resolves.toMatchObject({
      ok: true,
      data: { canceled: true },
    })
  })
})

describe('setupDotnet', () => {
  it('preserves explicit nulls on a blank re-prompt', async () => {
    const config: Record<string, unknown> = { bin: null, dotnetOpts: null }

    await setupDotnet(config)

    expect(config).toEqual({ bin: null, dotnetOpts: null })
  })

  it('asks for target framework filters, never the facts/pom choice', async () => {
    vi.mocked(input).mockClear()
    vi.mocked(select).mockClear()

    await setupDotnet({})

    const messages = [
      ...vi.mocked(input).mock.calls,
      ...vi.mocked(select).mock.calls,
    ].map(c => c[0].message)
    expect(messages).toEqual(
      expect.arrayContaining(
        ['--dotnet-opts', 'target framework globs', '--ignore-unresolved'].map(
          s => expect.stringContaining(s),
        ),
      ),
    )
    expect(messages).not.toContainEqual(
      expect.stringContaining('--facts / --pom'),
    )
  })
})
