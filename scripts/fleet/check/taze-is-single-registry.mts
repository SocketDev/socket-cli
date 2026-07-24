/*
 * @file Code-as-law for the taze single-registry posture (owner ruling):
 *   taze resolves versions via the CONFIGURED registry only — its
 *   fast-npm-meta hosted endpoint (npm.antfu.dev) is never network-allowed,
 *   anywhere. Unpatched, every taze lookup leaves for that endpoint, fleet
 *   egress policy blocks it, each lookup times out and taze still exits 0
 *   (false green). The fix is the single-registry pnpm patch, so two gates:
 *
 *   1. FORBIDDEN ENDPOINT — no tracked file may carry the endpoint's host:
 *      not a firewall allowlist, not a workflow source, not a compiled lock.
 *      Exempt: this guard, its test, and the taze patch file (the string may
 *      legitimately appear there in removed/redirected code context).
 *   2. PATCH PARITY — a taze catalog pin REQUIRES the matching
 *      patches/taze@<pin>.patch and (in the root workspace) the paired
 *      patchedDependencies: entry. A taze bump without a regenerated patch
 *      goes red until `pnpm patch taze` + `pnpm patch-commit` produce the new
 *      file; stale taze@<otherVersion>.patch files are flagged too. In the
 *      wheelhouse, the template/base canonical (fleet catalog + template
 *      patches/ + the bundle.json mirror path) is held to the same parity.
 *
 *   Self-contained (git ls-files + the workspace YAMLs), so it cascades and
 *   runs identically in every member. Vacuously passes with no taze pin.
 *   Exit codes: 0 — no forbidden endpoint + patch parity holds; 1 — a
 *   violation.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

// The vetoed fast-npm-meta host. This guard file itself is path-exempt below,
// so the literal here doesn't trip the scan.
const FORBIDDEN_HOST = 'npm.antfu.dev'

// Paths where the host string may legitimately appear: this guard (live +
// template copies), its basename-matched test, and the taze patch file
// (removed/redirected code context). Everything else is a violation.
// oxlint-disable-next-line socket/require-regex-comment -- documented above
const EXEMPT_RE =
  /(?:^|\/)(?:scripts\/fleet\/check\/taze-is-single-registry\.mts|taze-is-single-registry\.test\.mts|patches\/taze@[^/]+\.patch)$/

function trackedFiles(cwd: string): string[] {
  const result = spawnSync('git', ['ls-files', '-z'], { cwd, stdio: 'pipe' })
  if (result.status !== 0) {
    return []
  }
  return String(result.stdout ?? '')
    .split('\0')
    .filter(Boolean)
}

/**
 * Tracked files carrying the forbidden host, exempt paths excluded. Exported
 * for tests (pure over the injected file list + reader).
 */
export function scanForForbiddenHost(
  files: readonly string[],
  readFile: (file: string) => string | undefined,
): string[] {
  const hits: string[] = []
  for (let i = 0, { length } = files; i < length; i += 1) {
    const file = files[i]!
    if (EXEMPT_RE.test(file)) {
      continue
    }
    const content = readFile(file)
    if (content !== undefined && content.includes(FORBIDDEN_HOST)) {
      hits.push(file)
    }
  }
  return hits
}

/**
 * The taze version pinned in a workspace/catalog YAML's `catalog:`-style map
 * (`'taze': 19.16.0`, quotes optional), or undefined when absent. Exported
 * for tests.
 */
export function tazePinOf(yamlContent: string): string | undefined {
  // A map line keying bare `taze` (NOT `taze@<ver>` — that's the
  // patchedDependencies spec, and NOT a `- 'taze@…'` list bullet).
  // oxlint-disable-next-line socket/require-regex-comment -- documented above
  const m = /^[ \t]+'?taze'?:\s*'?([^'#\s]+)'?/m.exec(yamlContent)
  return m?.[1]
}

interface ParityTarget {
  // Human label for findings.
  label: string
  // The YAML carrying the taze catalog pin, repo-relative.
  yamlPath: string
  // The patches dir the pin's patch must live in, repo-relative.
  patchesDir: string
  // Whether this YAML must also carry the patchedDependencies entry (the
  // root workspace does; the template fleet-catalog has no such block).
  requireEntry: boolean
}

/**
 * Patch-parity findings for one target: pin → patch file → (optionally) the
 * patchedDependencies entry, plus stale taze patch files. Exported for tests.
 */
