/*
 * @file Fleet-member health doctor. Diagnoses and (with --fix) repairs
 *   onboarding gaps that break `pnpm install` in a fleet member but that the
 *   sync-scaffolding cascade does not catch. Steps:
 *
 *   1. Catalog-reference-without-entry (GAP 1) — a workspace package.json
 *      declares "<dep>": "catalog:" but the repo's pnpm-workspace.yaml catalog:
 *      block has no entry for <dep>. Auto-fixed when --fix is passed and the dep
 *      is a known fleet catalog name; otherwise reported loud.
 *   2. Soak-window install failures (GAP 2) — after catalog fixes, pnpm install
 *      can still fail ERR_PNPM_NO_MATURE_MATCHING_VERSION. Reported loud with the
 *      exact annotated minimumReleaseAgeExclude fix. Never auto-applied.
 *   3. Stranded cascade artifacts (GAP 3) — local-only chore(wheelhouse): cascade
 *      commits and superseded chore/wheelhouse-<sha> worktrees. Report-only;
 *      operator runs cleanup-stranded --apply.
 *   4. Unsigned commits on default branch (GAP 5) — unpushed commits missing a
 *      valid GPG/SSH signature. Report-only; operator signs them.
 *   5. Diverged default branch (GAP 6) — local branch is behind origin (not
 *      fast-forwardable). Report-only; operator runs managing-worktrees land.
 *   6. Worktree hygiene (GAP 10) — superseded cascade worktrees present.
 *      Report-only; operator runs cleanup-stranded or git worktree remove.
 *   7. Secret scan (--probe-secrets) — committed-tree secrets via the
 *      FLEET-pinned TruffleHog (version-gated; never a system/unpinned binary,
 *      since TruffleHog has been supply-chain-compromised historically).
 *      Report-only; fails loud (tool-missing) rather than silent-clean.
 *   8. Lockfile ↔ catalog drift — a pnpm-workspace.yaml catalog entry bumped
 *      but not reflected in pnpm-lock.yaml's resolved catalogs (CI's
 *      --frozen-lockfile then fails). Always runs (cheap file reads);
 *      report-only, operator runs `pnpm install`.
 *   9. Pin-shadowed catalog entries (GAP 11) — a package.json pins a version
 *      directly while the catalog carries the same dep, so catalog bumps
 *      silently no-op. Auto-fixed to "catalog:" under --fix; deliberate
 *      off-catalog pins opt out via catalogShadowIgnore: in
 *      pnpm-workspace.yaml.
 *   10. Brewfile drift — an enrolled repo's (repo-root Brewfile present)
 *      committed Brewfile out of sync with a fresh render of the current
 *      `.github/` brew install sites, which is what makes
 *      `check/brew-install-is-pinned.mts` red. Always runs (cheap file
 *      reads); auto-fixed (rewrites the Brewfile) under --fix, otherwise
 *      reported loud. A repo with no Brewfile is not enrolled — no finding.
 *
 *   CLI: node scripts/fleet/doctor.mts [--fix] [--probe-install] [--probe-git]
 *        [--probe-secrets]
 *   Exit 0 = healthy or all gaps fixed. Exit 1 = any unfixed finding.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { whichSync } from '@socketsecurity/lib-stable/bin/which'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { globSync } from '@socketsecurity/lib-stable/globs/match'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { getSocketDlxDir } from '@socketsecurity/lib-stable/paths/socket'
import {
  spawn,
  spawnSync,
} from '@socketsecurity/lib-stable/process/spawn/child'
import { isSpawnError } from '@socketsecurity/lib-stable/process/spawn/errors'

import { SOAK_DAYS } from './constants/soak.mts'
import {
  findBrewfileDrift,
  formatBrewfileDriftFinding,
} from './lib/doctor/brewfile-gap.mts'
import {
  applyCatalogFixes,
  collectCatalogRefs,
  diagnoseCatalogGaps,
} from './lib/doctor/catalog-gap.mts'
import type { DoctorFinding } from './lib/doctor/catalog-gap.mts'
import {
  detectDivergedMain,
  detectRemovableWorktrees,
  detectUnsignedCommits,
} from './lib/doctor/git-gap.mts'
import { diagnoseLockfileCatalogDrift } from './lib/doctor/lockfile-catalog-gap.mts'
import {
  applyPinShadowFixes,
  diagnosePinShadowGaps,
} from './lib/doctor/pin-shadow-gap.mts'
import {
  formatSecretFindings,
  formatToolMissingFinding,
  parseTruffleHogFindings,
} from './lib/doctor/secret-scan-gap.mts'
import {
  formatSoakFinding,
  parseSoakViolations,
} from './lib/doctor/soak-gap.mts'
import {
  detectStrandedCascade,
  formatStrandedCascadeFinding,
} from './lib/doctor/stranded-cascade-gap.mts'
import { parseListBlock } from './lib/workspace-yaml.mts'
import { brewfilePath, findManifestBrewSites } from './update/brew-parse.mts'
import { isMainModule } from './_shared/is-main-module.mts'

const logger = getDefaultLogger()

// True when the repo at `cwd` is on the `squash-history` cadence — its roster
// entry (`.claude/skills/fleet/cascading-fleet/lib/fleet-repos.json`) lists
// `squash-history` in `optIns`. Such a repo squashes local history and
// force-pushes over origin, so a diverged (behind > 0) local main is the
// intended state, not a defect. Resolves the repo name from the origin remote,
// falling back to the directory name. Any read/parse error yields false (the
// divergence probe then behaves as before).
function isSquashHistoryRepo(cwd: string): boolean {
  const rosterPath = path.join(
    cwd,
    '.claude/skills/fleet/cascading-fleet/lib/fleet-repos.json',
  )
  if (!existsSync(rosterPath)) {
    return false
  }
  let repoName = path.basename(cwd)
  const remoteR = spawnSync('git', ['config', '--get', 'remote.origin.url'], {
    cwd,
    stdioString: true,
    timeout: 5_000,
  })
  if (remoteR.status === 0 && typeof remoteR.stdout === 'string') {
    const slug = remoteR.stdout
      .trim()
      .replace(/\.git$/, '')
      .split(/[/:]/)
      .pop()
    if (slug) {
      repoName = slug
    }
  }
  try {
    const roster = JSON.parse(readFileSync(rosterPath, 'utf8')) as {
      repos?: Array<{ name?: string; optIns?: string[] }>
    }
    const entry = roster.repos?.find(r => r.name === repoName)
    return Boolean(entry?.optIns?.includes('squash-history'))
  } catch {
    return false
  }
}

// Print a finding in the canonical four-ingredient format.
function printFinding(f: DoctorFinding, idx: number): void {
  logger.error('')
  logger.info(`Finding ${idx + 1}:`)
  logger.info(`  What:  ${f.what}`)
  logger.info(`  Where: ${f.where}`)
  logger.info(`  Saw:   ${f.saw}`)
  logger.info(`Fix:`)
  logger.group()
  for (const l of f.fix.split('\n')) {
    logger.info(l)
  }
  logger.groupEnd()
}

// Discover workspace package.json paths via the packages: glob list.
function discoverPackageJsonPaths(options: {
  cwd: string
  workspaceYaml: string
}): string[] {
  const opts = Object.assign(Object.create(null), options) as typeof options
  const patterns = parseListBlock(opts.workspaceYaml, { blockKey: 'packages' })
  const includes: string[] = []
  const excludes: string[] = []
  for (const pat of patterns) {
    if (pat.startsWith('!')) {
      excludes.push(pat.slice(1).trimStart())
    } else {
      includes.push(pat)
    }
  }
  const ignorePatterns = [...excludes.map(e => `${e}/**`), '**/node_modules/**']
  const globs =
    includes.length > 0
      ? includes.map(p => `${p}/package.json`)
      : ['**/package.json']
  return globSync(globs, {
    cwd: opts.cwd,
    absolute: true,
    ignore: ignorePatterns,
  })
}

