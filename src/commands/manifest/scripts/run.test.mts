import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { logger } from '@socketsecurity/registry/lib/logger'
import { spawn } from '@socketsecurity/registry/lib/spawn'

import {
  enumerateWorkspaces,
  listDotnetEntryProjects,
  runManifestScript,
  skipWithoutDotnetSdk,
} from './run.mts'

vi.mock('@socketsecurity/registry/lib/spawn', () => ({
  spawn: vi.fn(async () => ({ code: 0, stderr: '', stdout: '' })),
}))
// The Maven extension jar and the dotnet tool exist only in a built checkout.
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    existsSync: (p: string) =>
      p.endsWith('.jar') || p.endsWith('.dll') || actual.existsSync(p),
  }
})

describe('build tool output', () => {
  it.each([
    ['inherit', ['inherit', 2, 'inherit']],
    ['pipe', 'pipe'],
  ] as const)(
    'maps stdio %s so stdout stays free of build logs',
    async (stdio, expected) => {
      vi.mocked(spawn).mockClear()
      await enumerateWorkspaces('gradle', {
        bin: 'gradle',
        projectDir: process.cwd(),
        stdio,
      }).catch(() => {})
      expect(vi.mocked(spawn).mock.calls[0]?.[2]?.stdio).toEqual(expected)
    },
  )
})

describe('shared sbt global base', () => {
  it("does not read the previous root's records when a build dies before writing", async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'sbt-shared-base-'))
    try {
      const recordsArg = (args: readonly string[]) =>
        args
          .find(a => a.startsWith('-Dsocket.recordsFile='))!
          .slice('-Dsocket.recordsFile='.length)
      vi.mocked(spawn).mockImplementationOnce((async (
        _bin: string,
        args: readonly string[],
      ) => {
        await fs.writeFile(
          recordsArg(args),
          'buildRoot\t/a\nroot\t0\troot\tcompile\t1\nnode\t0\tx:y:jar:1\tx\ty\t1\tjar\t\t1\t\n',
        )
        return { code: 0, stderr: '', stdout: '' }
      }) as any)
      vi.mocked(spawn).mockImplementationOnce((async () => ({
        code: 1,
        stderr: 'error: not found: value broken',
        stdout: '',
      })) as any)
      const opts = { bin: 'sbt', stdio: 'pipe' as const, tmpDir: base }
      const a = await runManifestScript('sbt', { ...opts, projectDir: base })
      const b = await runManifestScript('sbt', { ...opts, projectDir: base })
      expect(a.facts.components).toHaveLength(1)
      expect(b.code).toBe(1)
      expect(b.buildRoot).toBeUndefined()
      expect(b.facts.components).toHaveLength(0)
    } finally {
      await fs.rm(base, { force: true, recursive: true })
    }
  })
})

describe('maven entry file', () => {
  it.each([
    ['app-dev.pom.xml', ['--file', 'app-dev.pom.xml', '-P', 'ci']],
    ['pom.xml', ['--file', 'pom.xml', '-P', 'ci']],
    [undefined, ['-P', 'ci']],
  ] as const)(
    'builds %s, ahead of the given options',
    async (entryFile, expected) => {
      vi.mocked(spawn).mockClear()
      await runManifestScript('maven', {
        bin: 'mvn',
        entryFile,
        projectDir: process.cwd(),
        stdio: 'pipe',
        toolOpts: ['-P', 'ci'],
      })
      const args = vi.mocked(spawn).mock.calls[0]?.[1] ?? []
      expect(args.filter(a => !a.startsWith('-D'))).toEqual([
        ...expected,
        '--batch-mode',
        'validate',
      ])
    },
  )
})

async function excludeProps(excludeBase: string | undefined) {
  vi.mocked(spawn).mockClear()
  await enumerateWorkspaces('gradle', {
    bin: 'gradle',
    excludeBase,
    excludePaths: ['shared'],
    projectDir: path.join(path.sep, 'repo', 'app'),
    stdio: 'pipe',
  }).catch(() => {})
  const args = (vi.mocked(spawn).mock.calls[0]?.[1] ?? []) as string[]
  return args.filter(a => a.startsWith('-Psocket.exclude'))
}

describe('--exclude-paths anchoring', () => {
  it('tells the build script the scan root the patterns are relative to', async () => {
    expect(await excludeProps(path.join(path.sep, 'repo'))).toEqual([
      expect.stringMatching(/^-Psocket\.excludePaths=/),
      `-Psocket.excludeBase=${path.join(path.sep, 'repo')}`,
    ])
  })

  it('defaults the base to the build root', async () => {
    expect(await excludeProps(undefined)).toEqual([
      expect.stringMatching(/^-Psocket\.excludePaths=/),
      `-Psocket.excludeBase=${path.join(path.sep, 'repo', 'app')}`,
    ])
  })
})

// The SDK version is cached per bin and directory, so each case gets its own.
let dotnetCase = 0
function dotnetDir(): string {
  dotnetCase += 1
  return path.join(path.sep, 'repo', `dotnet-${dotnetCase}`)
}

// Answers `dotnet --version` with `sdk`, then runs the tool, which writes
// `records` to its --records file.
function mockDotnet(sdk: string, records = '', code = 0): void {
  vi.mocked(spawn).mockImplementation((async (
    _bin: string,
    args: readonly string[],
  ) => {
    if (args[0] === '--version') {
      return { code: 0, stderr: '', stdout: `${sdk}\n` }
    }
    const at = args.indexOf('--records')
    if (at < 0) {
      throw new Error('the dotnet tool was run without --records')
    }
    await fs.writeFile(args[at + 1]!, records)
    return { code, stderr: '', stdout: '' }
  }) as any)
}

