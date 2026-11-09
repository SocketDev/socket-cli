import { spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { SpawnSyncOptions } from 'node:child_process'

export type SigningReceipt = {
  mode: 'unsigned-local' | 'unsigned-ci' | 'developer-id'
  sourceSha256: string
  stagedSha256: string
  teamId?: string
  authority?: string
}

export async function persistNativeSigningReceipt(
  receipt: SigningReceipt,
  receiptPath: string,
): Promise<void> {
  const safeReceipt = {
    mode: receipt.mode,
    sourceSha256: receipt.sourceSha256,
    stagedSha256: receipt.stagedSha256,
  }
  await fs.mkdir(path.dirname(receiptPath), { recursive: true })
  await fs.writeFile(receiptPath, `${JSON.stringify(safeReceipt)}\n`, {
    mode: 0o600,
  })
}
type CommandResult = {
  status: number | null
  stdout: string
  stderr: string
  error?: Error
}
type Runner = (
  command: string,
  args: readonly string[],
  options?: SpawnSyncOptions,
) => CommandResult
const run: Runner = (command, args, options = {}) => {
  const result = spawnSync(command, [...args], {
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 65_536,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  })
  return {
    status: result.status,
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? ''),
    ...(result.error ? { error: result.error } : {}),
  }
}
const digest = async (file: string) =>
  createHash('sha256')
    .update(await fs.readFile(file))
    .digest('hex')
