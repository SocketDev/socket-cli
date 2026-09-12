import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { mkdtempSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { whichSync } from '@socketsecurity/lib-stable/exe/path/which'
import {
  safeDeleteSync,
  safeMkdirSync,
} from '@socketsecurity/lib-stable/fs/safe'
import { isMainModule } from '../../../scripts/fleet/process/is-main-module.mts'
import { runMain } from '../../../scripts/fleet/process/run-main.mts'
import type { ScriptMeta } from '../../../scripts/fleet/process/run-main.mts'

type SchemaMode = 'check' | 'update'
interface SchemaProcessConfig {
  cwd: string
  env: NodeJS.ProcessEnv
}
interface SchemaRunOptions {
  packageRoot?: string | undefined
  findBin?: ((searchPath: string) => unknown) | undefined
  execute?:
    | ((
        bin: string,
        args: string[],
        config: SchemaProcessConfig,
      ) => { status: number | null; error?: Error | undefined })
    | undefined
}

export function createSchemaEnv(
  source: NodeJS.ProcessEnv,
  home: string,
): NodeJS.ProcessEnv {
  return {
    PATH: [
      path.dirname(process.execPath),
      ...(process.platform === 'win32'
        ? [path.join(source.SystemRoot ?? 'C:\\Windows', 'System32')]
        : ['/usr/bin', '/bin']),
    ].join(path.delimiter),
    SystemRoot: source.SystemRoot,
    WINDIR: source.WINDIR,
    COMSPEC: source.COMSPEC,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: home,
    XDG_CACHE_HOME: home,
    XDG_DATA_HOME: home,
    TMPDIR: home,
    TMP: home,
    TEMP: home,
    SOCKET_HOME: home,
    SOCKET_CLI_SKIP_UPDATE_CHECK: '1',
  }
}

export function buildSchemaArgs(mode: SchemaMode): string[] {
  return [
    mode === 'check' ? 'check' : 'introspect',
    '--command',
    process.execPath,
    '--arg',
    'dist/index.js',
    '--arg',
    'mcp',
    '--arg=--config',
    '--arg',
    '{}',
    '--env',
    'SOCKET_API_TOKEN=YOUR_API_TOKEN',
    '--env',
    'MCP_HTTP_MODE=false',
    '--timeout',
    '10000',
    ...(mode === 'check'
      ? ['--against', 'test/integration/mcp-schema.golden.json']
      : ['--json', '--out', 'test/integration/mcp-schema.golden.json']),
  ]
}

function findSchemaBin(searchPath: string): unknown {
  return whichSync('mcp-tada', { path: searchPath, nothrow: true })
}

function executeSchema(
  bin: string,
  args: string[],
  config: SchemaProcessConfig,
) {
  return spawnSync(bin, args, { ...config, stdio: 'inherit', timeout: 30_000 })
}

export function runSchema(
  mode: SchemaMode,
  options: SchemaRunOptions = {},
): void {
  const packageRoot =
    options.packageRoot ?? path.resolve(import.meta.dirname, '..')
  const searchPath = path.join(packageRoot, 'node_modules', '.bin')
  const bin = (options.findBin ?? findSchemaBin)(searchPath)
  if (typeof bin !== 'string' || bin.length === 0) {
    throw new Error(
      `MCP schema tool missing at ${searchPath}; expected one mcp-tada executable. Run pnpm install --frozen-lockfile.`,
    )
  }
  const cache = path.join(packageRoot, '.cache', 'mcp-schema')
  safeMkdirSync(cache)
  const home = mkdtempSync(path.join(cache, 'home-'))
  try {
    const result = (options.execute ?? executeSchema)(
      bin,
      buildSchemaArgs(mode),
      {
        cwd: packageRoot,
        env: createSchemaEnv(process.env, home),
      },
    )
    if (result.error) {
      throw result.error
    }
    if (result.status !== 0) {
      throw new Error(
        `MCP schema ${mode} failed at ${packageRoot}; saw exit ${result.status}, expected 0. Inspect the mcp-tada output.`,
      )
    }
  } finally {
    safeDeleteSync(home)
  }
}

export function main(): void {
  const mode = process.argv[2]
  if (mode !== 'check' && mode !== 'update') {
    throw new Error(
      'Invalid MCP schema mode in arguments; expected check or update. Run with --help.',
    )
  }
  runSchema(mode)
}
const SCRIPT_META: ScriptMeta = {
  describe:
    'validate or update built MCP tool names and input/output schemas in an isolated home',
  help: 'Usage: node scripts/mcp-schema.mts <check|update>',
  json: 'result',
}
if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
