/**
 * Measurement-only helper for the trimming-bundle skill: the deterministic
 * before/after size + survey the trim loop needs, NOT the candidate discovery.
 *
 * Emits {bundleSizeBytes, perFileSizes (heaviest-first), preconditions,
 * rawDistImportSurvey}. The reachability-from-entry walk, the set-delta
 * candidate computation, and the HIGH/MEDIUM/LOW confidence grading stay in the
 * model's hands — bundle-trim grades them precisely because the static signal
 * is ambiguous (barrel files, re-exports, dynamic import, conditional exports),
 * and scripting a confidence label would hard-code the heuristic boundary the
 * model is meant to exercise. This helper only measures.
 *
 * The import survey preserves FULL specifiers (`@socketsecurity/lib/globs`, not
 * just `@socketsecurity/lib`) — the trim discovery keys on lib SUBPATHS, so the
 * survey must keep the subpath, unlike validate-bundle-deps' getPackageName.
 *
 * Usage:
 * node measure-bundle.mts [--repo <dir>] [--json]
 */

import process from 'node:process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'
import { findDistFiles } from '../validate-bundle-deps.mts'

const logger = getDefaultLogger()

export interface Preconditions {
  distExists: boolean
  rolldownConfigImportsStub: boolean
  libStubPresent: boolean
}

export interface BundleMeasurement {
  bundleSizeBytes: number
  perFileSizes: Array<{ file: string; bytes: number }>
  preconditions: Preconditions
  rawDistImportSurvey: string[]
}

// Capture every import/require specifier in a dist file, at FULL subpath
// granularity. Both `import … from '<spec>'` and `require('<spec>')` forms.
export function extractSpecifiers(source: string): string[] {
  const specs = new Set<string>()
  // `from`/`import` keyword, optional `(` (dynamic import), then a quoted
  // specifier; group 1 captures the specifier between the quotes.
  const importRe = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/gu
  // `require(` then a quoted specifier; group 1 captures it.
  const requireRe = /require\(\s*['"]([^'"]+)['"]\s*\)/gu
  for (const re of [importRe, requireRe]) {
    let m: RegExpExecArray | null = re.exec(source)
    while (m !== null) {
      specs.add(m[1]!)
      m = re.exec(source)
    }
  }
  return [...specs]
}

export function checkPreconditions(repoDir: string): Preconditions {
  const distExists = existsSync(path.join(repoDir, 'dist'))
  const configPath = path.join(
    repoDir,
    '.config',
    'repo',
    'rolldown.config.mts',
  )
  let rolldownConfigImportsStub = false
  if (existsSync(configPath)) {
    rolldownConfigImportsStub = readFileSync(configPath, 'utf8').includes(
      'createLibStubPlugin',
    )
  }
  const libStubPresent = existsSync(
    path.join(repoDir, '.config', 'repo', 'rolldown', 'lib-stub.mts'),
  )
  return { distExists, libStubPresent, rolldownConfigImportsStub }
}

export async function measureBundle(
  repoDir: string,
): Promise<BundleMeasurement> {
  const preconditions = checkPreconditions(repoDir)
  const distPath = path.join(repoDir, 'dist')
  const perFileSizes: Array<{ file: string; bytes: number }> = []
  const survey = new Set<string>()
  let bundleSizeBytes = 0
  if (preconditions.distExists) {
    const files = await findDistFiles(distPath)
    for (let i = 0, { length } = files; i < length; i += 1) {
      const file = files[i]!
      const bytes = statSync(file).size
      bundleSizeBytes += bytes
      perFileSizes.push({ bytes, file: path.relative(repoDir, file) })
      for (const spec of extractSpecifiers(readFileSync(file, 'utf8'))) {
        survey.add(spec)
      }
    }
  }
  perFileSizes.sort((a, b) => b.bytes - a.bytes)
  return {
    bundleSizeBytes,
    perFileSizes,
    preconditions,
    rawDistImportSurvey: [...survey].toSorted(),
  }
}

export async function main(argv: readonly string[]): Promise<number> {
  const repoIdx = argv.indexOf('--repo')
  // Anchor on REPO_ROOT (resolved from this script's own location) rather than
  // process.cwd() — the trim tool may be invoked from any directory.
  const repoDir = repoIdx !== -1 ? path.resolve(argv[repoIdx + 1]!) : REPO_ROOT
  try {
    const m = await measureBundle(repoDir)
    if (argv.includes('--json')) {
      const json = `${JSON.stringify(m, undefined, 2)}\n`
      process.stdout.write(json) // socket-lint: allow console -- machine JSON; logger would corrupt it
    } else {
      logger.info(
        `bundle size: ${m.bundleSizeBytes} bytes across ${m.perFileSizes.length} file(s)`,
      )
      logger.info(
        `preconditions: dist=${m.preconditions.distExists} stub-import=${m.preconditions.rolldownConfigImportsStub} lib-stub=${m.preconditions.libStubPresent}`,
      )
      for (let i = 0, n = Math.min(5, m.perFileSizes.length); i < n; i += 1) {
        const f = m.perFileSizes[i]!
        logger.info(`  ${f.bytes} ${f.file}`)
      }
      logger.info(`import specifiers surveyed: ${m.rawDistImportSurvey.length}`)
    }
    return 0
  } catch (e) {
    logger.fail(`measure-bundle failed: ${errorMessage(e)}`)
    return 1
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void (async () => {
    process.exitCode = await main(process.argv.slice(2))
  })()
}
