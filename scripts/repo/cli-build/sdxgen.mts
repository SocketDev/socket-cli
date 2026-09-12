import { sourceIndexPath } from './paths.mts'
import { existsSync, promises as fs } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'

import { isObject } from '@socketsecurity/lib-stable/objects/predicates'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { rolldown } from 'rolldown'

export function readSdxgenToolVersions(
  value: unknown,
): Record<string, { minimum: string }> {
  if (!isObject(value) || !isObject(value['tools'])) {
    throw new TypeError(
      'Cannot read tool versions. Where: sdxgen build. Saw invalid configuration; wanted a tools object. Fix: hydrate the pinned upstream config.',
    )
  }
  const mapping: Record<string, string> = {
    maven: 'mvn',
    gradle: 'gradle',
    go: 'go',
    dotnet: 'dotnet',
    node: 'node',
    pnpm: 'pnpm',
    python: 'python',
    sbt: 'sbt',
    swift: 'swift',
    gh: 'gh',
  }
  const versions: Record<string, { minimum: string }> = {}
  for (const [name, config] of Object.entries(value['tools'])) {
    const mapped = mapping[name]
    if (mapped && isObject(config) && typeof config['version'] === 'string') {
      versions[mapped] = { minimum: config['version'] }
    }
  }
  return versions
}

export async function buildSdxgenBundle(root: string): Promise<void> {
  const upstream = path.join(root, 'upstream', 'sdxgen')
  await ensureSdxgenSource(root, upstream)
  const output = path.join(root, 'dist', 'sdxgen')
  const raw: unknown = JSON.parse(
    await fs.readFile(
      path.join(upstream, '.config/repo/external-tools.json'),
      'utf8',
    ),
  )
  const versions = readSdxgenToolVersions(raw)
  const require = createRequire(import.meta.url)
  const acornDir = path.dirname(require.resolve('@ultrathink/acorn.rs.wasm'))
  await fs.mkdir(output, { recursive: true })
  const bundle = await rolldown({
    input: sourceIndexPath(upstream),
    platform: 'node',
    tsconfig: path.join(root, 'tsconfig.json'),
    transform: {
      define: {
        'globalThis.__SDXGEN_TOOL_VERSIONS__': JSON.stringify(versions),
        'import.meta.url': 'require("node:url").pathToFileURL(__filename).href',
      },
    },
    plugins: [
      {
        name: 'sdxgen-acorn-assets',
        resolveId(source) {
          if (source === '@ultrathink/acorn.rs.wasm') {
            return { __proto__: null, id: './acorn.cjs', external: true }
          }
          return undefined
        },
      },
    ],
  })
  try {
    await bundle.write({
      file: path.join(output, 'index.cjs'),
      format: 'cjs',
      comments: { legal: true, annotation: true, jsdoc: false },
      sourcemap: false,
    })
  } finally {
    await bundle.close()
  }
  const copies = await Promise.allSettled([
    fs.copyFile(
      path.join(acornDir, 'index.cjs'),
      path.join(output, 'acorn.cjs'),
    ),
    fs.copyFile(
      path.join(acornDir, 'acorn.wasm'),
      path.join(output, 'acorn.wasm'),
    ),
    fs.copyFile(
      path.join(upstream, 'src/parsers/gradle/dependency-tree.init.gradle'),
      path.join(output, 'dependency-tree.init.gradle'),
    ),
    fs.copyFile(
      path.join(upstream, 'LICENSE'),
      path.join(output, 'LICENSE.sdxgen'),
    ),
  ])
  const failed = copies.find(result => result.status === 'rejected')
  if (failed?.status === 'rejected') {
    throw failed.reason
  }
}

export async function ensureSdxgenSource(
  root: string,
  upstream: string,
): Promise<void> {
  if (!existsSync(path.join(upstream, '.config/repo/external-tools.json'))) {
    const result = await spawn(
      process.execPath,
      [
        path.join(root, 'scripts/fleet/git-partial-submodule.mts'),
        'clone',
        'upstream/sdxgen',
      ],
      { cwd: root, stdio: 'inherit' },
    )
    if (result.code !== 0) {
      throw new Error(
        'Cannot hydrate the generator. Where: sdxgen build. Saw a failed clone; wanted the pinned upstream source. Fix: run the fleet submodule helper and retry.',
      )
    }
    const sparse = await spawn(
      process.execPath,
      [
        path.join(root, 'scripts/fleet/git-partial-submodule.mts'),
        'restore-sparse',
        'upstream/sdxgen',
      ],
      { cwd: root, stdio: 'inherit' },
    )
    if (sparse.code !== 0) {
      throw new Error(
        'Cannot hydrate generator assets. Where: sdxgen build. Saw failed sparse checkout; wanted the pinned source and config. Fix: run the fleet submodule helper and retry.',
      )
    }
  }
  const pin = await spawn(
    'git',
    ['config', '-f', '.gitmodules', '--get', 'submodule.upstream/sdxgen.ref'],
    { cwd: root, stdio: 'pipe' },
  )
  const head = await spawn('git', ['rev-parse', 'HEAD'], {
    cwd: upstream,
    stdio: 'pipe',
  })
  const clean = await spawn(
    'git',
    [
      'diff',
      '--quiet',
      'HEAD',
      '--',
      'src',
      '.config/repo/external-tools.json',
      'LICENSE',
    ],
    { cwd: upstream, stdio: 'pipe' },
  )
  if (
    pin.code !== 0 ||
    head.code !== 0 ||
    clean.code !== 0 ||
    !pin.stdout.trim() ||
    pin.stdout.trim() !== head.stdout.trim()
  ) {
    throw new Error(
      'Cannot verify the generator source. Where: sdxgen build. Saw modified or mismatched source; wanted the committed upstream pin. Fix: preserve upstream edits separately and materialize the pinned source.',
    )
  }
}
