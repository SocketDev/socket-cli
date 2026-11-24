import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'

import crossSpawn from 'cross-spawn'

import { nativeOptionalDependencies, nativePackageName } from './packages.mts'
import { SEA_VERSION } from '../../src/sea/version.mts'
import {
  persistNativeSigningReceipt,
  prepareNativeTestBinary,
} from '../lib/apple-signing.mts'
import { isMainModule } from '../lib/is-main-module.mts'
import { runMain } from '../lib/run-main.mts'

const root = path.resolve(import.meta.dirname, '../..')
async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { out: { type: 'string' }, sea: { type: 'string' } },
  })
  const [kind] = positionals
  if (
    positionals.length !== 1 ||
    !['root', 'platform'].includes(kind ?? '') ||
    !values.out
  ) {
    throw new Error('Expected root or platform and --out <directory>.')
  }
  const output = path.resolve(values.out)
  await mkdir(output, { recursive: true })
  const stage = await mkdtemp(path.join(os.tmpdir(), 'socket-native-pack-'))
  try {
    const common = {
      version: SEA_VERSION,
      license: 'MIT',
      repository: {
        type: 'git',
        url: 'git+https://github.com/SocketDev/socket-cli.git',
      },
    }
    await copyFile(path.join(root, 'LICENSE'), path.join(stage, 'LICENSE'))
    let manifest
    if (kind === 'platform') {
      const { arch, platform } = process
      const name = nativePackageName(platform, arch)
      const triple = `${platform === 'win32' ? 'win' : platform}-${arch}`
      const source = path.resolve(values.sea ?? path.join(root, 'build/sea'))
      const receiptPath = path.join(source, `socket-${triple}.manifest.json`)
      const receiptText = await readFile(receiptPath, 'utf8')
      const receipt = JSON.parse(receiptText)
      const filename = platform === 'win32' ? 'socket.exe' : 'socket'
      const staged = path.join(stage, filename)
      await copyFile(
        path.join(
          source,
          `socket-${triple}${platform === 'win32' ? '.exe' : ''}`,
        ),
        staged,
      )
      const digest = createHash('sha256')
      for await (const chunk of createReadStream(staged)) {
        digest.update(chunk)
      }
      const sourceSha256 = digest.digest('hex')
      if (
        receipt.application?.name !== 'socket' ||
        receipt.application.version !== SEA_VERSION ||
        receipt.target?.triple !== triple ||
        receipt.target.os !== platform ||
        receipt.target.arch !== arch ||
        receipt.payloads?.find((p: { id: string }) => p.id === 'socket-vfs')
          ?.sha256 !== sourceSha256
      ) {
        throw new Error('SEA manifest does not match the native package.')
      }
      await chmod(staged, 0o755)
      const signing = await prepareNativeTestBinary({
        binaryPath: staged,
        sourceSha256,
      })
      await persistNativeSigningReceipt(
        signing,
        path.join(stage, 'signing.json'),
      )
      await writeFile(path.join(stage, 'manifest.json'), receiptText)
      manifest = {
        ...common,
        name,
        os: [platform],
        cpu: [arch],
        ...(platform === 'linux' ? { libc: ['glibc'] } : {}),
        files: [filename, 'manifest.json', 'signing.json'],
      }
    } else {
      const launcher = await readFile(
        path.join(import.meta.dirname, 'native-launcher.cjs'),
        'utf8',
      )
      await writeFile(
        path.join(stage, 'socket.cjs'),
        '#!/usr/bin/env node\n' + launcher,
      )
      await chmod(path.join(stage, 'socket.cjs'), 0o755)
      manifest = {
        ...common,
        name: 'socket',
        bin: { socket: 'socket.cjs' },
        optionalDependencies: nativeOptionalDependencies(SEA_VERSION),
      }
    }
    await writeFile(
      path.join(stage, 'package.json'),
      JSON.stringify(manifest, null, 2) + '\n',
    )
    // Keep pnpm pack here: it rejects CRLF shebangs that would break CLI startup on Unix.
    const result = crossSpawn.sync(
      'pnpm',
      ['pack', '--pack-destination', output],
      { cwd: stage, stdio: 'inherit' },
    )
    if (result.error) {
      throw result.error
    }
    if (result.status !== 0) {
      throw new Error('pnpm pack failed.')
    }
  } finally {
    await rm(stage, { recursive: true, force: true })
  }
}
if (isMainModule(import.meta.url)) {
  runMain(main, {
    describe: 'packs the native RC launcher or the host SEA package',
    help: 'Usage: pnpm run pack:native <root|platform> --out <directory> [--sea <directory>]',
  })
}
