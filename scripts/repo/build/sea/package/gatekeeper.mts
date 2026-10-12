import path from 'node:path'

import { spawnNativePackageProcess } from './process.mts'
import type {
  NativePackageProcessResult,
  NativePackageSpawnProcess,
} from './process.mts'

const COMMAND_TIMEOUT_MS = 30_000
const MAX_CAPTURE_BYTES = 16 * 1024
export const DARWIN_PACKAGE_QUARANTINE_VALUE =
  '0081;00000000;Socket Gatekeeper;'

export type DarwinPackageQualificationErrorCode =
  | 'ERR_DARWIN_QUALIFICATION_PLATFORM'
  | 'ERR_DARWIN_QUALIFICATION_COMMAND'
  | 'ERR_DARWIN_QUALIFICATION_QUARANTINE'

const ERROR_MESSAGES: Record<DarwinPackageQualificationErrorCode, string> = {
  ERR_DARWIN_QUALIFICATION_COMMAND:
    'Darwin host qualification failed. Where: codesign, xattr, or spctl. Saw a command failure; wanted a clean exit without timeout, signal, or output overflow. Fix: inspect the host signing and Gatekeeper tools.',
  ERR_DARWIN_QUALIFICATION_PLATFORM:
    'Darwin host qualification failed. Where: host platform. Saw a non-Darwin host; wanted macOS. Fix: qualify the artifact on macOS.',
  ERR_DARWIN_QUALIFICATION_QUARANTINE:
    'Darwin host qualification failed. Where: com.apple.quarantine. Saw a different value; wanted exact readback. Fix: check xattr support and retry.',
}

export class DarwinPackageQualificationError extends Error {
  readonly code: DarwinPackageQualificationErrorCode

  constructor(code: DarwinPackageQualificationErrorCode) {
    super(ERROR_MESSAGES[code])
    this.code = code
  }
}

function assertDarwinCommandSucceeded(
  result: NativePackageProcessResult,
): void {
  if (
    result.code !== 0 ||
    result.signal !== null ||
    result.timedOut === true ||
    result.outputLimitExceeded === true
  ) {
    throw new DarwinPackageQualificationError(
      'ERR_DARWIN_QUALIFICATION_COMMAND',
    )
  }
}

export async function qualifyDarwinPackageArtifact(config: {
  artifactPath: string
  platform?: NodeJS.Platform | undefined
  spawnProcess?: NativePackageSpawnProcess | undefined
}): Promise<void> {
  const opts = { __proto__: null, ...config } as typeof config
  if ((opts.platform ?? process.platform) !== 'darwin') {
    throw new DarwinPackageQualificationError(
      'ERR_DARWIN_QUALIFICATION_PLATFORM',
    )
  }
  const artifactPath = path.resolve(opts.artifactPath)
  const spawnProcess = opts.spawnProcess ?? spawnNativePackageProcess
  const commands = [
    ['codesign', ['--verify', '--strict', '--verbose=2', artifactPath]],
    [
      'xattr',
      [
        '-w',
        'com.apple.quarantine',
        DARWIN_PACKAGE_QUARANTINE_VALUE,
        artifactPath,
      ],
    ],
    ['xattr', ['-p', 'com.apple.quarantine', artifactPath]],
    ['spctl', ['--assess', '--type', 'execute', '--verbose=2', artifactPath]],
  ] as const

  for (let index = 0; index < commands.length; index += 1) {
    const { 0: command, 1: args } = commands[index]!
    const result = await spawnProcess(command, args, {
      cwd: path.dirname(artifactPath),
      timeoutMs: COMMAND_TIMEOUT_MS,
      maxOutputBytes: MAX_CAPTURE_BYTES,
    })
    assertDarwinCommandSucceeded(result)
    if (index === 2) {
      const output = result.stdout.toString('utf8')
      const quarantine = output.endsWith('\n') ? output.slice(0, -1) : output
      if (quarantine !== DARWIN_PACKAGE_QUARANTINE_VALUE) {
        throw new DarwinPackageQualificationError(
          'ERR_DARWIN_QUALIFICATION_QUARANTINE',
        )
      }
    }
  }
}