// Resolve the default branch name for git probes. Falls back to 'main'.
function resolveDefaultBranch(cwd: string): string {
  const r = spawnSync(
    'git',
    ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'],
    { cwd, stdioString: true, timeout: 10_000 },
  )
  if (r.status === 0 && typeof r.stdout === 'string') {
    const ref = r.stdout.trim()
    const slash = ref.lastIndexOf('/')
    return slash >= 0 ? ref.slice(slash + 1) : ref
  }
  return 'main'
}

// Read the fleet-pinned TruffleHog version from the security-tools config the
// cascade ships into every member. Undefined when the config is absent (repo
// not set up) or malformed.
function readPinnedTrufflehogVersion(cwd: string): string | undefined {
  const cfgPath = path.join(
    cwd,
    '.claude/hooks/fleet/setup-security-tools/external-tools.json',
  )
  if (!existsSync(cfgPath)) {
    return undefined
  }
  try {
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8')) as {
      tools?:
        | { trufflehog?: { version?: string | undefined } | undefined }
        | undefined
    }
    return cfg.tools?.trufflehog?.version
  } catch {
    return undefined
  }
}

// Candidate `trufflehog` binaries under the dlx cache root (`dlxDir`), one
// directory level deep: setup-security-tools installs the pinned binary into
// `<dlxDir>/<content-hash>/trufflehog[.exe]`, which is NOT on PATH. Pure FS glob
// (no PATH, no spawn) so it's unit-testable against a fixture dir.
export function dlxToolCandidates(dlxDir: string, binName: string): string[] {
  if (!existsSync(dlxDir)) {
    return []
  }
  return globSync([`*/${binName}`], { cwd: dlxDir, absolute: true })
}