export function checkParityTarget(cwd: string, target: ParityTarget): string[] {
  const findings: string[] = []
  const yamlAbs = path.join(cwd, target.yamlPath)
  if (!existsSync(yamlAbs)) {
    return findings
  }
  const content = readFileSync(yamlAbs, 'utf8')
  const pin = tazePinOf(content)
  const patchesAbs = path.join(cwd, target.patchesDir)
  const tazePatches = existsSync(patchesAbs)
    ? readdirSync(patchesAbs).filter(
        f => f.startsWith('taze@') && f.endsWith('.patch'),
      )
    : []
  if (!pin) {
    // No taze pin — nothing to hold parity against, but a lingering taze
    // patch with no pin is dead weight worth flagging.
    for (let i = 0, { length } = tazePatches; i < length; i += 1) {
      findings.push(
        `${target.label}: ${target.patchesDir}/${tazePatches[i]!} exists but ` +
          `${target.yamlPath} pins no taze — remove the orphaned patch or ` +
          'restore the catalog pin.',
      )
    }
    return findings
  }
  const expectedPatch = `taze@${pin}.patch`
  const expectedPatchPath = `${target.patchesDir}/${expectedPatch}`
  if (!tazePatches.includes(expectedPatch)) {
    findings.push(
      `${target.label}: taze is pinned at ${pin} in ${target.yamlPath} but ` +
        `${expectedPatchPath} is missing — the single-registry patch must ` +
        'track the pin. Regenerate it: `pnpm patch taze`, re-apply the ' +
        'single-registry edit (drop the default-registry fast path in ' +
        'getVersionsForContext), then `pnpm patch-commit` and commit the ' +
        `new ${expectedPatchPath}.`,
    )
  }
  for (let i = 0, { length } = tazePatches; i < length; i += 1) {
    const patch = tazePatches[i]!
    if (patch !== expectedPatch) {
      findings.push(
        `${target.label}: stale ${target.patchesDir}/${patch} — taze is ` +
          `pinned at ${pin}, so only ${expectedPatch} belongs. Remove the ` +
          'stale patch file.',
      )
    }
  }
  if (target.requireEntry) {
    // The exact `taze@<pin>: patches/taze@<pin>.patch` map line, quotes
    // optional. The path in the entry is always the member-relative
    // `patches/…` form.
    const specEsc = `taze@${pin}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const entryRe = new RegExp(
      `^[ \\t]+'?${specEsc}'?\\s*:\\s*'?patches/${specEsc}\\.patch'?\\s*(?:#.*)?$`,
      'm',
    )
    if (!entryRe.test(content)) {
      findings.push(
        `${target.label}: ${target.yamlPath} pins taze ${pin} but carries no ` +
          `\`patchedDependencies\` entry \`taze@${pin}: ` +
          `patches/taze@${pin}.patch\` — without it pnpm installs taze ` +
          'UNPATCHED and version lookups leave the configured registry. ' +
          'The fleet cascade splices the entry; locally, add it and run ' +
          '`pnpm install`.',
      )
    }
  }
  return findings
}

function main(): void {
  // Implicit working directory: like dedup-patches-are-justified, this check
  // reads repo-relative paths from wherever the check runner invoked it (the
  // repo root in every runner; the e2e tests spawn it from a fixture dir).
  const cwd = '.'
  const findings: string[] = []

  // Gate 1 — the forbidden endpoint host in any tracked file.
  const hits = scanForForbiddenHost(trackedFiles(cwd), file => {
    try {
      return readFileSync(path.join(cwd, file), 'utf8')
    } catch {
      // Unreadable (deleted mid-scan, submodule stub) — nothing to scan.
      return undefined
    }
  })
  for (let i = 0, { length } = hits; i < length; i += 1) {
    findings.push(
      `${hits[i]!}: contains the vetoed host \`${FORBIDDEN_HOST}\` — taze ` +
        'version resolution is registry-only via the single-registry patch; ' +
        'that endpoint is never network-allowed (no firewall allowlists, no ' +
        'workflow sources, no compiled locks). Remove or reword the ' +
        'reference.',
    )
  }

  // Gate 2 — patch parity, member root always; template canonical when this
  // is the wheelhouse.
  const targets: ParityTarget[] = [
    {
      label: 'root',
      yamlPath: 'pnpm-workspace.yaml',
      patchesDir: 'patches',
      requireEntry: true,
    },
  ]
  if (existsSync(path.join(cwd, 'template', 'base'))) {
    targets.push({
      label: 'template',
      yamlPath: 'template/base/.config/fleet/pnpm-workspace.fleet.yaml',
      patchesDir: 'template/base/patches',
      requireEntry: false,
    })
  }
  for (let i = 0, { length } = targets; i < length; i += 1) {
    findings.push(...checkParityTarget(cwd, targets[i]!))
  }

  // Wheelhouse-only: the bundle.json mirror must ship the pinned patch path,
  // or members never receive the regenerated file after a bump.
  const bundlePath = path.join(
    cwd,
    'scripts/repo/sync-scaffolding/manifest/bundle.json',
  )
  if (existsSync(bundlePath)) {
    const fleetYaml = path.join(
      cwd,
      'template/base/.config/fleet/pnpm-workspace.fleet.yaml',
    )
    const pin = existsSync(fleetYaml)
      ? tazePinOf(readFileSync(fleetYaml, 'utf8'))
      : undefined
    if (
      pin &&
      !readFileSync(bundlePath, 'utf8').includes(`patches/taze@${pin}.patch`)
    ) {
      findings.push(
        `bundle.json: no mirror entry for patches/taze@${pin}.patch — the ` +
          'cascade cannot deliver the pinned patch to members. Update the ' +
          'patch mirror entry in scripts/repo/sync-scaffolding/manifest/' +
          'bundle.json to the new filename.',
      )
    }
  }

  if (findings.length > 0) {
    for (let i = 0, { length } = findings; i < length; i += 1) {
      logger.error(`✗ ${findings[i]!}`)
    }
    logger.error('')
    logger.error(
      `${findings.length} taze single-registry violation${findings.length === 1 ? '' : 's'}.`,
    )
    process.exitCode = 1
    return
  }
  logger.log(
    'taze is single-registry: no forbidden endpoint, patch tracks the pin.',
  )
}

if (isMainModule(import.meta.url)) {
  try {
    main()
  } catch (e) {
    logger.fail(`[check-taze-is-single-registry] error: ${e}`)
    process.exitCode = 1
  }
}
