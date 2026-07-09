// Fleet check — vite resolves rolldown-native (8.x) and esbuild is not in the
// tree.
//
//   1. RULE — the fleet bundler is rolldown, and esbuild is banned (CLAUDE.md
//      Tooling). vite 8.x is rolldown-native (bundles rolldown, no esbuild);
//      vite 6/7 hard-depend on esbuild. A repo that runs vitest pulls vite
//      transitively, so without a `vite: 8.x` catalog pin + a `'vite':
//      'catalog:'` override the transitive vite floats to 7.x and drags esbuild
//      in — surfacing as noisy Dependabot esbuild advisories (non-reachable
//      here, esbuild's Deno-only path, but the structurally-correct state is no
//      esbuild at all).
//   2. WHAT IT FAILS ON — a committed `pnpm-lock.yaml` that resolves any
//      `vite@<8` OR any `esbuild@` entry. Both are the same defect: a tree that
//      didn't get the rolldown-native pin.
//   3. THE FIX — catalog `vite: 8.x`, overrides `'vite': 'catalog:'` +
//      `'rolldown': 'catalog:'`, bump any package.json vitest hard-pin to the
//      catalog version (a hard-pin masks the catalog), and
//      `ignoredOptionalDependencies: [esbuild]` to drop vite 8's optional
//      esbuild peer, then `rm -rf node_modules pnpm-lock.yaml && pnpm install`
//      (a gentle relock won't re-derive). See docs/agents.md/fleet/tooling.md.
//
//   Exit codes: 0 — clean (vite 8.x, no esbuild) or no lockfile; 1 — drift.
//   Usage: node scripts/fleet/check/vite-is-rolldown-native.mts [--quiet]

import { existsSync, readFileSync } from 'node:fs'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { PNPM_LOCK } from '../paths.mts'

const logger = getDefaultLogger()

// Repo overlay opt-out for the esbuild ban ONLY (the vite<8 floor is
// unconditional). A repo with a legitimate non-bundler esbuild use — e.g.
// socket-lib's browser-bundle e2e arm — declares it with a reason:
//   .config/repo/vite-rolldown.json  →  { "allowEsbuild": "<why>" }
// The build bundler stays rolldown either way; this tolerates esbuild as a
// declared test/dev dependency, never as the bundler.
const REPO_OVERLAY = '.config/repo/vite-rolldown.json'
export function esbuildAllowReason(): string | undefined {
  if (!existsSync(REPO_OVERLAY)) {
    return undefined
  }
  try {
    const parsed = JSON.parse(readFileSync(REPO_OVERLAY, 'utf8')) as {
      allowEsbuild?: string | undefined
    }
    return typeof parsed.allowEsbuild === 'string' && parsed.allowEsbuild
      ? parsed.allowEsbuild
      : undefined
  } catch {
    return undefined
  }
}

export interface ViteFinding {
  // 'vite-too-old' (a vite@<8 resolution) or 'esbuild-present'.
  readonly kind: 'esbuild-present' | 'vite-too-old'
  // The offending resolved spec (e.g. 'vite@7.3.2', 'esbuild@0.27.7').
  readonly spec: string
}

// Match a top-level lock package key `  <name>@<version>:` — the resolution
// entries (two-space indent, name@semver, trailing colon). Peer-hash suffixes
// like `vite@8.0.14(@types/node@...)` are tolerated: the leading name@semver is
// captured before the first `(`.
const VITE_RE = /^ {2}'?vite@(\d+)\.\d/u
// Two-space indent, optional opening quote, then either a scoped platform
// binary `@esbuild/<platform>` (lowercase + digits + hyphens) or the bare
// `esbuild` package, followed by `@<digit>` — the start of a resolved version.
const ESBUILD_RE = /^ {2}'?(@esbuild\/[a-z0-9-]+|esbuild)@\d/u

/**
 * Scan a pnpm-lock.yaml body for vite-too-old / esbuild-present resolutions.
 * Pure (string in, findings out) so it unit-tests without a real lockfile.
 */
export function scanLock(lockBody: string): ViteFinding[] {
  const findings: ViteFinding[] = []
  const seen = new Set<string>()
  for (const line of lockBody.split('\n')) {
    const vm = VITE_RE.exec(line)
    if (vm && Number(vm[1]) < 8) {
      const spec = line.trim().replace(/:$/u, '').replace(/^'|'$/gu, '')
      const base = spec.split('(')[0]!
      if (!seen.has(base)) {
        seen.add(base)
        findings.push({ kind: 'vite-too-old', spec: base })
      }
      continue
    }
    if (ESBUILD_RE.test(line)) {
      const spec = line.trim().replace(/:$/u, '').replace(/^'|'$/gu, '')
      const base = spec.split('(')[0]!
      if (!seen.has(base)) {
        seen.add(base)
        findings.push({ kind: 'esbuild-present', spec: base })
      }
    }
  }
  return findings
}

export function main(): void {
  const quiet = process.argv.includes('--quiet')
  if (!existsSync(PNPM_LOCK)) {
    if (!quiet) {
      logger.success(
        'vite-is-rolldown-native: no pnpm-lock.yaml — nothing to check.',
      )
    }
    return
  }
  let findings = scanLock(readFileSync(PNPM_LOCK, 'utf8'))
  const allowReason = esbuildAllowReason()
  if (allowReason) {
    const tolerated = findings.filter(f => f.kind === 'esbuild-present')
    findings = findings.filter(f => f.kind !== 'esbuild-present')
    if (tolerated.length > 0 && !quiet) {
      logger.log(
        `vite-is-rolldown-native: tolerating ${tolerated.length} esbuild resolution(s) — ${REPO_OVERLAY}: ${allowReason}`,
      )
    }
  }
  if (findings.length === 0) {
    if (!quiet) {
      logger.success(
        'vite-is-rolldown-native: vite is 8.x rolldown-native; no esbuild in the tree.',
      )
    }
    return
  }
  logger.fail(
    `vite-is-rolldown-native: ${findings.length} rolldown-native violation(s) in pnpm-lock.yaml:`,
  )
  for (const f of findings) {
    logger.log(
      `  ${f.spec}  (${f.kind === 'vite-too-old' ? 'vite < 8 hard-depends on esbuild' : 'esbuild is fleet-banned (rolldown is the bundler)'})`,
    )
  }
  logger.log(
    'Fix: catalog `vite: 8.x` + overrides `vite`/`rolldown`: `catalog:`, bump any vitest hard-pin to the catalog version, `ignoredOptionalDependencies: [esbuild]`, then `rm -rf node_modules pnpm-lock.yaml && pnpm install`.',
  )
  process.exitCode = 1
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main()
}
