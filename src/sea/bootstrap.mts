/** Load the complete root Socket distribution relative to the SEA VFS main. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  cleanupBundledTool,
  getBundledTool,
  isSea,
  runEmbeddedJsTool,
} from './runtime.mts'
import { digestVfs } from './vfs-digest.mts'

// The builder records its inputs in the bootstrap, outside the archive being tested.
declare const INLINED_SEA_SMOKE_TEST: null | {
  digest: string
  nodeVersion?: string
  uvVersion?: string
}

// Node places the VFS main at its mount root. Expose that stable root before
// loading Socket so native payload adapters can read embedded files by path.
;(
  globalThis as typeof globalThis & { __socketSeaVfsRoot?: string }
).__socketSeaVfsRoot = __dirname

async function smokeTest(): Promise<void> {
  const seaSmokeTest = INLINED_SEA_SMOKE_TEST
  assert.ok(seaSmokeTest, 'Missing SEA build inputs for the smoke test')
  // Node adds this bootstrap at the mount root alongside the archive entries.
  const entries = (await fs.readdir(__dirname)).filter(
    name => name !== path.basename(__filename),
  )
  assert.equal(
    digestVfs(__dirname, entries),
    seaSmokeTest.digest,
    'Embedded VFS differs from build inputs',
  )
  if (isSea()) {
    const cache = await fs.mkdtemp(
      path.join(os.tmpdir(), 'socket-coana-smoke-'),
    )
    try {
      const result = await runEmbeddedJsTool(
        'coana-cache',
        ['lookup', '0.0.0', 'cli'],
        { env: { XDG_CACHE_HOME: cache }, stdio: 'pipe' },
      )
      assert.equal(
        result.code,
        4,
        result.stderr || 'Expected a Coana cache miss',
      )
    } finally {
      await fs.rm(cache, { recursive: true, force: true })
    }
  }
  if (seaSmokeTest.uvVersion) {
    const output = await readBundledVersion('uv')
    const [name, version] = output.trim().split(/\s+/u)
    assert.equal(name, 'uv')
    assert.equal(version, seaSmokeTest.uvVersion)
    process.stdout.write(`${name} ${version}\n`)
  }
  if (seaSmokeTest.nodeVersion) {
    const output = await readBundledVersion('node')
    assert.equal(output.trim(), `v${seaSmokeTest.nodeVersion}`)
    process.stdout.write(output)
  }
  console.log('VFS smoke test passed')
}

async function readBundledVersion(id: 'node' | 'uv'): Promise<string> {
  const executable = await getBundledTool(id)
  try {
    return execFileSync(executable, ['--version'], {
      encoding: 'utf8',
      timeout: 15_000,
    })
  } finally {
    await cleanupBundledTool(executable)
  }
}

if (
  process.argv.length === 4 &&
  process.argv[2] === 'sea' &&
  process.argv[3] === 'smoke-test'
) {
  void smokeTest().catch(error => {
    console.error(error)
    process.exitCode = 1
  })
} else {
  require('./dist/cli.js')
}
