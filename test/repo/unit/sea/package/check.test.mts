import { createHash } from 'node:crypto'
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type NativePackageProcessResult,
  type NativePackageSpawnProcess,
  verifyNativePackage,
} from '../../../../../scripts/repo/build/sea/package/check.mts'
import {
  resolveSeaTarget,
  SEA_TARGETS,
} from '../../../../../scripts/repo/build/sea/targets.mts'

const packageBins = {
  socket: 'dist/socket.js',
  'socket-npm': 'dist/socket-npm.js',
  'socket-npx': 'dist/socket-npx.js',
  'socket-pnpm': 'dist/socket-pnpm.js',
  'socket-yarn': 'dist/socket-yarn.js',
}
const spawnProcess = vi.fn<NativePackageSpawnProcess>()
let packageRoot: string

function digest(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function successfulResult(): NativePackageProcessResult {
  return {
    code: 0,
    signal: null,
    stdout: Buffer.from('socket version'),
    stderr: Buffer.alloc(0),
  }
}

async function createPackageFixture(): Promise<void> {
  const seaDirectory = path.join(packageRoot, 'dist', 'sea')
  await mkdir(seaDirectory, { recursive: true })
  await writeFile(
    path.join(packageRoot, 'package.json'),
    JSON.stringify({ name: 'socket', bin: packageBins }),
  )
  const payload = Buffer.from('packed cli payload')
  await writeFile(path.join(packageRoot, 'dist', 'cli.js'), payload)
  const binaries = Object.fromEntries(
    SEA_TARGETS.map(target => {
      const name = `socket-${target}${target.startsWith('win32-') ? '.exe' : ''}`
      const bytes = Buffer.from(`binary ${target}`)
      return [target, { name, bytes, hash: digest(bytes) }]
    }),
  )
  for (const { name, bytes } of Object.values(binaries)) {
    await writeFile(path.join(seaDirectory, name), bytes)
  }
  const entrypoints = Object.fromEntries(
    Object.values(packageBins).map(relativeFile => {
      const bytes = Buffer.from(`launcher ${relativeFile}`)
      return [
        path.posix.basename(relativeFile),
        { relativeFile, bytes, hash: digest(bytes) },
      ]
    }),
  )
  for (const { relativeFile, bytes } of Object.values(entrypoints)) {
    const file = path.join(packageRoot, ...relativeFile.split('/'))
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, bytes)
  }
  await writeFile(
    path.join(seaDirectory, 'manifest.generated.json'),
    JSON.stringify({
      mode: 'production',
      payload: digest(payload),
      binaries: Object.fromEntries(
        Object.entries(binaries).map(([target, binary]) => [
          target,
          binary.hash,
        ]),
      ),
      entrypoints: Object.fromEntries(
        Object.entries(entrypoints).map(([name, entrypoint]) => [
          name,
          entrypoint.hash,
        ]),
      ),
    }),
  )
}

function launcherTarget(): string {
  const glibc = (
    process.report.getReport() as {
      header: { glibcVersionRuntime?: string | undefined }
    }
  ).header.glibcVersionRuntime
  return resolveSeaTarget(process.platform, process.arch, { glibc })
}