function toolCall() {
  return vi.mocked(spawn).mock.calls.find(c => c[1]?.[0] !== '--version')
}

describe('dotnet tool invocation', () => {
  beforeEach(() => {
    vi.mocked(spawn).mockReset()
  })

  it('runs the bundled tool on the build entry with the given options', async () => {
    const projectDir = dotnetDir()
    mockDotnet('8.0.414', 'buildRoot\t/repo\nentry\tApp.sln\n')
    const result = await runManifestScript('dotnet', {
      bin: '/opt/dotnet/dotnet',
      entryFile: 'App.sln',
      excludeBase: path.join(path.sep, 'repo'),
      excludeConfigs: '*/*',
      excludePaths: ['test'],
      includeConfigs: 'net8.0',
      projectDir,
      stdio: 'pipe',
      toolOpts: ['-p:Configuration=Release', '--locked-mode'],
      withFiles: true,
    })
    const { 0: bin, 1: args = [], 2: opts } = toolCall()!
    expect(bin).toBe('/opt/dotnet/dotnet')
    expect(args[0]).toMatch(/socket-facts-dotnet\.dll$/)
    expect(args.slice(args.indexOf('--entry'))).toEqual([
      '--entry',
      'App.sln',
      '--dotnet',
      '/opt/dotnet/dotnet',
      '--with-files',
      '--include-configs',
      'net8.0',
      '--exclude-configs',
      '*/*',
      '--exclude-paths',
      '^(?:test)(?:/.*)?$',
      '--exclude-base',
      path.join(path.sep, 'repo'),
      '--',
      '-p:Configuration=Release',
      '--locked-mode',
    ])
    expect(opts?.cwd).toBe(projectDir)
    expect(opts?.env).toBeUndefined()
    expect(result.factsFileName).toBe('App.sln.socket.facts.json')
  })

  it('lets a preview SDK roll the tool forward onto a preview runtime', async () => {
    mockDotnet('11.0.100-rc.3.26522.148')
    await runManifestScript('dotnet', {
      bin: 'dotnet',
      entryFile: 'App.csproj',
      env: { NUGET_PACKAGES: '/cache', PATH: '/bin' },
      projectDir: dotnetDir(),
      stdio: 'pipe',
    })
    expect(toolCall()?.[2]?.env).toEqual({
      DOTNET_ROLL_FORWARD_TO_PRERELEASE: '1',
      NUGET_PACKAGES: '/cache',
      PATH: '/bin',
    })
  })

  it('lists workspaces in the restore-free mode', async () => {
    mockDotnet('8.0.414')
    await enumerateWorkspaces('dotnet', {
      bin: 'dotnet',
      entryFile: 'App.sln',
      projectDir: dotnetDir(),
      stdio: 'pipe',
    })
    expect(toolCall()?.[1]).toContain('--workspaces')
  })

  it('needs an entry file', async () => {
    await expect(
      runManifestScript('dotnet', { bin: 'dotnet', projectDir: dotnetDir() }),
    ).rejects.toThrow(/solution or project file/)
  })
})

describe('skipWithoutDotnetSdk', () => {
  beforeEach(() => {
    vi.mocked(spawn).mockReset()
  })

  it('skips, warning once per reason, where no SDK runs', async () => {
    // Warnings are deduplicated for the whole run, so the reason is unique
    // to this case.
    const reason = `No .NET SDK matches ${dotnetDir()}.`
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger)
    vi.mocked(spawn).mockImplementation((async () => {
      throw Object.assign(new Error('exit 145'), {
        code: 145,
        stderr: `${reason}\nRequested SDK version: 99.0.100`,
        stdout: '',
      })
    }) as any)
    try {
      expect(await skipWithoutDotnetSdk('dotnet', dotnetDir())).toBe(true)
      expect(await skipWithoutDotnetSdk('dotnet', dotnetDir())).toBe(true)
      expect(warn).toHaveBeenCalledOnce()
      expect(warn.mock.calls[0]?.[0]).toContain(reason)
    } finally {
      warn.mockRestore()
    }
  })

  it('runs the build where an SDK answers', async () => {
    mockDotnet('8.0.414')
    expect(await skipWithoutDotnetSdk('dotnet', dotnetDir())).toBe(false)
  })
})

function solutionOpts(projectDir: string) {
  return { bin: 'dotnet', entryFile: 'App.sln', projectDir }
}

describe('listDotnetEntryProjects', () => {
  beforeEach(() => {
    vi.mocked(spawn).mockReset()
  })

  it('resolves the members against the build directory', async () => {
    const projectDir = dotnetDir()
    mockDotnet('8.0.414', 'member\tsrc/A/A.csproj\nmember\tsrc/B/B.csproj\n')
    expect(await listDotnetEntryProjects(solutionOpts(projectDir))).toEqual([
      path.join(projectDir, 'src', 'A', 'A.csproj'),
      path.join(projectDir, 'src', 'B', 'B.csproj'),
    ])
  })

  it('cannot tell when the SDK cannot read the solution', async () => {
    mockDotnet(
      '8.0.414',
      'failure\tApp.slnx\tcould not read the solution\t\t\n',
    )
    expect(
      await listDotnetEntryProjects(solutionOpts(dotnetDir())),
    ).toBeUndefined()
  })

  it('lists nothing when the tool exits non-zero', async () => {
    mockDotnet('8.0.414', 'member\tsrc/A/A.csproj\n', 1)
    expect(await listDotnetEntryProjects(solutionOpts(dotnetDir()))).toEqual([])
  })
})
