#!/usr/bin/env node
/*
 * @file One-shot soak-bypass: add a dated `minimumReleaseAgeExclude` entry for
 *   a package whose 7-day soak hasn't cleared yet, so an install can proceed
 *   now. Bakes in the manual dance the user would otherwise repeat:
 *
 *   1. Look up the package's npm publish date (full packument `time` map).
 *   2. Splice `# published: <date> | removable: <date+7d>` + the `- 'pkg@ver'`
 *      bullet into `pnpm-workspace.yaml`'s `minimumReleaseAgeExclude:` block
 *      (idempotent — skips if already there).
 *   3. Print the follow-up: `pnpm install`, and — when the entry should reach
 *      every fleet repo — add it to `EXPECTED_RELEASE_AGE_EXCLUDE` in
 *      `scripts/sync-scaffolding/manifest.mts` + cascade. The daily
 *      `updating-daily` job removes the entry again once `removable` passes, so
 *      this is add-only; promotion is automatic. Usage: `node
 *      scripts/fleet/soak-bypass.mts <pkg>@<version>` Exit codes:
 *
 *   - 0 — entry added (or already present).
 *   - 1 — bad args, version not found on npm, or no `minimumReleaseAge:` anchor.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import process from 'node:process'

import { runCheck as regenNpmrcMirror } from './check/npmrc-versioned-soak-mirror-is-derived.mts'
import { PNPM_WORKSPACE_YAML, REPO_ROOT } from './paths.mts'
import { fetchPackagePublishDate } from './registry-publish-date.mts'
import { isMainModule } from './_shared/is-main-module.mts'

const SOAK_DAYS = 7

interface ParsedSpec {
  name: string
  version: string
}

/**
 * Split `<pkg>@<version>` into name + version, handling scoped names
 * (`@scope/pkg@1.2.3`). Returns undefined on a missing/empty version.
 */
export function parseSpec(spec: string): ParsedSpec | undefined {
  // Last `@` that isn't the scope-leading one separates name from version.
  const at = spec.lastIndexOf('@')
  if (at <= 0) {
    return undefined
  }
  const name = spec.slice(0, at)
  const version = spec.slice(at + 1)
  if (!name || !version) {
    return undefined
  }
  return { name, version }
}

/**
 * ISO date (YYYY-MM-DD) `days` after `fromISO`.
 */
export function addDaysISO(fromISO: string, days: number): string {
  const ms = Date.parse(fromISO)
  const then = new Date(ms + days * 24 * 60 * 60 * 1000)
  return then.toISOString().slice(0, 10)
}

/**
 * Insert the annotated soak-exclude (`# published… | removable…` + the bullet)
 * at the end of the `minimumReleaseAgeExclude:` block. Idempotent: returns the
 * content unchanged when an exact-tag entry is already present. Returns
 * undefined when there's no `minimumReleaseAge:` anchor to attach the block
 * to.
 */
export function spliceSoakEntry(
  content: string,
  spec: ParsedSpec,
  publishedISO: string,
  removableISO: string,
): string | undefined {
  const tag = `${spec.name}@${spec.version}`
  // Already excluded (any annotation state) → no-op.
  const dupRe = new RegExp(
    `^\\s*-\\s*['"]?${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]?\\s*$`,
    'm',
  )
  if (dupRe.test(content)) {
    return content
  }
  const annotation = `  # published: ${publishedISO} | removable: ${removableISO}`
  const bullet = `  - '${tag}'`
  const lines = content.split('\n')
  const blockIdx = lines.findIndex(
    l => l.trimEnd() === 'minimumReleaseAgeExclude:',
  )
  if (blockIdx !== -1) {
    // Append at the end of the existing block.
    let end = blockIdx + 1
    while (end < lines.length) {
      const ln = lines[end]
      if (ln === undefined || ln === '' || (ln.length > 0 && !/^\s/.test(ln))) {
        break
      }
      end += 1
    }
    lines.splice(end, 0, annotation, bullet)
    return lines.join('\n')
  }
  // No block — create it right after the `minimumReleaseAge:` scalar anchor.
  const anchorIdx = lines.findIndex(l =>
    l.trimStart().startsWith('minimumReleaseAge:'),
  )
  if (anchorIdx === -1) {
    return undefined
  }
  lines.splice(
    anchorIdx + 1,
    0,
    'minimumReleaseAgeExclude:',
    annotation,
    bullet,
  )
  return lines.join('\n')
}

async function main(): Promise<void> {
  const spec = parseSpec(process.argv[2] ?? '')
  if (!spec) {
    process.stderr.write(
      'Usage: node scripts/fleet/soak-bypass.mts <pkg>@<version>\n' +
        '  e.g. node scripts/fleet/soak-bypass.mts compromise@14.15.1\n',
    )
    process.exit(1)
  }

  // The lean registry helper returns the already-sliced `YYYY-MM-DD` publish
  // date (or undefined when the version is unknown / the registry is
  // unreachable). soak-bypass is interactive (run by hand to bypass a soak), so
  // an undefined here is a hard stop, not the fail-open a CI check wants.
  const publishedISO = await fetchPackagePublishDate(spec.name, spec.version)
  if (!publishedISO) {
    process.stderr.write(
      `soak-bypass: ${spec.name}@${spec.version} not found on npm (no publish ` +
        `date). Check the name + version.\n`,
    )
    process.exit(1)
  }
  const removableISO = addDaysISO(publishedISO, SOAK_DAYS)

  const content = readFileSync(PNPM_WORKSPACE_YAML, 'utf8')
  const next = spliceSoakEntry(content, spec, publishedISO, removableISO)
  if (next === undefined) {
    process.stderr.write(
      `soak-bypass: no \`minimumReleaseAge:\` anchor in pnpm-workspace.yaml — ` +
        `add the soak setting first.\n`,
    )
    process.exit(1)
  }
  if (next === content) {
    process.stdout.write(
      `soak-bypass: ${spec.name}@${spec.version} already soak-excluded — no change.\n`,
    )
    process.exit(0)
  }
  writeFileSync(PNPM_WORKSPACE_YAML, next)
  // Mirror the pin's bare NAME into `.npmrc` for npm (>= v12, npm/cli#9532),
  // which matches by name/glob only. pnpm-workspace.yaml (dated `name@version`)
  // is canonical; this regenerates the derived `.npmrc versioned-soak-mirror`
  // block FROM it, so one command keeps both package managers in lockstep.
  regenNpmrcMirror(REPO_ROOT, { fix: true })
  process.stdout.write(
    `soak-bypass: added ${spec.name}@${spec.version} to minimumReleaseAgeExclude\n` +
      `  # published: ${publishedISO} | removable: ${removableISO}\n` +
      `  + mirrored '${spec.name}' into .npmrc (npm soak-exclude, name-only)\n\n` +
      `Next:\n` +
      `  1. pnpm install   (reconcile the lockfile)\n` +
      `  2. commit: chore(deps): soak-bypass ${spec.name}@${spec.version}\n` +
      `  3. fleet-wide? add '${spec.name}@${spec.version}' to ` +
      `EXPECTED_RELEASE_AGE_EXCLUDE in scripts/sync-scaffolding/manifest.mts + cascade.\n` +
      `\nThe daily updating-daily job removes this entry once ${removableISO} passes.\n`,
  )
  process.exit(0)
}

// Run only when invoked directly (CLI), not when imported by unit tests —
// main() calls process.exit, which would tear down the test runner.
if (isMainModule(import.meta.url)) {
  main()
}
