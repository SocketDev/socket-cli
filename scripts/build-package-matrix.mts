#!/usr/bin/env node
/* eslint-disable no-await-in-loop -- Package variants and staged files must be processed serially. */
import { spawnSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

import crossSpawn from 'cross-spawn'
import semver from 'semver'
import { parse as parseYaml } from 'yaml'

import { isMainModule } from './lib/is-main-module.mts'
import { type ScriptMeta, runMain } from './lib/run-main.mts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_OUTPUT = path.join(ROOT, 'build/package-matrix')
const PRE_RELEASE_PREFIX = '2.1.0-pre-release.'
const VARIANTS = [
  { expectedName: 'socket', version: '1.14.1' },
  { expectedName: 'socket' },
  {
    expectedName: '@socketsecurity/cli',
    version: '1.14.1',
    env: { INLINED_SOCKET_CLI_LEGACY_BUILD: '1' },
  },
  {
    expectedName: '@socketsecurity/cli-with-sentry',
    version: '1.14.1',
    env: { INLINED_SOCKET_CLI_SENTRY_BUILD: '1' },
  },
] as const

type Variant = {
  expectedName: string
  version: string
  artifact: string
  env?: Record<string, string>
}

export function currentPrereleaseVersion(version: string): string {
  const parsed = semver.parse(version)
  if (
    !parsed ||
    parsed.major !== 2 ||
    parsed.minor !== 1 ||
    parsed.patch !== 0 ||
    parsed.prerelease[0] !== 'pre-release' ||
    parsed.prerelease.length !== 2 ||
    !Number.isInteger(parsed.prerelease[1])
  ) {
    throw new Error(
      `Expected package.json version ${PRE_RELEASE_PREFIX}<number>; found ${version}`,
    )
  }
  return parsed.version
}

export function makeVariants(version: string): Variant[] {
  return VARIANTS.map(variant => {
    const resolvedVersion = 'version' in variant ? variant.version : version
    return {
      ...variant,
      version: resolvedVersion,
      artifact: `${variant.expectedName.replaceAll('/', '-')}-${resolvedVersion}.tgz`,
    }
  })
}

export function updateRootManifest(raw: string, version: string): string {
  const manifest = JSON.parse(raw) as { name?: string; version?: string }
  if (!manifest.name || !manifest.version) {
    throw new Error('Root manifest is missing name or version')
  }
  const updated = raw
    .replace(/^ {2}"name": "[^"]+",$/m, '  "name": "socket",')
    .replace(/^ {2}"version": "[^"]+",$/m, `  "version": "${version}",`)
  const checked = JSON.parse(updated) as { name: string; version: string }
  if (checked.name !== 'socket' || checked.version !== version) {
    throw new Error(
      'Could not set root package name and version for this build',
    )
  }
  return updated
}

export function validatePrivateVirtualStore(
  workspace: string,
  virtualStoreDir: unknown,
): void {
  if (typeof virtualStoreDir !== 'string') {
    throw new Error('pnpm did not report its virtual store directory')
  }
  const actual = path.resolve(workspace, 'node_modules', virtualStoreDir)
  const expected = path.resolve(workspace, 'node_modules/.pnpm')
  if (actual !== expected) {
    throw new Error(
      `pnpm virtual store escaped the private workspace: ${actual}`,
    )
  }
}

export function createPrivatePnpmEnvironment(
  workspace: string,
  source: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const privateKeys = new Set([
    'npm_config_enable_global_virtual_store',
    'npm_config_virtual_store_dir',
    'pnpm_config_enable_global_virtual_store',
    'pnpm_config_virtual_store_dir',
  ])
  const environment = Object.fromEntries(
    Object.entries(source).filter(
      ([key]) => !privateKeys.has(key.toLowerCase()),
    ),
  )
  return {
    ...environment,
    npm_config_enable_global_virtual_store: 'false',
    npm_config_virtual_store_dir: path.join(workspace, 'node_modules/.pnpm'),
    pnpm_config_enable_global_virtual_store: 'false',
    pnpm_config_virtual_store_dir: path.join(workspace, 'node_modules/.pnpm'),
  }
}

export async function verifyPrivateVirtualStore(
  workspace: string,
): Promise<void> {
  const modulesPath = path.join(workspace, 'node_modules/.modules.yaml')
  const modules = parseYaml(await fs.readFile(modulesPath, 'utf8')) as {
    virtualStoreDir?: unknown
  }
  validatePrivateVirtualStore(workspace, modules.virtualStoreDir)
}

export function readPackagedManifest(bytes: Buffer): Record<string, unknown> {
  // npm pack produces a gzip compressed POSIX tar archive.
  const tar = gunzipSync(bytes)
  for (let offset = 0; offset + 512 <= tar.length; ) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every(byte => byte === 0)) {
      break
    }
    const name = header.toString('utf8', 0, 100).replace(/\0.*$/, '')
    const prefix = header.toString('utf8', 345, 500).replace(/\0.*$/, '')
    const entry = prefix ? `${prefix}/${name}` : name
    const sizeText = header
      .toString('ascii', 124, 136)
      .replace(/\0.*$/, '')
      .trim()
    if (!/^[0-7]+$/.test(sizeText)) {
      throw new Error('Invalid tar entry size')
    }
    const size = Number.parseInt(sizeText, 8)
    const dataStart = offset + 512
    const dataEnd = dataStart + size
    if (dataEnd > tar.length) {
      throw new Error('Truncated tar entry')
    }
    if (entry === 'package/package.json') {
      return JSON.parse(tar.toString('utf8', dataStart, dataEnd)) as Record<
        string,
        unknown
      >
    }
    offset = dataStart + Math.ceil(size / 512) * 512
  }
  throw new Error('No package/package.json entry in npm tarball')
}

