import crypto from 'node:crypto'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { isMainModule } from '../../../fleet/process/is-main-module.mts'
import { runMain } from '../../../fleet/process/run-main.mts'
import { BINJECT_VERSION, NODE_SMOL_VERSION } from '../constants/sea-assets.mts'
import { fetchSeaAsset } from './assets.mts'
import { extractSmolRuntime } from './runtime.mts'
import {
  SEA_BUILD_DIR,
  SEA_ENTRY_PATH,
  SEA_ENTRYPOINT_PATHS,
  SEA_LAUNCHER_PATH,
  SEA_OUTPUT_DIR,
  SEA_PAYLOAD_PATH,
  SEA_RECEIPT_PATH,
  seaBinaryPath,
} from './paths.mts'
import { resolveSeaTarget, SEA_TARGETS } from './targets.mts'

const logger = getDefaultLogger()

export function createSeaEntry(payload: string): string {
  const encodedPayload = JSON.stringify(payload).replaceAll(
    'NODE_SEA_FUSE',
    'NODE_SEA_FU\\u0053E',
  )
  return `const path = require('node:path');\nconst { Module } = require('node:module');\nconst filename = path.resolve(path.dirname(process.env.SMOL_STUB_PATH || process.execPath), '..', 'cli.js');\nconst product = new Module(filename);\nproduct.filename = filename;\nproduct.paths = Module._nodeModulePaths(path.dirname(filename));\nproduct._compile(${encodedPayload}, filename);\nproduct.exports.runCliProduct();\n`
}

export function createSeaLauncher(): string {
  return `#!/usr/bin/env node\nconst { spawnSync } = require('node:child_process');\nconst path = require('node:path');\nconst target = process.platform + '-' + process.arch + (process.platform === 'linux' && !process.report.getReport().header.glibcVersionRuntime ? '-musl' : '');\nconst binary = path.join(__dirname, 'sea', 'socket-' + target + (process.platform === 'win32' ? '.exe' : ''));\nconst result = spawnSync(binary, process.argv.slice(2), { stdio: 'inherit', env: process.env });\nif (result.error) { console.error('Socket executable failed at ' + binary + ': ' + result.error.message + '. Reinstall socket.'); process.exitCode = 1; }\nelse if (result.signal) process.kill(process.pid, result.signal);\nelse process.exitCode = result.status ?? 1;\n`
}

export async function main(): Promise<void> {
  await mkdir(SEA_BUILD_DIR, { recursive: true })
  await mkdir(SEA_OUTPUT_DIR, { recursive: true })
  const payload = await readFile(SEA_PAYLOAD_PATH, 'utf8')
  await writeFile(SEA_ENTRY_PATH, createSeaEntry(payload))
  const host = resolveSeaTarget(
    process.platform,
    process.arch,
    (
      process.report.getReport() as {
        header: { glibcVersionRuntime?: string | undefined }
      }
    ).header.glibcVersionRuntime,
  )
  const arg = process.argv
    .find(value => value.startsWith('--target='))
    ?.slice(9)
  const selected = arg === 'host' ? host : arg
  if (selected && !(SEA_TARGETS as readonly string[]).includes(selected)) {
    throw new Error(
      `Invalid SEA target ${selected}. Use --target=host or a supported target.`,
    )
  }
  const targets = selected ? [selected] : [...SEA_TARGETS]
  const injector = await fetchSeaAsset(
    `binject-${BINJECT_VERSION}`,
    `binject-${host}${process.platform === 'win32' ? '.exe' : ''}`,
  )
  const hostBase = await fetchSeaAsset(
    `node-smol-${NODE_SMOL_VERSION}`,
    `node-${host.replace('win32-', 'win-')}${process.platform === 'win32' ? '.exe' : ''}`,
  )
  const receipt: Record<string, string> = {}
  for (const target of targets) {
    receipt[target] = await buildSeaTarget(target, injector, hostBase)
  }
  await writeFile(SEA_LAUNCHER_PATH, createSeaLauncher(), { mode: 0o755 })
  for (const mode of ['npm', 'npx', 'pnpm', 'yarn']) {
    await writeFile(
      SEA_ENTRYPOINT_PATHS[`socket-${mode}.js`]!,
      `#!/usr/bin/env node\nprocess.env.SOCKET_CLI_MODE = ${JSON.stringify(mode)};\nrequire('./socket.js');\n`,
      { mode: 0o755 },
    )
  }
  const entrypoints: Record<string, string> = {}
  for (const [name, file] of Object.entries(SEA_ENTRYPOINT_PATHS)) {
    entrypoints[name] = crypto
      .createHash('sha256')
      .update(await readFile(file))
      .digest('hex')
  }
  await writeFile(
    SEA_RECEIPT_PATH,
    JSON.stringify(
      {
        nodeSmol: NODE_SMOL_VERSION,
        payload: crypto.createHash('sha256').update(payload).digest('hex'),
        binaries: receipt,
        entrypoints,
      },
      null,
      2,
    ),
  )
  if (process.argv.includes('--json')) {
    logger.stdout.write(JSON.stringify({ ok: true, targets }) + '\n')
  } else {
    logger.log(`Built ${targets.length} Socket SEA executable(s).`)
  }
}

