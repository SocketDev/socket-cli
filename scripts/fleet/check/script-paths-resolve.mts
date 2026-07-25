// Fleet check — every package.json script path resolves to a real file.
//
// A `pnpm run <name>` script that invokes `node scripts/foo.mts` is silently
// broken the moment `foo.mts` is renamed or deleted and the script string isn't
// updated — `pnpm run` only fails when someone actually invokes it. The
// wheelhouse synthesizes each package.json `scripts` block from
// CANONICAL_SCRIPT_BODIES in `scripts/repo/sync-scaffolding/manifest.mts`, so a
// stale path there propagates a broken script to every fleet repo.
//
// Past incident (2026-06-06): renaming the prompt-less-setup check left
// `doctor:auth` in CANONICAL_SCRIPT_BODIES pointing at the deleted
// `scripts/fleet/check/prompt-less-setup.mts` — the regenerated script was dead
// and no gate caught it.
//
// Past incident (2026-07-20, socket-btm aa138c6e): the root-scripts segregation
// wave blanket-rewrote `scripts/<name>.mts` references to
// `scripts/repo/<name>.mts` across the whole tree, including WORKSPACE MEMBER
// package.json scripts whose paths are package-relative (e.g.
// `packages/curl-builder` runs `node scripts/build.mts` against its OWN
// `scripts/` dir, which never moved) — ~20 member build scripts went dead and
// this check, which then scanned only the root package.json, stayed green.
// Workspace member manifests are now scanned too, resolving each `node <path>`
// against that package's directory (pnpm runs scripts with cwd = the package
// dir), so a rewrite-without-move fails the gates instead of landing.
//
// This check fails `check --all` when:
//   - a `package.json` `scripts` value (root OR any pnpm-workspace member
//     package) invokes `node <path>` where <path> ends in
//     .mts/.cts/.mjs/.cjs/.js and that file does not exist relative to the
//     manifest's own directory, OR
//   - (wheelhouse only) a CANONICAL_SCRIPT_BODIES value names a script file that
//     does not exist under the repo root.
//
// Only `node <local-path>` invocations are checked — bin tools (oxfmt, tsgo,
// agent-ci), `run-s`/`run-p` aggregators, and inline `node -e` are skipped.
//
// Usage: node scripts/fleet/check/script-paths-resolve.mts [--quiet]

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { globSync } from '@socketsecurity/lib-stable/globs/match'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'
import { parseListBlock } from '../lib/workspace-yaml.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

// Wheelhouse-only: downstream fleet repos don't ship the manifest. Resolved
// relative to the repo being scanned (not a module constant) so the check is
// testable against a fixture repo and always points at the right manifest.
function manifestPath(repoRoot: string): string {
  return path.join(repoRoot, 'scripts/repo/sync-scaffolding/manifest.mts')
}

// Local script file extensions we resolve. A `node <path>` whose path ends in
// one of these is a repo file that must exist.
const SCRIPT_EXTS = ['.mts', '.cts', '.mjs', '.cjs', '.js']

export interface PathHit {
  readonly source: string
  readonly key: string
  readonly scriptPath: string
}

/**
 * Extract the local script path a command runs via `node <path>`, or undefined
 * when the command isn't a `node <local-script>` invocation (a bin tool, an
 * aggregator like run-s, an inline `node -e`, or a `node` flag-only call).
 * Tolerates a leading `NAME=val` env prefix.
 */
export function extractNodeScriptPath(command: string): string | undefined {
  const tokens = command.trim().split(/\s+/)
  let i = 0
  while (i < tokens.length && tokens[i]!.includes('=')) {
    i += 1
  }
  if (tokens[i] !== 'node') {
    return undefined
  }
  // First non-flag token after `node` is the script path (skip `-e`, `--flag`,
  // and `-e`'s inline-code argument).
  for (let j = i + 1; j < tokens.length; j += 1) {
    const tok = tokens[j]!
    if (tok === '--eval' || tok === '-e') {
      return undefined
    }
    if (tok.startsWith('-')) {
      continue
    }
    // The path token. A `<placeholder>` segment (literal angle brackets) marks a
    // doc/template stand-in like `node scripts/foo/<name>.mts` — it can never be
    // a real on-disk file, so it's a documentation placeholder, not a broken
    // reference. Skip it rather than flag a phantom "file not found".
    if (tok.includes('<') || tok.includes('>')) {
      return undefined
    }
    // A glob token (`node test/*.test.mts` in the oxlint-plugin packages) is
    // expanded by the SHELL at run time — no literal file bears that name, so
    // existsSync can't judge it. Skip rather than flag a phantom miss.
    if (/[*?[\]{}]/.test(tok)) {
      return undefined
    }
    // Only treat it as a local script if it has a script ext.
    const hasExt = SCRIPT_EXTS.some(ext => tok.endsWith(ext))
    return hasExt ? tok : undefined
  }
  return undefined
}

/**
 * Scan a `{ name: command }` script map for `node <path>` invocations whose
 * target file is missing under repoRoot. `source` labels where the map came
 * from (e.g. 'package.json' / 'CANONICAL_SCRIPT_BODIES').
 */
