/*
 * @file Code-as-law for pnpm compatibility patches (see
 *   docs/agents.md/fleet/pnpm-patching.md). A pnpm patch is opaque (a diff
 *   against minified vendor code) and high-trust (it rewrites a dependency).
 *   What a patch fixes is an API CONTRACT — the version itself is handled
 *   separately by `overrides:` / the update. So every `patchedDependencies`
 *   entry must be JUSTIFIED on its own terms:
 *     1. a rationale comment naming the API contract it restores (and for whom),
 *     2. the referenced .patch file exists,
 *     3. the patched `<pkg>@<ver>` is actually RESOLVED in pnpm-lock.yaml — i.e.
 *        the patch applies to something real, not a phantom version (a patch
 *        for an unresolved version is dead weight).
 *   Deliberately NOT coupled to a force/override: a patch's job is the contract,
 *   not the version requirement. A contract patch can be justified whether the
 *   version arrived via an override-force, a security bump, or natural
 *   resolution. Self-contained (reads pnpm-workspace.yaml + pnpm-lock.yaml), so
 *   it cascades + runs identically everywhere. Vacuously passes with no patches.
 */

import { existsSync, readFileSync } from 'node:fs'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

const logger = getDefaultLogger()
const WORKSPACE = 'pnpm-workspace.yaml'
const LOCKFILE = 'pnpm-lock.yaml'

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Is `<pkg>@<ver>` a resolved package key in the lockfile? Package keys look
// like `  'isexe@4.0.0':` or `  'isexe@4.0.0(peer@x)':`; a patch targets the
// bare pkg@ver, so match that prefix optionally followed by a peer suffix.
function resolvedInLockfile(spec: string): boolean {
  if (!existsSync(LOCKFILE)) {
    return true
  }
  const lock = readFileSync(LOCKFILE, 'utf8')
  const re = new RegExp(`^ {2}'?${escapeRegExp(spec)}(?:'|@|\\(|:)`, 'm')
  return re.test(lock)
}

function main(): void {
  if (!existsSync(WORKSPACE)) {
    return
  }
  const lines = readFileSync(WORKSPACE, 'utf8').split('\n')
  const start = lines.findIndex(
    line => line.trimEnd() === 'patchedDependencies:',
  )
  if (start === -1) {
    logger.log('No patchedDependencies — nothing to justify.')
    return
  }
  const findings: string[] = []
  let pendingComment = false
  for (let i = start + 1, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (/^[a-zA-Z]/.test(line)) {
      break
    }
    const trimmed = line.trim()
    if (trimmed === '') {
      continue
    }
    if (trimmed.startsWith('#')) {
      pendingComment = true
      continue
    }
    // Match a YAML map line `  '<spec>': '<value>'`: group 1 = the key
    // (spec, optionally quoted), group 2 = the value (patch path), each
    // stopping at a quote, inline `#` comment, or whitespace.
    const m = /^\s+'?([^':]+?)'?\s*:\s*'?([^'#\s]+)'?/.exec(line)
    if (!m) {
      pendingComment = false
      continue
    }
    const spec = m[1]!.trim()
    const patchPath = m[2]!.trim()
    if (!pendingComment) {
      findings.push(
        `patchedDependencies['${spec}'] has no rationale comment. Add a ` +
          `comment above it naming the API contract the patch restores and ` +
          `the consumer that needs it (see docs/agents.md/fleet/pnpm-patching.md).`,
      )
    }
    if (!existsSync(patchPath)) {
      findings.push(
        `patchedDependencies['${spec}'] references a missing patch file ` +
          `'${patchPath}'. Restore the file or remove the entry.`,
      )
    }
    if (!resolvedInLockfile(spec)) {
      findings.push(
        `patchedDependencies['${spec}'] patches a version not resolved in ` +
          `${LOCKFILE} — the patch is inapplicable (dead weight). Drop it, or ` +
          `fix the pkg@version it targets to one that actually resolves.`,
      )
    }
    pendingComment = false
  }
  if (findings.length > 0) {
    for (let i = 0, { length } = findings; i < length; i += 1) {
      logger.error(`✗ ${findings[i]!}`)
    }
    logger.error('')
    logger.error(
      `${findings.length} unjustified pnpm patch entr${findings.length === 1 ? 'y' : 'ies'}.`,
    )
    process.exitCode = 1
    return
  }
  logger.log('All pnpm patch entries are justified.')
}

main()
