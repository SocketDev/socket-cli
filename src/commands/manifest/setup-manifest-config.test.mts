import { afterEach, describe, expect, it, vi } from 'vitest'

// Simulates a real prompt: pressing Enter with nothing typed returns
// whatever `default` was shown - the same contract inquirer honors. This is
// exactly the behavior that made `askForBin` freeze a hardcoded tool
// fallback (e.g. 'mvn') into socket.json when the user never typed anything.
vi.mock('@socketsecurity/registry/lib/prompts', () => ({
  input: vi.fn(async ({ default: def }: { default?: string }) => def ?? ''),
  select: vi.fn(async ({ default: def }: { default?: string }) => def ?? ''),
}))

import { input, select } from '@socketsecurity/registry/lib/prompts'

import {
  setupDotnet,
  setupGradle,
  setupMaven,
  setupSbt,
} from './setup-manifest-config.mts'

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
    const messages: string[] = []
    vi.mocked(select).mockImplementation(async ({ default: def, message }) => {
      messages.push(message)
      return def ?? ''
    })

    await setupGradle({})
    await setupSbt({})

    expect(messages.some(m => m.includes('--facts / --pom'))).toBe(true)
  })

  it('skips the facts/pom question entirely when factsOnly is set, going straight to facts-only options', async () => {
    const messages: string[] = []
    vi.mocked(select).mockImplementation(async ({ default: def, message }) => {
      messages.push(message)
      return def ?? ''
    })

    await setupGradle({}, { factsOnly: true })
    await setupSbt({}, { factsOnly: true })

    expect(messages.some(m => m.includes('--facts / --pom'))).toBe(false)
    // The facts-only options (config filters) still ask, just without the
    // facts/pom choice gating them.
    expect(messages.some(m => m.includes('--ignore-unresolved'))).toBe(true)
  })
})

describe('reachability step', () => {
  const REACHABILITY_QUESTION =
    'Use a different Java for reachability analysis?'

  // Answers the reachability question with `wantsJavaHome` and its JDK prompt
  // with `javaHome`; every other prompt keeps its default.
  function answerReachability(wantsJavaHome: boolean, javaHome = ''): void {
    vi.mocked(select).mockImplementation(async ({ default: def, message }) =>
      message === REACHABILITY_QUESTION ? wantsJavaHome : (def ?? ''),
    )
    vi.mocked(input).mockImplementation(async ({ default: def, message }) =>
      message.startsWith('What JDK should reachability analysis use?')
        ? javaHome
        : (def ?? ''),
    )
  }

  afterEach(() => {
    vi.mocked(input).mockReset()
    vi.mocked(input).mockImplementation(async ({ default: def }) => def ?? '')
    vi.mocked(select).mockReset()
    vi.mocked(select).mockImplementation(async ({ default: def }) => def ?? '')
  })

  it.for([
    ['gradle', setupGradle],
    ['maven', setupMaven],
    ['sbt', setupSbt],
  ] as const)(
    '%s writes the JDK named after a yes to reachability.javaHome',
    async ({ 1: setup }) => {
      answerReachability(true, '$JAVA17_HOME')
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
    answerReachability(false, '/never-asked')
    const config: Record<string, unknown> = {}

    await setupMaven(config)

    expect(config).toEqual({})
    expect(
      vi
        .mocked(input)
        .mock.calls.some(([{ message }]) => message.includes('reachability')),
    ).toBe(false)
  })

  it('leaves a value it shows as is on a no, neither clearing nor restating it', async () => {
    answerReachability(false)
    const config: Record<string, unknown> = {
      reachability: { javaHome: '/opt/jdk-17' },
    }

    await setupMaven(config)

    expect(config['reachability']).toEqual({ javaHome: '/opt/jdk-17' })
  })

  it('offers the shown value as the default and clears it on a blank answer', async () => {
    vi.mocked(select).mockImplementation(async ({ default: def, message }) =>
      message === REACHABILITY_QUESTION ? true : (def ?? ''),
    )
    const shown: unknown[] = []
    vi.mocked(input).mockImplementation(async ({ default: def, message }) => {
      if (message.startsWith('What JDK should reachability analysis use?')) {
        shown.push(def)
        return ''
      }
      return def ?? ''
    })
    const config: Record<string, unknown> = {
      reachability: { javaHome: '/opt/jdk-17' },
    }

    await setupGradle(config, { factsOnly: true })

    expect(shown).toEqual(['/opt/jdk-17'])
    expect(config['reachability']).toEqual({ javaHome: null })
  })

  it('does not ask in pom mode, where no facts reach a reachability run', async () => {
    const messages: string[] = []
    vi.mocked(select).mockImplementation(async ({ default: def, message }) => {
      messages.push(message)
      return def ?? ''
    })

    await setupGradle({ facts: false })
    await setupSbt({ facts: false })

    expect(messages).not.toContain(REACHABILITY_QUESTION)
  })
})