export function validatePackagedManifest(
  manifest: Record<string, unknown>,
  variant: Variant,
): void {
  const standardBins = {
    socket: 'bin/cli.js',
    'socket-npm': 'bin/npm-cli.js',
    'socket-npx': 'bin/npx-cli.js',
    'socket-pnpm': 'bin/pnpm-cli.js',
    'socket-yarn': 'bin/yarn-cli.js',
  }
  const expectedBins =
    variant.expectedName === '@socketsecurity/cli' &&
    variant.env?.['INLINED_SOCKET_CLI_LEGACY_BUILD']
      ? { cli: 'bin/cli.js', ...standardBins }
      : variant.expectedName === '@socketsecurity/cli-with-sentry'
        ? {
            'cli-with-sentry': 'bin/cli.js',
            'socket-with-sentry': 'bin/cli.js',
            'socket-npm-with-sentry': 'bin/npm-cli.js',
            'socket-npx-with-sentry': 'bin/npx-cli.js',
            'socket-pnpm-with-sentry': 'bin/pnpm-cli.js',
            'socket-yarn-with-sentry': 'bin/yarn-cli.js',
          }
        : standardBins
  if (
    manifest['name'] !== variant.expectedName ||
    manifest['version'] !== variant.version
  ) {
    throw new Error(
      `Tarball metadata mismatch: expected ${variant.expectedName}@${variant.version}, got ${String(manifest['name'])}@${String(manifest['version'])}`,
    )
  }
  if (JSON.stringify(manifest['bin']) !== JSON.stringify(expectedBins)) {
    throw new Error(`Tarball CLI bin map mismatch: ${variant.artifact}`)
  }
}

