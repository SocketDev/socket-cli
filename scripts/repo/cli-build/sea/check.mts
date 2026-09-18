import crypto from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { isMainModule } from '../../../fleet/process/is-main-module.mts'
import { runMain } from '../../../fleet/process/run-main.mts'
import { SEA_PAYLOAD_PATH, SEA_RECEIPT_PATH, seaBinaryPath } from './paths.mts'
import { resolveSeaTarget, SEA_TARGETS } from './targets.mts'

const logger = getDefaultLogger()

export async function main(): Promise<void> {
  const receipt = JSON.parse(await readFile(SEA_RECEIPT_PATH, 'utf8')) as {
    payload: string
    binaries: Record<string, string>
  }
  const payload = crypto
    .createHash('sha256')
    .update(await readFile(SEA_PAYLOAD_PATH))
    .digest('hex')
  if (receipt.payload !== payload) {
    throw new Error(
      'SEA payload does not match the CLI build. Run pnpm run build:sea.',
    )
  }
  const targets = process.argv.includes('--host')
    ? [
        resolveSeaTarget(
          process.platform,
          process.arch,
          (
            process.report.getReport() as {
              header: { glibcVersionRuntime?: string | undefined }
            }
          ).header.glibcVersionRuntime,
        ),
      ]
    : SEA_TARGETS
  for (const target of targets) {
    const bytes = await readFile(seaBinaryPath(target))
    const actual = crypto.createHash('sha256').update(bytes).digest('hex')
    if (actual !== receipt.binaries[target]) {
      throw new Error(
        `SEA package digest mismatch for ${target}. Run pnpm run build:sea.`,
      )
    }
  }
  const host = resolveSeaTarget(
    process.platform,
    process.arch,
    (
      process.report.getReport() as {
        header: { glibcVersionRuntime?: string | undefined }
      }
    ).header.glibcVersionRuntime,
  )
  for (const arg of ['--version', '--help']) {
    const result = await spawn(seaBinaryPath(host), [arg], {
      stdio: 'pipe',
      timeout: 60_000,
    })
    if (result.code !== 0 || !result.stdout.toString().trim()) {
      throw new Error(
        `SEA smoke test failed for ${arg}: ${result.stderr}. Rebuild the executable.`,
      )
    }
  }
  if (process.argv.includes('--json')) {
    logger.stdout.write(JSON.stringify({ ok: true, targets }) + '\n')
  } else {
    logger.log(`Verified ${targets.length} SEA artifacts and host execution.`)
  }
}

if (isMainModule(import.meta.url)) {
  runMain(main, {
    describe: 'verify socket SEA artifact integrity and execution',
    help: 'Usage: pnpm run check:sea-package [--host]',
    json: 'native',
    heavyJob: 'test',
  })
}
