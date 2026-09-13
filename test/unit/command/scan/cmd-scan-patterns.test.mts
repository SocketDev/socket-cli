import { beforeEach, expect, it, vi } from 'vitest'

import {
  createScannerPatternCommand,
  parseScannerPatternSeverity,
} from '../../../../src/command/scan/cmd-scan-patterns.mts'

const mocks = vi.hoisted(() => ({
  log: vi.fn(),
  parse: vi.fn(),
  scan: vi.fn(),
}))

vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => ({ log: mocks.log }),
}))
vi.mock(import('../../../../src/util/cli/with-subcommands.mts'), () => ({
  meowOrExit: mocks.parse,
}))
vi.mock(import('../../../../src/core/scanner-patterns/scan.mts'), () => ({
  scanWithScannerPatterns: mocks.scan,
}))

beforeEach(() => {
  vi.clearAllMocks()
  process.exitCode = undefined
  mocks.parse.mockReturnValue({
    flags: { json: false, minimumSeverity: 'medium' },
    input: ['example-project'],
  })
  mocks.scan.mockResolvedValue({
    filesScanned: 2,
    findings: [],
    scanner: 'secrets',
    unsupportedRules: [],
  })
})

it('runs a scanner command with the selected threshold', async () => {
  const command = createScannerPatternCommand(
    'secrets',
    'secrets',
    'Scan secrets',
  )
  await command.run([], import.meta, { parentName: 'socket scan' })
  expect(mocks.scan).toHaveBeenCalledWith('secrets', ['example-project'], {
    minimumSeverity: 'medium',
  })
  expect(mocks.log).toHaveBeenCalledWith(
    'Scanned 2 files. Found 0 findings. 0 rules are unsupported by this scanner.',
  )
  expect(process.exitCode).toBeUndefined()
})

it('emits JSON and fails when findings exist', async () => {
  mocks.parse.mockReturnValue({
    flags: { json: true, minimumSeverity: 'info' },
    input: [],
  })
  mocks.scan.mockResolvedValue({
    filesScanned: 1,
    findings: [{ ruleId: 'example:credential' }],
    scanner: 'secrets',
    unsupportedRules: [{ id: 'example:re2' }],
  })
  const command = createScannerPatternCommand(
    'secrets',
    'secrets',
    'Scan secrets',
  )
  await command.run([], import.meta, { parentName: 'socket scan' })
  expect(JSON.parse(mocks.log.mock.calls[0]![0])).toMatchObject({
    filesScanned: 1,
    scanner: 'secrets',
  })
  expect(process.exitCode).toBe(1)
})

it('validates severity names', () => {
  expect(parseScannerPatternSeverity('critical')).toBe('critical')
  expect(() => parseScannerPatternSeverity('urgent')).toThrow()
})
