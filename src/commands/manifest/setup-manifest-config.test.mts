import { afterEach, describe, expect, it, vi } from 'vitest'

// Simulates a real prompt: pressing Enter with nothing typed returns
// whatever `default` was shown - the same contract inquirer honors. This is
// exactly the behavior that made `askForBin` freeze a hardcoded tool
// fallback (e.g. 'mvn') into socket.json when the user never typed anything.
vi.mock('../../utils/prompts.mts', () => ({
  input: vi.fn(async ({ default: def }: { default?: string }) => def ?? ''),
  select: vi.fn(async ({ default: def }: { default?: string }) => def ?? ''),
}))

import {
  setupDotnet,
  setupGradle,
  setupMaven,
  setupReachability,
  setupSbt,
} from './setup-manifest-config.mts'
import {
  BUILD_QUESTION,
  JDK_PROMPT,
  JDK_QUESTION,
  RUNTIME_PROMPT,
  RUNTIME_QUESTION,
  answerPrompts,
} from '../../../test/setup-prompts.mts'
import { logger } from '../../utils/logger.mts'
import { input, select } from '../../utils/prompts.mts'

import type { BuildTool } from './scripts/build-tool.mts'
import type { ReachabilityDefaults } from '../../utils/socket-json.mts'

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

describe('setup wizards without dynamic SBOM inference', () => {
  it.for([
    ['dotnet', setupDotnet],
    ['gradle', setupGradle],
    ['maven', setupMaven],
    ['sbt', setupSbt],
  ] as const)(
    '%s never asks for the reachability settings, leaving them as they are',
    async ({ 1: setup }) => {
      const { messages } = answerPrompts()
      const config: Record<string, unknown> = {
        reachability: { build: 'compile' },
      }

      await setup(config)

      for (const question of [BUILD_QUESTION, JDK_QUESTION, RUNTIME_QUESTION]) {
        expect(messages).not.toContain(question)
      }
      expect(config['reachability']).toEqual({ build: 'compile' })
    },
  )
})

// Runs the reachability step on the settings in effect, `reachability`.
// Returns what it leaves in their place.
async function step(
  tool: BuildTool,
  reachability: unknown,
  inherited?: unknown,
): Promise<unknown> {
  // Invalid values are written as a user would.
  const config = {
    reachability: structuredClone(reachability) as
      | ReachabilityDefaults
      | undefined,
  }
  expect(await setupReachability(tool, config, inherited)).toEqual({
    ok: true,
    data: { canceled: false },
  })
  return config.reachability
}

describe('reachability step', () => {
  it.for(['gradle', 'maven', 'sbt'] as const)(
    '%s writes the JDK named after a yes to reachability.javaHome',
    async tool => {
      answerPrompts({ [JDK_PROMPT]: '$JAVA17_HOME', [JDK_QUESTION]: true })

      expect(await step(tool, undefined)).toEqual({ javaHome: '$JAVA17_HOME' })
    },
  )

  it('writes nothing on a no and never asks for the JDK', async () => {
    const { asked } = answerPrompts({
      [JDK_PROMPT]: '/never-asked',
      [JDK_QUESTION]: false,
    })

    expect(await step('maven', undefined)).toBeUndefined()
    expect(asked[JDK_PROMPT]).toBeUndefined()
  })

  it('leaves a value it shows as is on a no, neither clearing nor restating it', async () => {
    answerPrompts({ [JDK_QUESTION]: false })

    expect(await step('maven', { javaHome: '/opt/jdk-17' })).toEqual({
      javaHome: '/opt/jdk-17',
    })
  })

  it.for([
    [
      { javaHome: '/opt/jdk-17' },
      {},
      'Keep /opt/jdk-17 as the JDK for reachability analysis',
    ],
    [{}, {}, 'Leave the JDK for reachability analysis unset'],
    [
      { javaHome: '/opt/jdk-11' },
      { javaHome: '/opt/jdk-11' },
      'Keep /opt/jdk-11 as the JDK for reachability analysis, which it inherits',
    ],
    [
      { javaHome: null },
      { javaHome: '/opt/jdk-11' },
      'Leave the JDK for reachability analysis unset',
    ],
  ] as const)(
    'labels the no to the JDK %j, inheriting %j, by what it does',
    async ({ 0: reachability, 1: inherited, 2: label }) => {
      const { noChoice } = answerPrompts({ [JDK_QUESTION]: false })

      await step('maven', reachability, inherited)

      expect(noChoice(JDK_QUESTION)).toEqual([label])
    },
  )

  it.for([
    {
      name: 'its own JDK',
      inherited: undefined,
      left: undefined,
      offered: '/opt/jdk-17',
    },
    {
      name: 'an inherited JDK',
      inherited: { javaHome: '/opt/jdk-17' },
      left: { javaHome: null },
      offered: '/opt/jdk-17',
    },
  ])(
    'offers $name as the default and clears it on a blank answer',
    async ({ inherited, left, offered }) => {
      const { shown } = answerPrompts({
        [JDK_PROMPT]: '',
        [JDK_QUESTION]: true,
      })

      expect(
        await step('maven', { javaHome: '/opt/jdk-17' }, inherited),
      ).toEqual(left)
      expect(shown(JDK_PROMPT)).toEqual([offered])
    },
  )
})

