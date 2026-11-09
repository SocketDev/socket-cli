import { spawnSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { isMainModule } from '../lib/is-main-module.mts'
import { runMain } from '../lib/run-main.mts'

import type { ScriptMeta } from '../lib/run-main.mts'
import type { SpawnSyncOptions } from 'node:child_process'

const ROOT = path.resolve(import.meta.dirname, '../..')
const ISOLATED_ENV_KEYS = [
  'HOME',
  'USERPROFILE',
  'LOCALAPPDATA',
  'APPDATA',
  'XDG_CACHE_HOME',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'npm_config_cache',
  'npm_config_cache_dir',
  'npm_config_store_dir',
  'npm_config_userconfig',
  'npm_config_globalconfig',
  'PNPM_HOME',
  'TMPDIR',
  'TMP',
  'TEMP',
] as const

function run(
  command: string,
  args: readonly string[],
  options: SpawnSyncOptions = {},
): void {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env: process.env,
    stdio: 'inherit',
    ...options,
  })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status}`)
  }
}

function runPnpm(args: readonly string[]): void {
  const pnpmScript = process.env['npm_execpath']
  if (pnpmScript && path.isAbsolute(pnpmScript)) {
    if (/\.[cm]?js$/i.test(pnpmScript)) {
      run(process.execPath, [pnpmScript, ...args])
    } else {
      run(pnpmScript, args)
    }
    return
  }
  run(
    process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    args,
    process.platform === 'win32' ? { shell: true } : {},
  )
}

async function isolateCaches(stageDir: string): Promise<void> {
  const home = path.join(stageDir, 'home')
  const directories = {
    HOME: home,
    USERPROFILE: home,
    LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
    APPDATA: path.join(home, 'AppData', 'Roaming'),
    XDG_CACHE_HOME: path.join(stageDir, 'xdg-cache'),
    XDG_CONFIG_HOME: path.join(stageDir, 'xdg-config'),
    XDG_DATA_HOME: path.join(stageDir, 'xdg-data'),
    npm_config_cache: path.join(stageDir, 'npm-cache'),
    npm_config_cache_dir: path.join(stageDir, 'pnpm-cache'),
    npm_config_store_dir: path.join(stageDir, 'pnpm-store'),
    npm_config_userconfig: path.join(stageDir, 'npmrc'),
    npm_config_globalconfig: path.join(stageDir, 'global-npmrc'),
    PNPM_HOME: path.join(stageDir, 'pnpm-home'),
    TMPDIR: path.join(stageDir, 'tmp'),
    TMP: path.join(stageDir, 'tmp'),
    TEMP: path.join(stageDir, 'tmp'),
  }
  for (const [key, value] of Object.entries(directories)) {
    process.env[key] = value
  }
  await Promise.all(
    Object.values(directories)
      .filter(value => !value.endsWith('npmrc'))
      .map(directory => fs.mkdir(directory, { recursive: true })),
  )
  await Promise.all([
    fs.writeFile(directories.npm_config_userconfig, ''),
    fs.writeFile(directories.npm_config_globalconfig, ''),
  ])
}

async function main(): Promise<number> {
  const vitestArgs = process.argv.slice(2)
  const stageDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'socket-integration-test-'),
  )
  const previousEnv = Object.fromEntries(
    ISOLATED_ENV_KEYS.map(key => [key, process.env[key]]),
  ) as Record<(typeof ISOLATED_ENV_KEYS)[number], string | undefined>

  try {
    // The package matrix leaves a legacy package's dist behind; integration
    // coverage must always exercise the current root package build.
    runPnpm(['build:dist'])
    await isolateCaches(stageDir)
    runPnpm([
      'exec',
      'dotenvx',
      '-q',
      'run',
      '-f',
      '.env.test',
      '--',
      'vitest',
      'run',
      '--config',
      '.config/vitest.integration.config.mts',
      ...vitestArgs,
    ])
    return 0
  } finally {
    for (const key of ISOLATED_ENV_KEYS) {
      const value = previousEnv[key]
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
    await fs.rm(stageDir, { recursive: true, force: true })
  }
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'builds the root distribution and runs serialized CLI integration tests',
  help: `Usage: pnpm run integration-tests [vitest options]

  Builds the root Socket package first, then runs process-level integration
  tests serially with isolated npm, pnpm, and Socket configuration caches.

  Pass Vitest options after the script name to filter tests.`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
