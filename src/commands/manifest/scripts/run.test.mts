import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { spawn } from '@socketsecurity/registry/lib/spawn'

import { enumerateWorkspaces } from './run.mts'

vi.mock('@socketsecurity/registry/lib/spawn', () => ({
  spawn: vi.fn(async () => ({ code: 0, stderr: '', stdout: '' })),
}))
// The Maven extension jar and the dotnet tool exist only in a built checkout.
// Each dotnetDir() case pins its own SDK, so cases never share a probe.
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    existsSync: (p: string) =>
      p.endsWith('.jar') ||
      p.endsWith('.dll') ||
      /[\\/]repo[\\/]dotnet-\d+[\\/]global\.json$/.test(p) ||
      actual.existsSync(p),
  }
})

beforeEach(() => {
  vi.mocked(spawn).mockReset()
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

describe('maven entry file', () => {
  it.each([
    ['app-dev.pom.xml', ['--file', 'app-dev.pom.xml', '-P', 'ci']],
    ['pom.xml', ['--file', 'pom.xml', '-P', 'ci']],
    [undefined, ['-P', 'ci']],
  ] as const)(
    'builds %s, ahead of the given options',
    async (entryFile, expected) => {
      vi.mocked(spawn).mockClear()
      await enumerateWorkspaces('maven', {
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

  it('defaults the base to projectDir', async () => {
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
  return vi.mocked(spawn).mock.calls.filter(c => c[1]?.[0] !== '--version')[0]
}

describe('dotnet tool invocation', () => {
  it('lists workspaces of the build entry with the given options', async () => {
    const projectDir = dotnetDir()
    mockDotnet('8.0.414', 'buildRoot\t/repo\nentry\tApp.sln\n')
    const result = await enumerateWorkspaces('dotnet', {
      bin: '/opt/dotnet/dotnet',
      entryFile: 'App.sln',
      excludeBase: path.join(path.sep, 'repo'),
      excludePaths: ['test'],
      projectDir,
      stdio: 'pipe',
      toolOpts: ['-p:Configuration=Release', '--locked-mode'],
    })
    const { 0: bin, 1: args = [], 2: opts } = toolCall()!
    expect(bin).toBe('/opt/dotnet/dotnet')
    expect(args[0]).toMatch(/socket-facts-dotnet\.dll$/)
    expect(args.slice(args.indexOf('--entry'))).toEqual([
      '--entry',
      'App.sln',
      '--dotnet',
      '/opt/dotnet/dotnet',
      '--workspaces',
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
    expect(result.buildRoot).toBe('/repo')
  })

  it('lets a preview SDK roll the tool forward onto a preview runtime', async () => {
    mockDotnet('11.0.100-rc.3.26522.148')
    await enumerateWorkspaces('dotnet', {
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

  it('needs an entry file', async () => {
    await expect(
      enumerateWorkspaces('dotnet', { bin: 'dotnet', projectDir: dotnetDir() }),
    ).rejects.toThrow(/solution or project file/)
  })
})
