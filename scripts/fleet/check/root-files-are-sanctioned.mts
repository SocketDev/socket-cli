#!/usr/bin/env node
/*
 * @file `check --all` gate: every git-TRACKED entry at the repo ROOT is
 *   sanctioned. The root is the repo's front door — every rogue file that
 *   lands there gets cargo-culted fleet-wide by the next scaffold copy (the
 *   legacy root `bootstrap/` + root `external-tools.json` both spread exactly
 *   that way before their relocation to `scripts/repo/bootstrap/` and
 *   `.config/repo/`). Everything belongs to a named tier instead:
 *   `.config/{fleet,repo}/` for config data, `scripts/{fleet,repo}/` for
 *   automation, `docs/` for prose.
 *
 *   Sanctioned = a name with a mechanical anchor (a tool that only reads the
 *   root: cargo, pnpm, make, the llms.txt standard, Depot, vitest's fuzz-child
 *   auto-discovery) or a fleet-conventional tier dir. Per-repo exceptions go
 *   in `.config/repo/root-files.json` (`{ "allow": { "<name>": "<reason>" } }`)
 *   — an allowlist WITH a reason, so an exception is a documented decision,
 *   not drift.
 *
 *   Only TOP-LEVEL tracked names are judged (`git ls-tree HEAD`, no
 *   recursion): untracked local junk is `ignored-files-are-untracked`'s beat,
 *   and content inside sanctioned dirs is owned by their own gates. Fails
 *   open when git is unavailable. Exit: 0 — clean / no git; 1 — a rogue root
 *   entry is tracked.
 *
 *   Usage: node scripts/fleet/check/root-files-are-sanctioned.mts [--quiet]
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

// Exact tracked names allowed at the repo root, fleet-wide (sorted, one flat
// set): root-anchored dotfiles + tool config, the fleet tier dirs
// (.claude/.config/.git-hooks/.github), package-manager + language manifests
// (cargo, pnpm, make), GitHub-rendered root prose, root-anchored standards
// (llms.txt, depot.json, socket.yml which the Socket app reads at the root,
// the dotenv-convention .env.example/.env.test shareable variants, the vitest
// fuzz-child auto-discovery config), and repo content dirs. Bare `.env` stays
// rogue on purpose: a tracked secrets file is never sanctioned. Each name
// carries a mechanical anchor — the consuming
// tool reads the root by convention — or is a fleet-conventional tier. A name
// here is allowed, not required: a node repo simply never tracks Cargo.toml.
export const SANCTIONED_ROOT_NAMES: ReadonlySet<string> = new Set([
  '.cargo',
  '.claude',
  '.config',
  '.dockerignore',
  '.editorconfig',
  '.env.example',
  '.env.test',
  '.git-hooks',
  '.gitattributes',
  '.github',
  '.gitignore',
  '.gitmodules',
  '.mcp.json',
  '.node-version',
  '.npmrc',
  '.nvmrc',
  '.prettierignore',
  'AGENTS.md',
  'assets',
  'benches',
  'benchmarks',
  'Cargo.lock',
  'Cargo.toml',
  'CHANGELOG.md',
  'CLAUDE.md',
  'clippy.toml',
  'CODE_OF_CONDUCT.md',
  'CONTRIBUTING.md',
  'crates',
  'data',
  'deny.toml',
  'depot.json',
  'docker',
  'docs',
  'examples',
  'fuzz',
  'llms.txt',
  // The lockstep shim layout: an empty-rows root manifest whose `includes`
  // anchor the segregated .config/repo/lockstep.json's relative paths at the
  // repo root (lockstepManifestCandidates in paths.mts prefers it).
  'lockstep.json',
  'macos',
  'Makefile',
  'napi',
  'package.json',
  'packages',
  'patches',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'README.md',
  'rust-toolchain.toml',
  'rustfmt.toml',
  'scripts',
  'SECURITY.md',
  'socket.yml',
  'src',
  'template',
  'test',
  'tests',
  'tools',
  'upstream',
  'vitest.config.mts',
])

// Name patterns allowed at the root: license variants (GitHub's license
// detection reads the root) and the tsconfig family (tsc/editors resolve
// project references relative to the referencing config, and the root
// tsconfig.json is editor-discovered; siblings like tsconfig.dts.json ride
// the same resolution).
export const SANCTIONED_ROOT_PATTERNS: readonly RegExp[] = [
  /^LICEN[CS]E(?:[.-].+)?$/i,
  /^tsconfig(?:\.[\w-]+)?\.json$/,
]

// The per-repo escape hatch: `.config/repo/root-files.json` with
// `{ "allow": { "<name>": "<non-empty reason>" } }`. An entry with an empty
// reason does not count — the reason IS the review artifact.
export const ROOT_ALLOWLIST_PATH = '.config/repo/root-files.json'

export function repoAllowlist(repoRoot: string): Set<string> {
  let raw: string
  try {
    raw = readFileSync(path.join(repoRoot, ROOT_ALLOWLIST_PATH), 'utf8')
  } catch {
    return new Set()
  }
  try {
    const parsed = JSON.parse(raw) as {
      allow?: Record<string, unknown> | undefined
    }
    const allow = parsed.allow
    if (!allow || typeof allow !== 'object') {
      return new Set()
    }
    return new Set(
      Object.entries(allow)
        .filter(([, reason]) => typeof reason === 'string' && reason.length > 0)
        .map(([name]) => name),
    )
  } catch {
    return new Set()
  }
}

/**
 * Pure verdict: the tracked top-level names that are neither sanctioned
 * fleet-wide, pattern-matched, nor allowlisted per-repo.
 */