const genericFailure = (
  command: string,
  args: readonly string[],
  result: CommandResult,
) => {
  if (result.error) {
    throw new Error(`${command} ${args[0] ?? ''} could not run.`)
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args[0] ?? ''} failed.`)
  }
}

function safeCodesignFailure(
  args: readonly string[],
  result: CommandResult,
  secretValues: readonly string[],
): Error {
  let diagnostic = result.stderr || result.stdout
  for (const secret of secretValues) {
    if (secret.length > 0) {
      diagnostic = diagnostic.replaceAll(secret, '[REDACTED]')
    }
  }
  diagnostic = Array.from(diagnostic)
    .filter(character => {
      const code = character.charCodeAt(0)
      return code >= 0x20 && code !== 0x7f
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1200)
  const status =
    result.status === null ? 'no exit status' : `exit ${result.status}`
  return new Error(
    `codesign ${args[0] ?? 'command'} failed (${status})${diagnostic ? `: ${diagnostic}` : '.'}`,
  )
}

export async function prepareNativeTestBinary(options: {
  binaryPath: string
  sourceSha256: string
  platform?: string
  env?: NodeJS.ProcessEnv
  runner?: Runner
}): Promise<SigningReceipt> {
  const { binaryPath, sourceSha256 } = options
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const runner = options.runner ?? run
  if ((await digest(binaryPath)) !== sourceSha256) {
    throw new Error('Staged native binary changed before signing.')
  }
  const identity = env['APPLE_DEVELOPER_ID_IDENTITY']?.trim()
  const teamId = env['APPLE_TEAM_ID']?.trim()
  const certificate = env['APPLE_DEVELOPER_ID_APPLICATION_CERTS_P12']
  const password = env['APPLE_DEVELOPER_ID_APPLICATION_CERTS_P12_PASS']
  const configured = Boolean(identity || teamId || certificate || password)
  const required = env['SOCKET_CLI_NATIVE_TEST_REQUIRE_APPLE_SIGNATURE'] === '1'
  if (configured && (!teamId || !certificate?.trim() || !password?.trim())) {
    throw new Error(
      'Apple signing credentials are incomplete (APPLE_DEVELOPER_ID_APPLICATION_CERTS_P12, APPLE_DEVELOPER_ID_APPLICATION_CERTS_P12_PASS, and APPLE_TEAM_ID are required).',
    )
  }
  if (required && !configured) {
    throw new Error('Required Apple signing credentials are missing.')
  }
  if (!configured) {
    return {
      mode:
        env['CI'] === 'true' || env['CI'] === '1'
          ? 'unsigned-ci'
          : 'unsigned-local',
      sourceSha256,
      stagedSha256: sourceSha256,
    }
  }
  if (platform !== 'darwin') {
    throw new Error(
      'Apple signing credentials were configured on a non-macOS host.',
    )
  }
  if (!/^[A-Z0-9]{10}$/.test(teamId!)) {
    throw new Error('APPLE_TEAM_ID is invalid.')
  }

  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'socket-native-sign-'),
  )
  await fs.chmod(tempDir, 0o700)
  const keychain = path.join(tempDir, 'signing.keychain-db')
  const p12Path = path.join(tempDir, 'certificate.p12')
  const entitlementsPath = path.join(tempDir, 'entitlements.plist')
  const keychainPassword = randomBytes(32).toString('base64url')
  const commandEnv = { ...env }
  for (const key of Object.keys(commandEnv)) {
    if (/^APPLE_/.test(key)) {
      delete commandEnv[key]
    }
  }
  const invoke = (command: string, args: string[]) =>
    runner(command, args, {
      env: commandEnv,
      timeout: 120_000,
      maxBuffer: 65_536,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  let keychainCreated = false
  let keychainSearchListChanged = false
  let originalKeychains: string[] = []
  let authority = ''
  let signingError: Error | undefined
  try {
    await fs.writeFile(p12Path, Buffer.from(certificate!, 'base64'), {
      mode: 0o600,
    })
    await fs.writeFile(
      entitlementsPath,
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
        '<plist version="1.0"><dict>',
        '<key>com.apple.security.cs.allow-jit</key><true/>',
        '<key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>',
        '</dict></plist>',
      ].join('\n'),
      { mode: 0o600 },
    )
    const originalListArgs = ['list-keychains', '-d', 'user']
    const originalList = invoke('security', originalListArgs)
    genericFailure('security', originalListArgs, originalList)
    originalKeychains = [
      ...originalList.stdout.matchAll(/^\s*"([^"]+)"\s*$/gm),
    ].map(match => match[1]!)
    if (originalList.stdout.trim() && originalKeychains.length === 0) {
      throw new Error(
        'Could not parse the original Apple keychain search list.',
      )
    }
    keychainSearchListChanged = true
    const createArgs = ['create-keychain', '-p', keychainPassword, keychain]
    const create = invoke('security', createArgs)
    genericFailure('security', createArgs, create)
    keychainCreated = true
    for (const args of [
      ['unlock-keychain', '-p', keychainPassword, keychain],
      ['set-keychain-settings', '-lut', '3600', keychain],
      [
        'import',
        p12Path,
        '-k',
        keychain,
        '-P',
        password!,
        '-T',
        '/usr/bin/codesign',
      ],
      [
        'set-key-partition-list',
        '-S',
        'apple-tool:,apple:,codesign:',
        '-s',
        '-k',
        keychainPassword,
        keychain,
      ],
    ]) {
      genericFailure('security', args, invoke('security', args))
    }
    const findArgs = ['find-identity', '-v', '-p', 'codesigning', keychain]
    const list = invoke('security', findArgs)
    genericFailure('security', findArgs, list)
    const rows = [
      ...list.stdout.matchAll(
        /^\s*\d+\)\s+([A-Fa-f0-9]{40})\s+"([^"]+)"\s*$/gm,
      ),
    ]
      .map(([, hash, name]) => ({ hash: hash!, name: name! }))
      .filter(
        row =>
          row.name.startsWith('Developer ID Application: ') &&
          row.name.endsWith(`(${teamId})`),
      )
    if (!identity && rows.length !== 1) {
      throw new Error(
        'Temporary keychain does not contain one unambiguous Developer ID identity.',
      )
    }
    const candidates = identity
      ? rows.filter(
          row =>
            row.hash.toLowerCase() === identity.toLowerCase() ||
            row.name === identity,
        )
      : rows
    if (candidates.length !== 1) {
      throw new Error(
        'Configured Developer ID identity is unavailable or ambiguous in temporary keychain.',
      )
    }
    const selected = candidates[0]!
    const searchListArgs = [
      'list-keychains',
      '-d',
      'user',
      '-s',
      keychain,
      ...originalKeychains,
    ]
    genericFailure(
      'security',
      searchListArgs,
      invoke('security', searchListArgs),
    )
    const signArgs = [
      '--force',
      '--sign',
      selected.hash,
      '--keychain',
      keychain,
      '--options',
      'runtime',
      '--entitlements',
      entitlementsPath,
      '--timestamp',
      binaryPath,
    ]
    const signed = invoke('codesign', signArgs)
    if (signed.error || signed.status !== 0) {
      throw safeCodesignFailure(signArgs, signed, [
        keychainPassword,
        password!,
        certificate!,
        identity ?? '',
        teamId!,
      ])
    }
    const verifyArgs = ['--verify', '--strict', binaryPath]
    genericFailure('codesign', verifyArgs, invoke('codesign', verifyArgs))
    const displayArgs = [
      '--display',
      '--verbose=4',
      '--entitlements',
      ':-',
      binaryPath,
    ]
    const display = invoke('codesign', displayArgs)
    genericFailure('codesign', displayArgs, display)
    const evidence = `${display.stdout}\n${display.stderr}`
    authority =
      evidence.match(/^Authority=(Developer ID Application: .+)$/m)?.[1] ?? ''
    const signedTeam = evidence.match(/^TeamIdentifier=(.+)$/m)?.[1]
    const runtime = /^CodeDirectory .*flags=.*\(.*runtime.*\)/m.test(evidence)
    const hasJit =
      /<key>com\.apple\.security\.cs\.allow-jit<\/key>\s*<true\s*\/>/.test(
        evidence,
      )
    const hasUnsignedMemory =
      /<key>com\.apple\.security\.cs\.allow-unsigned-executable-memory<\/key>\s*<true\s*\/>/.test(
        evidence,
      )
    if (
      /^Signature=adhoc$/m.test(evidence) ||
      authority !== selected.name ||
      signedTeam !== teamId ||
      !runtime ||
      !hasJit ||
      !hasUnsignedMemory
    ) {
      throw new Error(
        'Native binary does not have the configured hardened Developer ID Application signature.',
      )
    }
  } catch (error) {
    signingError = error instanceof Error ? error : new Error(String(error))
  }

  let cleanupError: Error | undefined
  if (keychainSearchListChanged) {
    try {
      const args = ['list-keychains', '-d', 'user', '-s', ...originalKeychains]
      const result = invoke('security', args)
      if (result.error || result.status !== 0) {
        cleanupError = new Error(
          'Could not restore the Apple keychain search list.',
        )
      }
    } catch {
      cleanupError = new Error(
        'Could not restore the Apple keychain search list.',
      )
    }
  }
  if (keychainCreated) {
    try {
      const args = ['delete-keychain', keychain]
      const result = invoke('security', args)
      if (result.error || result.status !== 0) {
        cleanupError ??= new Error(
          'Could not delete temporary Apple signing keychain.',
        )
      }
    } catch {
      cleanupError ??= new Error(
        'Could not delete temporary Apple signing keychain.',
      )
    }
  }
  try {
    await fs.rm(tempDir, { recursive: true, force: true })
  } catch {
    cleanupError ??= new Error(
      'Could not remove temporary Apple signing files.',
    )
  }
  if (signingError && cleanupError) {
    throw new AggregateError(
      [signingError, cleanupError],
      'Apple signing failed and temporary signing resources could not be fully cleaned up.',
    )
  }
  if (signingError) {
    throw signingError
  }
  if (cleanupError) {
    throw cleanupError
  }
  return {
    mode: 'developer-id',
    sourceSha256,
    stagedSha256: await digest(binaryPath),
    teamId: teamId!,
    authority,
  }
}