async function buildSeaTarget(
  target: string,
  injector: string,
  hostBase: string,
): Promise<string> {
  const asset = `node-${target.replace('win32-', 'win-')}${target.startsWith('win32-') ? '.exe' : ''}`
  const assetPath = await fetchSeaAsset(`node-smol-${NODE_SMOL_VERSION}`, asset)
  const runtime = extractSmolRuntime(await readFile(assetPath), target)
  const base = path.join(
    SEA_BUILD_DIR,
    `runtime-${target}${target.startsWith('win32-') ? '.exe' : ''}`,
  )
  await writeFile(base, runtime, { mode: 0o755 })
  const output = seaBinaryPath(target)
  const config = path.join(SEA_BUILD_DIR, `${target}.generated.json`)
  await writeFile(
    config,
    JSON.stringify({
      main: path.basename(SEA_ENTRY_PATH),
      output: `${target}.blob`,
      disableExperimentalSEAWarning: true,
      useCodeCache: false,
      useSnapshot: false,
      assets: {},
    }),
  )
  const blob = path.join(SEA_BUILD_DIR, `${target}.blob`)
  const generation = await spawn(
    hostBase,
    ['--experimental-sea-config', config],
    {
      cwd: SEA_BUILD_DIR,
      stdio: process.argv.includes('--json') ? 'pipe' : 'inherit',
      timeout: 60_000,
    },
  )
  if (generation.code !== 0) {
    throw new Error(
      `SEA blob generation failed for ${target}. Inspect node-smol output.`,
    )
  }
  if (target.startsWith('linux-')) {
    const { inject } = await import('postject')
    await copyFile(base, output)
    await inject(output, 'NODE_SEA_BLOB', await readFile(blob), {
      sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
    })
  } else {
    const result = await spawn(
      injector,
      [
        'inject',
        '--executable',
        base,
        '--output',
        output,
        '--sea',
        blob,
        '--vfs-compat',
        '--skip-repack',
      ],
      {
        stdio: process.argv.includes('--json') ? 'pipe' : 'inherit',
        timeout: 600_000,
      },
    )
    if (result.code !== 0) {
      throw new Error(
        `SEA build failed for ${target}: exit ${result.code}. Inspect binject output.`,
      )
    }
  }
  return crypto
    .createHash('sha256')
    .update(await readFile(output))
    .digest('hex')
}

if (isMainModule(import.meta.url)) {
  runMain(main, {
    describe: 'build the socket package SEA platform matrix',
    help: 'Usage: pnpm run build:sea [--target=host|TARGET]',
    json: 'native',
    heavyJob: 'build',
  })
}