describe('packed native package verification', () => {
  beforeEach(async () => {
    packageRoot = await mkdtemp(
      path.join(os.tmpdir(), 'socket-native-package-'),
    )
    spawnProcess.mockReset().mockResolvedValue(successfulResult())
    await createPackageFixture()
  })

  afterEach(async () => {
    await rm(packageRoot, { recursive: true, force: true })
  })

  it('verifies hashes before running the target and five packed entrypoints', async () => {
    const target = SEA_TARGETS[0]!
    const result = await verifyNativePackage({
      packageRoot,
      target,
      spawnProcess,
    })
    expect(result).toEqual({
      requestedTarget: target,
      launcherTarget: launcherTarget(),
    })
    expect(spawnProcess).toHaveBeenCalledTimes(8)
    expect(spawnProcess.mock.calls.slice(0, 3).map(call => call[1])).toEqual([
      ['--version'],
      ['--help'],
      ['npm', '--version'],
    ])
    expect(spawnProcess.mock.calls.slice(3).map(call => call[1])).toEqual(
      Object.values(packageBins).map(file => [
        path.resolve(packageRoot, file),
        '--version',
      ]),
    )
    expect(spawnProcess).toHaveBeenCalledWith(
      process.execPath,
      expect.any(Array),
      expect.objectContaining({ cwd: packageRoot, timeoutMs: 60_000 }),
    )
  })

  it.each([
    { label: 'missing', mode: undefined },
    { label: 'development', mode: 'development' },
    { label: 'unknown', mode: 'testing' },
    { label: 'null', mode: null },
  ])(
    'rejects a $label manifest mode before running binaries',
    async ({ mode }) => {
      const manifestPath = path.join(
        packageRoot,
        'dist',
        'sea',
        'manifest.generated.json',
      )
      const manifest = JSON.parse(
        await readFile(manifestPath, 'utf8'),
      ) as Record<string, unknown>
      if (mode === undefined) {
        delete manifest['mode']
      } else {
        manifest['mode'] = mode
      }
      await writeFile(manifestPath, JSON.stringify(manifest))
      await expect(
        verifyNativePackage({
          packageRoot,
          target: SEA_TARGETS[0]!,
          spawnProcess,
        }),
      ).rejects.toThrow('mode must be production')
      expect(spawnProcess).not.toHaveBeenCalled()
    },
  )

  it('rejects payload, binary, and launcher digest changes before spawning', async () => {
    await writeFile(path.join(packageRoot, 'dist', 'cli.js'), 'changed payload')
    await expect(
      verifyNativePackage({
        packageRoot,
        target: SEA_TARGETS[0]!,
        spawnProcess,
      }),
    ).rejects.toThrow()
    expect(spawnProcess).not.toHaveBeenCalled()

    await createPackageFixture()
    await writeFile(
      path.join(packageRoot, 'dist', 'sea', 'socket-linux-x64'),
      'changed binary',
    )
    await expect(
      verifyNativePackage({
        packageRoot,
        target: SEA_TARGETS[0]!,
        spawnProcess,
      }),
    ).rejects.toThrow()
    expect(spawnProcess).not.toHaveBeenCalled()

    await createPackageFixture()
    await writeFile(
      path.join(packageRoot, 'dist', 'socket-yarn.js'),
      'changed launcher',
    )
    await expect(
      verifyNativePackage({
        packageRoot,
        target: SEA_TARGETS[0]!,
        spawnProcess,
      }),
    ).rejects.toThrow()
    expect(spawnProcess).not.toHaveBeenCalled()
  })

  it('rejects an incorrect bin map or target set before spawning', async () => {
    await writeFile(
      path.join(packageRoot, 'package.json'),
      JSON.stringify({
        name: 'socket',
        bin: { ...packageBins, other: 'dist/other.js' },
      }),
    )
    await expect(
      verifyNativePackage({
        packageRoot,
        target: SEA_TARGETS[0]!,
        spawnProcess,
      }),
    ).rejects.toThrow()
    expect(spawnProcess).not.toHaveBeenCalled()

    await createPackageFixture()
    const manifestPath = path.join(
      packageRoot,
      'dist',
      'sea',
      'manifest.generated.json',
    )
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      payload: string
      binaries: Record<string, string>
      entrypoints: Record<string, string>
    }
    manifest.binaries['extra'] = '0'.repeat(64)
    await writeFile(manifestPath, JSON.stringify(manifest))
    await expect(
      verifyNativePackage({
        packageRoot,
        target: SEA_TARGETS[0]!,
        spawnProcess,
      }),
    ).rejects.toThrow()
    expect(spawnProcess).not.toHaveBeenCalled()
  })

  it('rejects symlinks in packaged files', async () => {
    const launcher = path.join(packageRoot, 'dist', 'socket.js')
    await rm(launcher)
    await symlink('socket-npm.js', launcher)
    await expect(
      verifyNativePackage({
        packageRoot,
        target: SEA_TARGETS[0]!,
        spawnProcess,
      }),
    ).rejects.toThrow()
    expect(spawnProcess).not.toHaveBeenCalled()
  })

  it.each([
    { name: 'nonzero exit', result: { ...successfulResult(), code: 1 } },
    {
      name: 'signal',
      result: { ...successfulResult(), signal: 'SIGTERM' as NodeJS.Signals },
    },
    {
      name: 'empty output',
      result: { ...successfulResult(), stdout: Buffer.alloc(0) },
    },
    { name: 'timeout', result: { ...successfulResult(), timedOut: true } },
    {
      name: 'output limit',
      result: { ...successfulResult(), outputLimitExceeded: true },
    },
  ])('rejects a smoke command with $name', async ({ result }) => {
    spawnProcess.mockResolvedValueOnce(result)
    await expect(
      verifyNativePackage({
        packageRoot,
        target: SEA_TARGETS[0]!,
        spawnProcess,
      }),
    ).rejects.toThrow()
  })
})
