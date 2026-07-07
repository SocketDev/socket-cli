/**
 * @file Post-build `dist/` integrity guard. After the parallel builders + the
 *   fsync barrier, syntax-check every emitted `dist/**` `.js`/`.cjs` so a
 *   corrupt or half-written file (the classic symptom: a parallel-write race
 *   leaves a bundled shim truncated, surfacing later as a cryptic `SyntaxError:
 *   Unexpected token` at test time) FAILS THE BUILD loudly and locally instead
 *   of becoming an opaque downstream failure. Each file is parsed with `node
 *   --check` (parse-only, no execution), which catches truncation, encoding
 *   corruption, and partial writes. Cheap: parse only, no eval, no module
 *   graph.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

const logger = getDefaultLogger()

/**
 * Collect every `.js`/`.cjs` file under `dir` (recursive).
 */
async function collectJsFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...(await collectJsFiles(full)))
    } else if (
      entry.isFile() &&
      (full.endsWith('.js') || full.endsWith('.cjs'))
    ) {
      out.push(full)
    }
  }
  return out
}

/**
 * Syntax-check one file with `node --check` (parse-only, no execution). Returns
 * the stderr on failure, or undefined on success.
 */
async function checkFile(file: string): Promise<string | undefined> {
  try {
    const result = await spawn(process.execPath, ['--check', file], {
      stdio: 'pipe',
      stdioString: true,
    })
    return result.code === 0
      ? undefined
      : String(result.stderr ?? 'parse failed')
  } catch (e) {
    return String((e as { stderr?: unknown | undefined })?.stderr ?? e)
  }
}

/**
 * Verify dist integrity. Returns exit code (0 = all files parse).
 */
export async function verifyDist(distDir: string): Promise<number> {
  const files = await collectJsFiles(distDir)
  const failures: Array<{ error: string; file: string }> = []
  // Bounded concurrency: parse in chunks so a huge dist doesn't fork
  // thousands of `node --check` at once.
  const CONCURRENCY = 16
  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const chunk = files.slice(i, i + CONCURRENCY)
    const results = await Promise.all(
      chunk.map(async file => ({ error: await checkFile(file), file })),
    )
    for (const { error, file } of results) {
      if (error !== undefined) {
        failures.push({ error, file })
      }
    }
  }
  if (failures.length > 0) {
    logger.error(
      `dist integrity check FAILED — ${failures.length} file(s) do not parse:`,
    )
    for (const { error, file } of failures) {
      const rel = path.relative(distDir, file)
      logger.error(`  ${rel}: ${error.split('\n')[0]}`)
    }
    logger.error(
      'A corrupt/partial dist usually means a parallel-write race. ' +
        'Re-run the build; if it persists, an externals codemod or the ' +
        'bundler is racing on this file.',
    )
    return 1
  }
  return 0
}

// Allow running standalone: `node scripts/fleet/verify-dist.mts [distDir]`.
if (process.argv[1]?.endsWith('verify-dist.mts')) {
  const distDir = path.resolve(process.argv[2] ?? 'dist')
  verifyDist(distDir).then(code => {
    if (code === 0) {
      logger.success('dist integrity OK')
    }
    process.exitCode = code
  })
}