describe('reachability build step', () => {
  const BUILD_QUESTION =
    'Build project before reachability analysis? Note: A failed build fails the scan.'

  // Answers the build question with `wantsBuild`; every other prompt keeps
  // its default. Returns the build question's shown default per call.
  function answerBuild(wantsBuild: boolean): unknown[] {
    const shown: unknown[] = []
    vi.mocked(select).mockImplementation(async ({ default: def, message }) => {
      if (message === BUILD_QUESTION) {
        shown.push(def)
        return wantsBuild
      }
      return def ?? ''
    })
    return shown
  }

  afterEach(() => {
    vi.mocked(select).mockReset()
    vi.mocked(select).mockImplementation(async ({ default: def }) => def ?? '')
  })

  it.for([
    ['dotnet', setupDotnet],
    ['gradle', setupGradle],
    ['maven', setupMaven],
    ['sbt', setupSbt],
  ] as const)(
    '%s writes compile to reachability.build after a yes',
    async ({ 1: setup }) => {
      answerBuild(true)
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
      answerBuild(false)
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
      const shown = answerBuild(false)
      const config: Record<string, unknown> = {
        reachability: { build: 'compile' },
      }

      await setup(config, { inheritedReachabilityBuild: 'compile' })

      expect(shown).toEqual([true])
      expect(config).toEqual({ reachability: { build: 'none' } })
    },
  )

  it('leaves the build unset after a no when the project inherits none', async () => {
    answerBuild(false)
    const config: Record<string, unknown> = { reachability: { build: 'none' } }

    await setupGradle(config, { inheritedReachabilityBuild: 'none' })

    expect(config).toEqual({})
  })

  it('unsets a build it shows as the default after a no, keeping the JDK', async () => {
    const shown = answerBuild(false)
    const config: Record<string, unknown> = {
      reachability: { build: 'compile', javaHome: '/opt/jdk-17' },
    }

    await setupMaven(config)

    expect(shown).toEqual([true])
    expect(config['reachability']).toEqual({ javaHome: '/opt/jdk-17' })
  })

  it('removes a written none after a no', async () => {
    const shown = answerBuild(false)
    const config: Record<string, unknown> = { reachability: { build: 'none' } }

    await setupDotnet(config)

    expect(shown).toEqual([false])
    expect(config).toEqual({})
  })

  it('never asks dotnet for a reachability JDK', async () => {
    const messages: string[] = []
    vi.mocked(select).mockImplementation(async ({ default: def, message }) => {
      messages.push(message)
      return message === BUILD_QUESTION ? true : (def ?? '')
    })
    const config: Record<string, unknown> = {}

    await setupDotnet(config)

    expect(messages).toContain(BUILD_QUESTION)
    expect(messages.some(m => m.includes('Java'))).toBe(false)
    expect(config).toEqual({ reachability: { build: 'compile' } })
  })

  it('does not ask in pom mode, where no facts reach a reachability run', async () => {
    const messages: string[] = []
    vi.mocked(select).mockImplementation(async ({ default: def, message }) => {
      messages.push(message)
      return def ?? ''
    })

    await setupGradle({ facts: false })
    await setupSbt({ facts: false })

    expect(messages).not.toContain(BUILD_QUESTION)
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
