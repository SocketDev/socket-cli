import path from 'node:path'
import { beforeEach, expect, it, vi } from 'vitest'

import { run } from '../../../../src/command/manifest/cmd-manifest-sdxgen.mts'

const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  parse: vi.fn(),
  write: vi.fn(),
  log: vi.fn(),
  dryRun: vi.fn(),
}))

vi.mock(import('../../../../src/core/sdxgen/generate.mts'), () => ({
  generateSdxgenManifest: mocks.generate,
}))
vi.mock(import('../../../../src/util/cli/with-subcommands.mts'), () => ({
  meowOrExit: mocks.parse,
}))
vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => ({ log: mocks.log }),
}))
vi.mock(import('node:fs/promises'), () => ({ writeFile: mocks.write }))
vi.mock(import('../../../../src/util/dry-run/output.mts'), () => ({
  outputDryRunExecute: mocks.dryRun,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.generate.mockResolvedValue({
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
  })
  mocks.parse.mockReturnValue({
    input: [],
    flags: { executeTools: false, recursive: false, out: '' },
  })
})

it('writes JSON to stdout by default with execution disabled', async () => {
  await run([], import.meta, { parentName: 'socket manifest' })
  expect(mocks.generate).toHaveBeenCalledWith(path.resolve('.'), {
    executeTools: false,
    recursive: false,
  })
  expect(JSON.parse(mocks.log.mock.calls[0]![0])).toEqual({
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
  })
  expect(mocks.write).not.toHaveBeenCalled()
  const parsedConfig = mocks.parse.mock.calls[0]![0].config
  expect(parsedConfig.help('socket manifest sdxgen')).toContain(
    '--execute-tools',
  )
})

it('writes the requested output and forwards explicit build execution', async () => {
  mocks.parse.mockReturnValue({
    input: ['example-project'],
    flags: { executeTools: true, recursive: true, out: 'example-sbom.json' },
  })
  await run([], import.meta, { parentName: 'socket manifest' })
  expect(mocks.generate).toHaveBeenCalledWith(path.resolve('example-project'), {
    executeTools: true,
    recursive: true,
  })
  expect(mocks.write).toHaveBeenCalledWith(
    path.resolve('example-sbom.json'),
    expect.any(String),
    'utf8',
  )
  expect(mocks.log).not.toHaveBeenCalled()
})

it('propagates generation failures without writing output', async () => {
  const failure = new Error('fixture parser failed')
  mocks.generate.mockRejectedValue(failure)
  await expect(
    run([], import.meta, { parentName: 'socket manifest' }),
  ).rejects.toBe(failure)
  expect(mocks.write).not.toHaveBeenCalled()
  expect(mocks.log).not.toHaveBeenCalled()
})

it('does not generate or write in dry-run mode, even with execution enabled', async () => {
  mocks.parse.mockReturnValue({
    input: [],
    flags: { dryRun: true, executeTools: true, out: 'example-sbom.json' },
  })
  await run(['--dry-run', '--execute-tools'], import.meta, {
    parentName: 'socket manifest',
  })
  expect(mocks.dryRun).toHaveBeenCalledOnce()
  expect(mocks.generate).not.toHaveBeenCalled()
  expect(mocks.write).not.toHaveBeenCalled()
})