export function run(
  cwd: string,
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): void {
  const result = crossSpawn.sync(command, args, {
    cwd,
    env,
    stdio: 'inherit',
    shell: false,
  })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status}`)
  }
}

async function copyTrackedSource(stage: string): Promise<void> {
  const result = spawnSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    {
      cwd: ROOT,
      encoding: 'buffer',
    },
  )
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error('git ls-files failed while staging package build')
  }
  const paths = result.stdout.toString().split('\0').filter(Boolean)
  for (const relative of new Set(paths)) {
    const source = path.join(ROOT, relative)
    const destination = path.join(stage, relative)
    await fs.mkdir(path.dirname(destination), { recursive: true })
    await fs.cp(source, destination, {
      dereference: false,
      preserveTimestamps: true,
    })
  }
}

async function assertOutputAvailable(output: string): Promise<void> {
  try {
    const entries = await fs.readdir(output)
    if (entries.length) {
      throw new Error(`Output directory is not empty: ${output}`)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }
}

async function verifyPackagedVariant(
  tarball: string,
  variant: Variant,
): Promise<void> {
  const manifest = readPackagedManifest(await fs.readFile(tarball))
  validatePackagedManifest(manifest, variant)
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.length !== 0 && (args.length !== 2 || args[0] !== '--output-dir')) {
    throw new Error(
      'Usage: pnpm build:package-matrix [--output-dir <directory>]',
    )
  }
  const output = args.length ? path.resolve(ROOT, args[1]!) : DEFAULT_OUTPUT
  await assertOutputAvailable(output)
  const rootManifest = JSON.parse(
    await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'),
  ) as { version: string }
  const variants = makeVariants(currentPrereleaseVersion(rootManifest.version))
  const temporary = await fs.mkdtemp(
    path.join(os.tmpdir(), 'socket-package-matrix-'),
  )
  const workspace = path.join(temporary, 'workspace')
  const stagedOutput = path.join(temporary, 'artifacts')
  const privateEnv = createPrivatePnpmEnvironment(workspace, process.env)
  await fs.mkdir(stagedOutput)
  try {
    await copyTrackedSource(workspace)
    // Build scripts require .env.local. The tracked template has no secrets and
    // supplies only the non-sensitive build settings needed in this workspace.
    await fs.copyFile(
      path.join(workspace, '.env.dist'),
      path.join(workspace, '.env.local'),
    )
    const packagePath = path.join(workspace, 'package.json')
    const lockPath = path.join(workspace, 'pnpm-lock.yaml')
    const basePackage = await fs.readFile(packagePath, 'utf8')
    const baseLock = await fs.readFile(lockPath, 'utf8')
    run(
      workspace,
      'pnpm',
      [
        'install',
        '--frozen-lockfile',
        '--ignore-scripts',
        '--config.enable-global-virtual-store=false',
        '--virtual-store-dir=node_modules/.pnpm',
      ],
      privateEnv,
    )
    await verifyPrivateVirtualStore(workspace)
    run(workspace, 'pnpm', ['run', 'build:dotnet-tool'], privateEnv)
    await verifyPrivateVirtualStore(workspace)
    run(workspace, 'pnpm', ['run', 'build:maven-extension'], privateEnv)
    await verifyPrivateVirtualStore(workspace)
    for (const variant of variants) {
      await fs.writeFile(
        packagePath,
        updateRootManifest(basePackage, variant.version),
      )
      await fs.writeFile(lockPath, baseLock)
      const env = {
        ...privateEnv,
        INLINED_SOCKET_CLI_PUBLISHED_BUILD: '1',
        INLINED_SOCKET_CLI_LEGACY_BUILD: '0',
        INLINED_SOCKET_CLI_SENTRY_BUILD: '0',
        ...variant.env,
      }
      run(workspace, 'pnpm', ['run', 'build:dist'], env)
      await verifyPrivateVirtualStore(workspace)
      const before = new Set(await fs.readdir(stagedOutput))
      run(workspace, 'pnpm', ['pack', '--pack-destination', stagedOutput], env)
      await verifyPrivateVirtualStore(workspace)
      const added = (await fs.readdir(stagedOutput)).filter(
        name => !before.has(name),
      )
      if (added.length !== 1 || !added[0]!.endsWith('.tgz')) {
        throw new Error(`Expected one tarball for ${variant.expectedName}`)
      }
      const produced = path.join(stagedOutput, added[0]!)
      const target = path.join(stagedOutput, variant.artifact)
      await fs.rename(produced, target)
      await verifyPackagedVariant(target, variant)
      const cli = path.join(workspace, 'bin/cli.js')
      const result = spawnSync(process.execPath, [cli, '--version'], {
        cwd: workspace,
        env,
        encoding: 'utf8',
      })
      if (result.error) {
        throw result.error
      }
      if (result.status !== 0 || result.stdout.trim() !== variant.version) {
        throw new Error(
          `CLI --version did not report ${variant.version}: ${result.stdout}${result.stderr}`,
        )
      }
      console.log(`Built ${variant.artifact}`)
    }
    await assertOutputAvailable(output)
    await fs.mkdir(path.dirname(output), { recursive: true })
    const publishStage = path.join(
      path.dirname(output),
      `.${path.basename(output)}-${process.pid}-${Date.now()}`,
    )
    try {
      await fs.cp(stagedOutput, publishStage, { recursive: true })
      await fs.rename(publishStage, output)
    } catch (error) {
      await fs.rm(publishStage, { recursive: true, force: true })
      throw error
    }
    console.log(`Package builds are in ${output}`)
  } finally {
    await fs.rm(temporary, { recursive: true, force: true })
  }
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'builds and validates four Socket CLI npm package variants in a private workspace',
  help: `Usage: pnpm run build:package-matrix [--output-dir <directory>]

  --output-dir  write the completed tarball set to an empty directory`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