describe('reachability build step', () => {
  it.for(['dotnet', 'gradle', 'maven', 'sbt'] as const)(
    '%s writes compile to reachability.build after a yes',
    async tool => {
      answerPrompts({ [BUILD_QUESTION]: true })

      expect(await step(tool, undefined)).toEqual({ build: 'compile' })
    },
  )

  it.for(['dotnet', 'gradle', 'maven', 'sbt'] as const)(
    '%s leaves reachability.build unset after a no at the top level, never writing none',
    async tool => {
      answerPrompts({ [BUILD_QUESTION]: false })

      expect(await step(tool, undefined)).toBeUndefined()
    },
  )

  it.for(['dotnet', 'gradle', 'maven', 'sbt'] as const)(
    '%s writes none after a no when the project inherits compile',
    async tool => {
      const { shown } = answerPrompts({ [BUILD_QUESTION]: false })

      expect(
        await step(tool, { build: 'compile' }, { build: 'compile' }),
      ).toEqual({ build: 'none' })
      expect(shown(BUILD_QUESTION)).toEqual([true])
    },
  )

  it('leaves the build unset after a no when the project inherits none', async () => {
    answerPrompts({ [BUILD_QUESTION]: false })

    expect(
      await step('gradle', { build: 'none' }, { build: 'none' }),
    ).toBeUndefined()
  })

  it('unsets a build it shows as the default after a no, keeping the JDK', async () => {
    const { shown } = answerPrompts({ [BUILD_QUESTION]: false })

    expect(
      await step('maven', { build: 'compile', javaHome: '/opt/jdk-17' }),
    ).toEqual({ javaHome: '/opt/jdk-17' })
    expect(shown(BUILD_QUESTION)).toEqual([true])
  })

  it('removes a written none after a no', async () => {
    const { shown } = answerPrompts({ [BUILD_QUESTION]: false })

    expect(await step('dotnet', { build: 'none' })).toBeUndefined()
    expect(shown(BUILD_QUESTION)).toEqual([false])
  })

  it('never asks dotnet for a reachability JDK', async () => {
    const { messages } = answerPrompts({ [BUILD_QUESTION]: true })

    expect(await step('dotnet', undefined)).toEqual({ build: 'compile' })
    expect(messages).toContain(BUILD_QUESTION)
    expect(messages.some(m => m.includes('Java'))).toBe(false)
  })
})

describe('reachability runtime step', () => {
  it('writes the runtime named after a yes to reachability.runtimeVersion', async () => {
    answerPrompts({ [RUNTIME_PROMPT]: '8.0', [RUNTIME_QUESTION]: true })

    expect(await step('dotnet', undefined)).toEqual({ runtimeVersion: '8.0' })
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

    await step('dotnet', undefined)

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

    expect(
      await step(
        'dotnet',
        { runtimeVersion: '9.0' },
        { runtimeVersion: '9.0' },
      ),
    ).toEqual({ runtimeVersion: null })
    expect(shown(RUNTIME_PROMPT)).toEqual(['9.0'])
  })

  it('never asks a JVM build tool for a .NET runtime', async () => {
    const { messages } = answerPrompts()

    await step('maven', undefined)

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

      expect(await step(tool, reachability)).toEqual(kept)
      for (const field of warned) {
        expect(warn).toHaveBeenCalledWith(expect.stringContaining(field))
      }
    },
  )

  it('ignores an invalid inherited value for its defaults, saying where to fix it', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger)
    const { shown } = answerPrompts({ [BUILD_QUESTION]: false })
    const inherited = { build: 'always', javaHome: 17 }

    expect(await step('gradle', inherited, inherited)).toBeUndefined()
    expect(shown(BUILD_QUESTION)).toEqual([false])
    expect(warn.mock.calls.map(c => c[0])).toEqual([
      expect.stringContaining(
        '`reachability.build` ("always"), which this build inherits',
      ),
      expect.stringContaining(
        '`reachability.javaHome` (17), which this build inherits',
      ),
    ])
  })

  it('replaces its own invalid values and names the inherited ones', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger)
    const inherited = { build: 'compile', javaHome: 17 }

    await step('gradle', { ...inherited, build: 'always' }, inherited)

    expect(warn.mock.calls.map(c => c[0])).toEqual([
      expect.stringContaining('Replacing `reachability.build`'),
      expect.stringContaining(
        '`reachability.javaHome` (17), which this build inherits',
      ),
    ])
  })

  it('shows the inherited value its own invalid value leaves in effect', async () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => logger)
    const { noChoice } = answerPrompts({ [JDK_QUESTION]: false })

    expect(
      await step('maven', { javaHome: 5 }, { javaHome: '/opt/jdk-11' }),
    ).toBeUndefined()
    expect(noChoice(JDK_QUESTION)).toEqual([
      'Keep /opt/jdk-11 as the JDK for reachability analysis, which it inherits',
    ])
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