export function scanScriptMap(
  scripts: Readonly<Record<string, string>>,
  repoRoot: string,
  source: string,
): PathHit[] {
  const hits: PathHit[] = []
  const keys = Object.keys(scripts)
  for (let i = 0, { length } = keys; i < length; i += 1) {
    const key = keys[i]!
    const command = scripts[key]
    if (typeof command !== 'string') {
      continue
    }
    const scriptPath = extractNodeScriptPath(command)
    if (!scriptPath) {
      continue
    }
    if (!existsSync(path.join(repoRoot, scriptPath))) {
      hits.push({ source, key, scriptPath })
    }
  }
  return hits
}

export interface PackageJsonShape {
  readonly scripts?: Readonly<Record<string, string>> | undefined
}

/**
 * Repo-relative directories of every pnpm-workspace member package (the dirs
 * whose `package.json` a `packages:` glob matches). Empty when the repo has no
 * pnpm-workspace.yaml (solo layout) or no resolvable `packages:` globs.
 * Negation patterns (leading `!`) are pnpm excludes, not member roots — skip
 * them (the fleet's globs don't rely on subtractive matching for members).
 */
export function findWorkspacePackageDirs(repoRoot: string): string[] {
  const yamlPath = path.join(repoRoot, 'pnpm-workspace.yaml')
  if (!existsSync(yamlPath)) {
    return []
  }
  let content: string
  try {
    content = readFileSync(yamlPath, 'utf8')
  } catch {
    return []
  }
  const globs = parseListBlock(content, { blockKey: 'packages' })
    .filter(g => !g.startsWith('!'))
    .map(g => `${g.replace(/\/+$/, '')}/package.json`)
  if (globs.length === 0) {
    return []
  }
  const manifests = globSync(globs, {
    cwd: repoRoot,
    ignore: ['**/node_modules/**'],
  })
  return manifests.map(m => path.dirname(m)).toSorted()
}

/**
 * Read a manifest's `scripts` map, tolerating a missing/malformed file (the
 * package-scripts checker owns malformed-manifest reporting).
 */
function readScriptsMap(
  pkgPath: string,
): Readonly<Record<string, string>> | undefined {
  if (!existsSync(pkgPath)) {
    return undefined
  }
  let pkg: PackageJsonShape
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as PackageJsonShape
  } catch {
    pkg = {}
  }
  return pkg.scripts
}

export async function scanRepo(repoRoot: string): Promise<PathHit[]> {
  const hits: PathHit[] = []

  // 1. The live package.json scripts (every fleet repo has this).
  const rootScripts = readScriptsMap(path.join(repoRoot, 'package.json'))
  if (rootScripts) {
    hits.push(...scanScriptMap(rootScripts, repoRoot, 'package.json'))
  }

  // 1b. Workspace member manifests (mono layout). pnpm runs a member's scripts
  //     with cwd = the member dir, so each `node <path>` resolves against THAT
  //     dir — the guard the 2026-07-20 rewrite-without-move incident lacked.
  const memberDirs = findWorkspacePackageDirs(repoRoot)
  for (let i = 0, { length } = memberDirs; i < length; i += 1) {
    const dir = memberDirs[i]!
    const memberScripts = readScriptsMap(
      path.join(repoRoot, dir, 'package.json'),
    )
    if (memberScripts) {
      hits.push(
        ...scanScriptMap(
          memberScripts,
          path.join(repoRoot, dir),
          `${dir}/package.json`,
        ),
      )
    }
  }

  // 2. The cascade synthesizer source-of-truth (wheelhouse only). Catching a
  //    dangling path HERE stops the cascade from shipping it fleet-wide.
  const manifest = manifestPath(repoRoot)
  if (existsSync(manifest)) {
    const mod = (await import(manifest)) as {
      CANONICAL_SCRIPT_BODIES?: Readonly<Record<string, string>> | undefined
    }
    if (mod.CANONICAL_SCRIPT_BODIES) {
      hits.push(
        ...scanScriptMap(
          mod.CANONICAL_SCRIPT_BODIES,
          repoRoot,
          'CANONICAL_SCRIPT_BODIES',
        ),
      )
    }
  }

  return hits
}

async function main(): Promise<void> {
  const quiet = process.argv.includes('--quiet')
  const hits = await scanRepo(REPO_ROOT)
  if (hits.length) {
    logger.fail(
      '[check-script-paths-resolve] package.json script paths that do not resolve:',
    )
    for (let i = 0, { length } = hits; i < length; i += 1) {
      const h = hits[i]!
      logger.error(
        `  ✗ ${h.source} "${h.key}" → node ${h.scriptPath} (file not found)`,
      )
    }
    logger.error(
      '  A pnpm script that invokes a missing file is dead until someone runs it. Rename the path to the moved file (in CANONICAL_SCRIPT_BODIES for synthesized scripts, then re-cascade).',
    )
    process.exitCode = 1
    return
  }
  if (!quiet) {
    logger.success(
      '[check-script-paths-resolve] every package.json script path resolves.',
    )
  }
}

if (isMainModule(import.meta.url)) {
  main().catch((e: unknown) => {
    logger.error(`[check-script-paths-resolve] failed: ${errorMessage(e)}`)
    process.exitCode = 1
  })
}
