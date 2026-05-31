#!/usr/bin/env node
/**
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
 *      scripts/soak-bypass.mts <pkg>@<version>` Exit codes:
 *
 *   - 0 — entry added (or already present).
 *   - 1 — bad args, version not found on npm, or no `minimumReleaseAge:` anchor.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

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

/**
 * Fetch a package's npm publish date for `version` from the full packument.
 */
async function fetchPublishDate(
  name: string,
  version: string,
): Promise<string | undefined> {
  const url = `https://registry.npmjs.org/${encodeURIComponent(name).replace('%40', '@')}`
  try {
    // socket-hook: allow global-fetch -- soak tooling probes the npm registry directly; the lib http-request helper isn't a dependency in scripts/.
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
    })
    if (!response.ok) {
      return undefined
    }
    const json = (await response.json()) as {
      time?: Record<string, string> | undefined
    }
    return json.time?.[version]
  } catch {
    return undefined
  }
}

async function main(): Promise<void> {
  const spec = parseSpec(process.argv[2] ?? '')
  if (!spec) {
    process.stderr.write(
      'Usage: node scripts/soak-bypass.mts <pkg>@<version>\n' +
        '  e.g. node scripts/soak-bypass.mts compromise@14.15.1\n',
    )
    process.exit(1)
  }

  const published = await fetchPublishDate(spec.name, spec.version)
  if (!published) {
    process.stderr.write(
      `soak-bypass: ${spec.name}@${spec.version} not found on npm (no publish ` +
        `date). Check the name + version.\n`,
    )
    process.exit(1)
  }
  const publishedISO = published.slice(0, 10)
  const removableISO = addDaysISO(published, SOAK_DAYS)

  const here = path.dirname(fileURLToPath(import.meta.url))
  const repoRoot = path.resolve(here, '..')
  const yamlPath = path.join(repoRoot, 'pnpm-workspace.yaml')
  const content = readFileSync(yamlPath, 'utf8')
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
  writeFileSync(yamlPath, next)
  process.stdout.write(
    `soak-bypass: added ${spec.name}@${spec.version} to minimumReleaseAgeExclude\n` +
      `  # published: ${publishedISO} | removable: ${removableISO}\n\n` +
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
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