// All candidate `trufflehog` binaries, PATH first then the dlx cache. `pnpm run
// setup` lands the pinned binary in the content-hashed dlx store rather than on
// PATH, so a PATH-only probe false-reds after setup (SAFE, never false-green:
// the caller still --version-gates every candidate). Windows names it
// `trufflehog.exe`.
export function resolveTrufflehogBinaries(): string[] {
  const binName = process.platform === 'win32' ? 'trufflehog.exe' : 'trufflehog'
  const out: string[] = []
  const onPath = whichSync('trufflehog', { nothrow: true })
  if (onPath && typeof onPath === 'string') {
    out.push(onPath)
  }
  for (const candidate of dlxToolCandidates(getSocketDlxDir(), binName)) {
    if (!out.includes(candidate)) {
      out.push(candidate)
    }
  }
  return out
}

// Committed-tree secret scan via the FLEET-pinned TruffleHog (never a
// system/unpinned one — TruffleHog has been supply-chain-compromised in the
// past, so the pin + version-gate is the trust boundary). Resolves the binary
// (PATH then the dlx cache), accepts only the pinned --version, then scans the
// repo's git tree. Fails LOUD (tool-missing finding) rather than silent-clean
// when the pinned binary is unavailable or the wrong version.
async function runSecretScan(cwd: string): Promise<DoctorFinding[]> {
  const pinnedVersion = readPinnedTrufflehogVersion(cwd)
  if (!pinnedVersion) {
    return [formatToolMissingFinding()]
  }
  // PATH first, then the dlx cache; accept ONLY the fleet-pinned version. An
  // unpinned or wrong-version TruffleHog is refused, never used.
  const bin = resolveTrufflehogBinaries().find(candidate => {
    const verR = spawnSync(candidate, ['--version'], {
      cwd,
      stdioString: true,
      timeout: 15_000,
    })
    const verOut = `${verR.stdout ?? ''}${verR.stderr ?? ''}`
    return verOut.includes(pinnedVersion)
  })
  if (!bin) {
    return [formatToolMissingFinding()]
  }
  let out = ''
  try {
    const r = await spawn(
      bin,
      ['git', `file://${cwd}`, '--no-update', '--json'],
      { cwd, stdioString: true, timeout: 180_000 },
    )
    out = String(r.stdout ?? '')
  } catch (e: unknown) {
    if (isSpawnError(e)) {
      // TruffleHog exits non-zero when it finds verified secrets — its stdout
      // still carries the JSONL findings, so parse it rather than bailing.
      out = String(e.stdout ?? '')
      if (!out.trim()) {
        return [
          {
            fix: 'Re-run `node scripts/fleet/doctor.mts --probe-secrets` and review the TruffleHog error above; the secret scan did not complete (NOT confirmed clean).',
            fixable: false,
            saw: `TruffleHog exited non-zero with no parseable output: ${errorMessage(e)}`,
            wanted: 'TruffleHog to complete the scan and emit JSONL findings',
            what: 'Secret scan failed to complete',
            where: 'trufflehog git file://<repo> --json',
          },
        ]
      }
    } else {
      return [formatToolMissingFinding()]
    }
  }
  return formatSecretFindings(parseTruffleHogFindings(out))
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const doFix = argv.includes('--fix')
  const doProbeGit = argv.includes('--probe-git')
  const doProbeInstall = argv.includes('--probe-install')
  const doProbeSecrets = argv.includes('--probe-secrets')

  const cwd = process.cwd()

  // Read pnpm-workspace.yaml — required; fail loud if unreadable.
  const workspaceYamlPath = path.join(cwd, 'pnpm-workspace.yaml')
  if (!existsSync(workspaceYamlPath)) {
    logger.error(
      [
        'What:  pnpm-workspace.yaml not found',
        `Where: ${workspaceYamlPath}`,
        'Saw:   file absent — doctor must run from a repo root',
        'Fix:   cd to the repo root and re-run node scripts/fleet/doctor.mts',
      ].join('\n'),
    )
    process.exitCode = 1
    return
  }
  const workspaceYaml = readFileSync(workspaceYamlPath, 'utf8')

  // Read the cascaded fleet catalog. The loader accepts three locations,
  // first hit wins; the fleet convention (cascade + guard + rules) places it
  // at .config/fleet/pnpm-workspace.fleet.yaml — the others are transition
  // fallbacks so a member mid-wave keeps working.
  const fleetYamlCandidates = [
    path.join(cwd, '.config', 'fleet', 'pnpm-workspace.fleet.yaml'),
    path.join(cwd, '.config', 'pnpm-workspace.fleet.yaml'),
    path.join(cwd, 'pnpm-workspace.fleet.yaml'),
  ]
  const fleetYamlPath = fleetYamlCandidates.find(p => existsSync(p))
  const fleetYaml = fleetYamlPath
    ? readFileSync(fleetYamlPath, 'utf8')
    : undefined

  // Enumerate workspace package.jsons.
  const pkgPaths = discoverPackageJsonPaths({ cwd, workspaceYaml })
  // Always include the root package.json.
  const rootPkgPath = path.join(cwd, 'package.json')
  const allPkgPaths = existsSync(rootPkgPath)
    ? [rootPkgPath, ...pkgPaths.filter(p => p !== rootPkgPath)]
    : pkgPaths

  const packageJsons = allPkgPaths.map(p => ({
    content: readFileSync(p, 'utf8'),
    path: path.relative(cwd, p),
  }))

  // GAP 1: catalog-reference-without-entry.
  const refs = collectCatalogRefs({ packageJsons, workspaceYaml })
  const { findings: gapFindings, fixes } = diagnoseCatalogGaps({
    fleetYaml,
    refs,
    workspaceYaml,
  })

  const allFindings: DoctorFinding[] = [...gapFindings]
  let catalogFixed = false

  if (fixes.length > 0 && doFix) {
    const updated = applyCatalogFixes({ fixes, workspaceYaml })
    writeFileSync(workspaceYamlPath, updated, 'utf8')
    logger.info(
      `doctor --fix: applied ${fixes.length} catalog fix(es) to pnpm-workspace.yaml`,
    )
    catalogFixed = true
    // Remove the now-fixed fixable findings from the running total.
    allFindings.splice(
      0,
      allFindings.length,
      ...allFindings.filter(f => !f.fixable),
    )
  }

  // GAP 11: direct pins shadowing catalog entries — the pin wins over the
  // catalog, so catalog bumps silently no-op (a repo can run a stale tool
  // version while its catalog reports current). Fix rewrites the pin to
  // "catalog:"; the install probe below then refreshes the lockfile check.
  const { findings: shadowFindings, fixes: shadowFixes } =
    diagnosePinShadowGaps({ packageJsons, workspaceYaml })
  if (shadowFixes.length > 0 && doFix) {
    for (const shadowFix of shadowFixes) {
      const absPath = path.join(cwd, shadowFix.path)
      writeFileSync(
        absPath,
        applyPinShadowFixes({
          content: readFileSync(absPath, 'utf8'),
          deps: shadowFix.deps,
        }),
        'utf8',
      )
    }
    const depCount = shadowFixes.reduce((n, f) => n + f.deps.length, 0)
    logger.info(
      `doctor --fix: rewrote ${depCount} pin(s) to catalog: across ${shadowFixes.length} package.json file(s) — run pnpm install to refresh the lockfile`,
    )
    catalogFixed = true
    allFindings.push(...shadowFindings.filter(f => !f.fixable))
  } else {
    allFindings.push(...shadowFindings)
  }

  // GAP: lockfile ↔ catalog drift — a bumped pnpm-workspace.yaml catalog entry
  // not yet reflected in pnpm-lock.yaml's resolved catalogs (CI's
  // --frozen-lockfile then fails). Cheap pure file reads, so it always runs;
  // report-only (the fix, `pnpm install`, is pnpm-owned).
  const lockfilePath = path.join(cwd, 'pnpm-lock.yaml')
  if (existsSync(lockfilePath)) {
    allFindings.push(
      ...diagnoseLockfileCatalogDrift({
        lockfileYaml: readFileSync(lockfilePath, 'utf8'),
        workspaceYaml,
      }),
    )
  }

  // GAP: Brewfile drift — an enrolled repo's (repo-root Brewfile present)
  // committed Brewfile out of sync with a fresh render of the current
  // `.github/` brew install sites, which is what makes
  // `check/brew-install-is-pinned.mts` red. Cheap pure file reads, so it
  // always runs. A repo with no Brewfile is not enrolled — no finding
  // (enrollment stays a deliberate, separate step per tasks #18/#19).
  const rootBrewfilePath = brewfilePath(cwd)
  const brewfileContent = existsSync(rootBrewfilePath)
    ? readFileSync(rootBrewfilePath, 'utf8')
    : undefined
  const brewfileDrift = findBrewfileDrift({
    brewfileContent,
    discoveredTools: findManifestBrewSites(cwd),
    soakDays: SOAK_DAYS,
  })
  if (brewfileDrift.enrolled && brewfileDrift.drifted) {
    if (doFix) {
      writeFileSync(rootBrewfilePath, brewfileDrift.expected, 'utf8')
      logger.info(
        'doctor --fix: regenerated Brewfile (was out of sync with .github brew install sites)',
      )
    } else {
      allFindings.push(
        formatBrewfileDriftFinding({
          brewfilePath: path.relative(cwd, rootBrewfilePath),
          expected: brewfileDrift.expected,
          soakDays: SOAK_DAYS,
        }),
      )
    }
  }

  // GAP 2: soak-window probe — only when --fix applied catalog fixes or
  // --probe-install is passed explicitly (per design decision 6).
  if (catalogFixed || doProbeInstall) {
    logger.info('doctor: running pnpm install probe (lockfile-only)…')
    let probeOutput = ''
    try {
      await spawn(
        'pnpm',
        ['install', '--lockfile-only', '--no-frozen-lockfile'],
        { shell: process.platform === 'win32', stdioString: true },
      )
    } catch (e: unknown) {
      // lib-spawn rejects on non-zero exit; read the full stderr + stdout so
      // soak violations beyond line 1 are not truncated.
      if (isSpawnError(e)) {
        probeOutput = `${e.stderr ?? ''}\n${e.stdout ?? ''}`.trim()
      } else {
        probeOutput = errorMessage(e)
      }
    }
    if (probeOutput) {
      const soakSpecs = parseSoakViolations(probeOutput)
      if (soakSpecs.length > 0) {
        for (const spec of soakSpecs) {
          allFindings.push(formatSoakFinding(spec))
        }
      } else {
        // Non-zero pnpm exit but no soak signature — surface raw output.
        allFindings.push({
          what: 'pnpm install probe failed (non-soak error)',
          where: 'pnpm install --lockfile-only --no-frozen-lockfile',
          saw: `pnpm exited non-zero; output:\n${probeOutput}`,
          wanted: 'pnpm install to resolve cleanly (exit 0).',
          fix: 'Review the pnpm output above and resolve the install failure manually.',
          fixable: false,
        })
      }
    }
  }

  // GAP 3/5/6/10: git hygiene probes — only when inside a git repo and either
  // --probe-git is passed explicitly or --fix is active. These probes run git
  // commands directly (spawnSync, no network) so they are gated behind an
  // explicit flag to avoid surprising non-git invocations. --probe-git is the
  // lightweight flag; --fix also enables them since a healthy install requires
  // a healthy git state.
  const gitDir = path.join(cwd, '.git')
  if ((doProbeGit || doFix) && existsSync(gitDir)) {
    const defaultBranch = resolveDefaultBranch(cwd)

    // GAP 5: unsigned commits on the default branch.
    const logR = spawnSync(
      'git',
      ['log', '--format=%H\t%G?', `origin/${defaultBranch}..HEAD`],
      { cwd, stdioString: true, timeout: 30_000 },
    )
    if (logR.status === 0 && typeof logR.stdout === 'string') {
      const unsignedFinding = detectUnsignedCommits(logR.stdout)
      if (unsignedFinding) {
        allFindings.push(unsignedFinding)
      }
    }

    // GAP 6: diverged default branch (behind > 0 vs origin, LOCAL ref only —
    // no network fetch; the ref may be stale but we never run git fetch here).
    const rlrR = spawnSync(
      'git',
      ['rev-list', '--left-right', '--count', `origin/${defaultBranch}...HEAD`],
      { cwd, stdioString: true, timeout: 30_000 },
    )
    if (rlrR.status === 0 && typeof rlrR.stdout === 'string') {
      const parts = rlrR.stdout.trim().split(/\s+/)
      const behind = parseInt(parts[0] ?? '0', 10)
      const ahead = parseInt(parts[1] ?? '0', 10)
      if (!Number.isNaN(behind) && !Number.isNaN(ahead)) {
        const divergedFinding = detectDivergedMain(ahead, behind, {
          squashHistory: isSquashHistoryRepo(cwd),
        })
        if (divergedFinding) {
          allFindings.push(divergedFinding)
        }
      }
    }

    // GAP 10: removable cascade worktrees.
    const wtR = spawnSync('git', ['worktree', 'list', '--porcelain'], {
      cwd,
      stdioString: true,
      timeout: 15_000,
    })
    if (wtR.status === 0 && typeof wtR.stdout === 'string') {
      const wtFinding = detectRemovableWorktrees(wtR.stdout)
      if (wtFinding) {
        allFindings.push(wtFinding)
      }
    }

    // GAP 3: stranded cascade artifacts (local-only cascade commits +
    // superseded cascade worktrees). Prefers cleanup-stranded --dry-run when
    // the wheelhouse-owned script is present (wheelhouse self-doctor). In fleet
    // members scripts/repo/ is not cascaded, so falls back to an inline git-log
    // grep that detects the same `chore(wheelhouse): cascade template@<sha>`
    // pattern without shelling to a path that does not exist. A missing script
    // that silently reports healthy is a fail-open violation of the
    // fail-LOUD rule (code-first-then-ai).
    const cleanupScriptPath = path.join(
      cwd,
      'scripts',
      'repo',
      'cleanup-stranded.mts',
    )
    if (existsSync(cleanupScriptPath)) {
      // Wheelhouse checkout: shell to the authoritative implementation.
      const strandedR = spawnSync(
        'node',
        ['scripts/repo/cleanup-stranded.mts', '--target', '.', '--dry-run'],
        { cwd, stdioString: true, timeout: 60_000 },
      )
      const strandedOut = [
        typeof strandedR.stdout === 'string' ? strandedR.stdout : '',
        typeof strandedR.stderr === 'string' ? strandedR.stderr : '',
      ]
        .join('\n')
        .trim()
      if (strandedOut) {
        const strandedFinding = detectStrandedCascade(strandedOut)
        if (strandedFinding) {
          allFindings.push(strandedFinding)
        }
      }
    } else {
      // Fleet member: cleanup-stranded.mts is wheelhouse-only. Run inline
      // detection via git log subject grep — equivalent to the plan step the
      // full script would run, without the destructive apply side.
      const logSubjectR = spawnSync(
        'git',
        ['log', '--format=%H\t%s', `origin/${defaultBranch}..HEAD`],
        { cwd, stdioString: true, timeout: 30_000 },
      )
      const strandedCommits: string[] = []
      if (logSubjectR.status === 0 && typeof logSubjectR.stdout === 'string') {
        for (const line of logSubjectR.stdout.split('\n')) {
          const trimmed = line.trim()
          if (
            trimmed &&
            /chore\(wheelhouse\): cascade template@[0-9a-f]+/.test(trimmed)
          ) {
            strandedCommits.push(trimmed)
          }
        }
      }
      // Reuse the worktree output already collected for GAP 10.
      const strandedWorktrees: string[] =
        wtR.status === 0 && typeof wtR.stdout === 'string'
          ? wtR.stdout
              .split('\n\n')
              .filter(block =>
                /branch refs\/heads\/chore\/wheelhouse-/.test(block),
              )
              .map(block => {
                const branchLine =
                  block.match(/branch refs\/heads\/(.+)/)?.[1] ?? ''
                const pathLine = block.match(/worktree (.+)/)?.[1] ?? ''
                return `${branchLine}  ${pathLine}`
              })
              .filter(entry => entry.trim() !== '  ')
          : []
      if (strandedCommits.length > 0 || strandedWorktrees.length > 0) {
        allFindings.push(
          formatStrandedCascadeFinding({
            bailReason: undefined,
            strandedCommits,
            strandedWorktrees,
          }),
        )
      }
    }
  }

  // Secret-scan probe — gated behind --probe-secrets only (spawns the
  // fleet-pinned TruffleHog + scans the git tree, slower than the pure checks,
  // so it is opt-in and never runs implicitly under --fix).
  if (doProbeSecrets) {
    allFindings.push(...(await runSecretScan(cwd)))
  }

  // Print all findings.
  if (allFindings.length > 0) {
    logger.error('')
    logger.info(`Fleet doctor found ${allFindings.length} unfixed finding(s):`)
    for (let i = 0; i < allFindings.length; i += 1) {
      printFinding(allFindings[i]!, i)
    }
    if (!doFix && fixes.length > 0) {
      logger.error('')
      logger.info(
        'Run `node scripts/fleet/doctor.mts --fix` to apply the auto-fixable catalog fixes.',
      )
    }
    process.exitCode = 1
  } else {
    logger.info('Fleet doctor: no issues found.')
  }
}

if (isMainModule(import.meta.url)) {
  void (async () => {
    await main()
  })().catch((e: unknown) => {
    logger.error(errorMessage(e))
    process.exitCode = 1
  })
}
