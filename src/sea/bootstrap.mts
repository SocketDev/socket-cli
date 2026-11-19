/** Load the complete root Socket distribution relative to the SEA VFS main. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Worker } from 'node:worker_threads'

import { cleanupBundledTool, getBundledTool } from './runtime.mts'
import { digestVfs } from './vfs-digest.mts'

// The builder records its inputs in the bootstrap, outside the archive being tested.
declare const seaSmokeTest: {
  digest: string
  uvVersion?: string
}

// Node places the VFS main at its mount root. Expose that stable root before
// loading Socket so native payload adapters can read embedded files by path.
;(
  globalThis as typeof globalThis & { __socketSeaVfsRoot?: string }
).__socketSeaVfsRoot = __dirname

async function smokeTest(): Promise<void> {
  // Node adds this bootstrap at the mount root alongside the archive entries.
  const entries = (await fs.readdir(__dirname)).filter(
    name => name !== path.basename(__filename),
  )
  assert.equal(
    digestVfs(__dirname, entries),
    seaSmokeTest.digest,
    'Embedded VFS differs from build inputs',
  )
  // The SEA ships the Coana cache helper. A lookup in a private empty cache
  // exercises its VFS entrypoint without fetching a Coana release.
  const cache = await fs.mkdtemp(path.join(os.tmpdir(), 'socket-coana-smoke-'))
  try {
    const worker = new Worker(path.join(__dirname, 'dist/coana-cache.mjs'), {
      argv: ['lookup', '0.0.0', 'cli'],
      env: { ...process.env, XDG_CACHE_HOME: cache },
    })
    const [code] = await once(worker, 'exit')
    assert.equal(code, 4, 'Expected a Coana cache miss')
  } finally {
    await fs.rm(cache, { recursive: true, force: true })
  }
  if (seaSmokeTest.uvVersion) {
    const uv = await getBundledTool('uv')
    try {
      const output = execFileSync(uv, ['--version'], {
        encoding: 'utf8',
        timeout: 15_000,
      })
      const [name, version] = output.trim().split(/\s+/u)
      assert.equal(name, 'uv')
      assert.equal(version, seaSmokeTest.uvVersion)
      process.stdout.write(output)
    } finally {
      await cleanupBundledTool(uv)
    }
  }
  console.log('VFS smoke test passed')
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
