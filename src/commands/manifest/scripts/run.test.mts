import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { spawn } from '@socketsecurity/registry/lib/spawn'

import { enumerateWorkspaces, runManifestScript } from './run.mts'

vi.mock('@socketsecurity/registry/lib/spawn', () => ({
  spawn: vi.fn(async () => ({ code: 0, stderr: '', stdout: '' })),
}))
// The Maven extension jar exists only in a built checkout.
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    existsSync: (p: string) => p.endsWith('.jar') || actual.existsSync(p),
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

async function fakeJdk(home: string, javaVersion: string): Promise<string> {
  await fs.mkdir(path.join(home, 'bin'), { recursive: true })
  await fs.writeFile(path.join(home, 'bin', 'java'), '', { mode: 0o755 })
  await fs.writeFile(
    path.join(home, 'release'),
    `JAVA_VERSION="${javaVersion}"\n`,
  )
  return await fs.realpath(home)
}

async function withGradle814(
  fn: (dir: string, jdk21: string, jdk25: string) => Promise<void>,
): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gradle-814-'))
  try {
    await fs.mkdir(path.join(dir, 'gradle', 'wrapper'), { recursive: true })
    await fs.writeFile(path.join(dir, 'gradlew'), '', { mode: 0o755 })
    await fs.writeFile(
      path.join(dir, 'gradle', 'wrapper', 'gradle-wrapper.properties'),
      'distributionUrl=https\\://services.gradle.org/distributions/gradle-8.14.3-bin.zip\n',
    )
    await fn(
      dir,
      await fakeJdk(path.join(dir, 'jdk21'), '21.0.12'),
      await fakeJdk(path.join(dir, 'jdk25'), '25.0.4'),
    )
  } finally {
    await fs.rm(dir, { force: true, recursive: true })
  }
}

function spawnedJavaHome(): string | undefined {
  return vi.mocked(spawn).mock.calls[0]?.[2]?.env?.['JAVA_HOME']
}

describe('build JDK', () => {
  it('runs the Gradle wrapper on a JDK it supports', async () => {
    await withGradle814(async (dir, jdk21, jdk25) => {
      vi.mocked(spawn).mockClear()
      vi.stubEnv('JAVA_HOME', jdk25)
      vi.stubEnv('JAVA_HOME_21_X64', jdk21)
      try {
        await runManifestScript('gradle', { projectDir: dir, stdio: 'pipe' })
      } finally {
        vi.unstubAllEnvs()
      }
      const javaHome = spawnedJavaHome()
      expect(javaHome).not.toBe(jdk25)
      const release = await fs.readFile(path.join(javaHome!, 'release'), 'utf8')
      expect(Number(/JAVA_VERSION="(\d+)/.exec(release)?.[1])).toBeLessThan(25)
    })
  })

  it('keeps the JAVA_HOME a caller configures', async () => {
    await withGradle814(async (dir, jdk21, jdk25) => {
      vi.mocked(spawn).mockClear()
      await runManifestScript('gradle', {
        env: { JAVA_HOME: jdk25, JAVA_HOME_21_X64: jdk21 },
        projectDir: dir,
        stdio: 'pipe',
      })
      expect(spawnedJavaHome()).toBe(jdk25)
    })
  })
})