export function collectRogueRootEntries(
  topLevelNames: readonly string[],
  allowlist: ReadonlySet<string>,
): string[] {
  const rogue: string[] = []
  for (const name of topLevelNames) {
    if (SANCTIONED_ROOT_NAMES.has(name) || allowlist.has(name)) {
      continue
    }
    if (SANCTIONED_ROOT_PATTERNS.some(re => re.test(name))) {
      continue
    }
    rogue.push(name)
  }
  return rogue.toSorted()
}

/**
 * Tracked top-level names of the repo at `repoRoot`, or `undefined` when the
 * probe cannot answer — no git, no repo, no commit. Exported so tests can
 * red-drive the real probe against scratch repos.
 */
export async function trackedTopLevelNames(
  repoRoot: string,
): Promise<string[] | undefined> {
  try {
    const result = (await spawn('git', ['ls-tree', '--name-only', 'HEAD'], {
      cwd: repoRoot,
      stdio: 'pipe',
      stdioString: true,
    })) as { stdout?: string | undefined }
    return String(result?.stdout ?? '')
      .split('\n')
      .filter(line => line !== '')
  } catch {
    return undefined
  }
}

async function main(): Promise<void> {
  const names = await trackedTopLevelNames(REPO_ROOT)
  if (names === undefined) {
    // git unavailable — vacuous, never a false-red failure on a non-git tree.
    process.exitCode = 0
    return
  }
  const rogue = collectRogueRootEntries(names, repoAllowlist(REPO_ROOT))
  if (rogue.length === 0) {
    if (!process.argv.includes('--quiet')) {
      logger.log(
        'root-files-are-sanctioned: every tracked root entry is sanctioned.',
      )
    }
    process.exitCode = 0
    return
  }
  logger.fail(
    `root-files-are-sanctioned: ${rogue.length} rogue tracked root entr(ies):`,
  )
  for (let i = 0, { length } = rogue; i < length; i += 1) {
    logger.fail(`  ${rogue[i]!}`)
  }
  logger.fail(
    '  What:  a git-tracked file/dir sits at the repo root without a sanctioned\n' +
      '         name — the root is reserved for tool-anchored files and tier dirs.\n' +
      '  Where: the entr(ies) above.\n' +
      '  Wanted: root entries live in their tier — .config/{fleet,repo}/ for config\n' +
      '         data, scripts/{fleet,repo}/ for automation, docs/ for prose.\n' +
      '  Fix:   three legal moves — relocate: git mv the entry into its tier\n' +
      `         per fleet conventions; declare: add it to ${ROOT_ALLOWLIST_PATH}\n` +
      '         as { "allow": { "<name>": "<reason>" } } with a non-empty\n' +
      '         justification, or to SANCTIONED_ROOT_NAMES in this check when\n' +
      '         the anchor holds fleet-wide; delete: git rm it when nothing\n' +
      '         needs it.',
  )
  process.exitCode = 1
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  main().catch((e: unknown) => {
    logger.fail(`root-files-are-sanctioned failed: ${String(e)}`)
    process.exitCode = 1
  })
}
/* c8 ignore stop */
