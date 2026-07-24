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
import { runGitHygieneProbes } from './doctor-git-probes.mts'
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
import { parseListBlock } from './lib/workspace-yaml.mts'
import { brewfilePath, findManifestBrewSites } from './update/brew-parse.mts'
import { isMainModule } from './_shared/is-main-module.mts'
import { REPO_ROOT } from './paths.mts'

const logger = getDefaultLogger()

// Print a finding in the canonical four-ingredient format.
function printFinding(f: DoctorFinding, idx: number): void {
  logger.error('')
  logger.info(`Finding ${idx + 1}:`)
  logger.info(`  What:  ${f.what}`)
  logger.info(`  Where: ${f.where}`)
  logger.info(`  Saw:   ${f.saw}`)
  logger.info(`Fix:`)
  logger.group()
  const fixLines = f.fix.split('\n')
  for (let i = 0, { length } = fixLines; i < length; i += 1) {
    logger.info(fixLines[i]!)
  }
  logger.groupEnd()
}

// Discover workspace package.json paths via the packages: glob list.
function discoverPackageJsonPaths(config: {
  cwd: string
  workspaceYaml: string
}): string[] {
  const cfg = Object.assign(Object.create(null), config) as typeof config
  const patterns = parseListBlock(cfg.workspaceYaml, { blockKey: 'packages' })
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
    cwd: cfg.cwd,
    absolute: true,
    ignore: ignorePatterns,
  })
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

  // --root <dir>: explicit repo-root override — the seam fixture-driven tests
  // use to point the doctor at a temp repo. Production runs omit it and the
  // script-location REPO_ROOT holds (cwd-independent by convention).
  const rootFlagIndex = argv.indexOf('--root')
  const rootOverride =
    rootFlagIndex !== -1 ? argv[rootFlagIndex + 1] : undefined
  const cwd = rootOverride ?? REPO_ROOT

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
  // --probe-git is passed explicitly or --fix is active. --probe-git is the
  // lightweight flag; --fix also enables them since a healthy install requires
  // a healthy git state.
  allFindings.push(...runGitHygieneProbes({ cwd, doFix, doProbeGit }))

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
