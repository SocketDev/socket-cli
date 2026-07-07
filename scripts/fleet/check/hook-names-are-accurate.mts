// Fleet check — hook name ⟷ declared type match.
//
// Fleet convention (CLAUDE.md hook naming): a `-guard` hook BLOCKS, a `-nudge`
// hook NUDGES. Every hook declares which it is via its typed `defineHook`
// instance: `export const hook = defineHook({ type: 'guard' | 'nudge', … })`.
// This check IMPORTS each hook and compares the DECLARED `.type` against the
// directory-name suffix — it reads the typed export, never the source text
// (see `socket/no-source-sniffing`). A mismatch means the name lies about
// behavior, or the dir was renamed without updating the declaration.
//
// Complements `hooks-have-no-guard-nudge-overlap` (which forbids a `-guard` AND
// `-nudge` for the SAME concern); this one holds each hook's own name to its
// declared type.
//
// ERROR (exit 1): a `-guard`/`-nudge` hook that exports no `defineHook`
// instance, or whose declared `.type` disagrees with its name suffix.
//
// Usage: node scripts/fleet/check/hook-names-are-accurate.mts [--quiet]

import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

export interface NameTypeMismatch {
  name: string
  kind: 'no-hook-export' | 'type-mismatch'
  declaredType: string | undefined
}

export function listHookNames(hooksDir: string): string[] {
  let entries: string[]
  try {
    entries = readdirSync(hooksDir)
  } catch {
    return []
  }
  const names: string[] = []
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const name = entries[i]!
    if (name === '_shared' || name.startsWith('.')) {
      continue
    }
    try {
      if (statSync(path.join(hooksDir, name)).isDirectory()) {
        names.push(name)
      }
    } catch {}
  }
  return names
}

/**
 * The `type` a hook's `defineHook` instance declares, read by IMPORTING the
 * module (import is side-effect-free: a contract hook's top-level `runHook`
 * no-ops unless it is the entrypoint/dispatcher). Returns undefined when the
 * module exports no `hook` (or fails to import).
 */
export async function declaredType(
  indexPath: string,
): Promise<string | undefined> {
  try {
    const mod = (await import(pathToFileURL(indexPath).href)) as {
      hook?: { type?: string | undefined } | undefined
    }
    return mod.hook?.type
  } catch {
    return undefined
  }
}

/**
 * Pure name⟷type rule. Returns a mismatch when a `-guard`/`-nudge`-named hook's
 * declared `.type` disagrees with its suffix (or it declares none). A name
 * ending in neither suffix is not a guard/nudge → no opinion (undefined).
 */
export function typeMismatch(
  name: string,
  declared: string | undefined,
): NameTypeMismatch | undefined {
  const isGuard = name.endsWith('-guard')
  const isNudge = name.endsWith('-nudge')
  if (!isGuard && !isNudge) {
    return undefined
  }
  const expected = isGuard ? 'guard' : 'nudge'
  if (declared === undefined) {
    return { name, kind: 'no-hook-export', declaredType: undefined }
  }
  if (declared !== expected) {
    return { name, kind: 'type-mismatch', declaredType: declared }
  }
  return undefined
}

/**
 * Classify every `-guard` / `-nudge` hook by whether its declared `.type`
 * matches its name suffix. Hooks ending in neither suffix (setup-*, sweepers,
 * etc.) are skipped — they are side-effect scripts, not guards/nudges.
 */
export async function findMismatches(
  hooksDir: string,
): Promise<NameTypeMismatch[]> {
  const out: NameTypeMismatch[] = []
  const names = listHookNames(hooksDir)
  for (let i = 0, { length } = names; i < length; i += 1) {
    const name = names[i]!
    if (!name.endsWith('-guard') && !name.endsWith('-nudge')) {
      continue
    }
    // eslint-disable-next-line no-await-in-loop -- import hooks in order; the set
    // is small and parallel import would race module initialization.
    const type = await declaredType(path.join(hooksDir, name, 'index.mts'))
    const mism = typeMismatch(name, type)
    if (mism) {
      out.push(mism)
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

async function main(): Promise<void> {
  const quiet = process.argv.includes('--quiet')
  const hooksDir = path.join(REPO_ROOT, '.claude', 'hooks', 'fleet')
  const mismatches = await findMismatches(hooksDir)

  if (mismatches.length) {
    logger.fail(
      '[check-hook-names-are-accurate] hook name does not match its declared type:',
    )
    for (let i = 0, { length } = mismatches; i < length; i += 1) {
      const m = mismatches[i]!
      if (m.kind === 'no-hook-export') {
        logger.error(
          `  ✗ ${m.name} is named \`-${m.name.endsWith('-guard') ? 'guard' : 'nudge'}\` but exports no defineHook instance — add \`export const hook = defineHook({ type, event, … })\`.`,
        )
      } else {
        const want = m.name.endsWith('-guard') ? 'guard' : 'nudge'
        logger.error(
          `  ✗ ${m.name} declares \`type: '${m.declaredType}'\` but its name says \`${want}\` — set \`type: '${want}'\` or rename the directory.`,
        )
      }
    }
    process.exitCode = 1
    return
  }

  if (!quiet) {
    logger.success(
      '[check-hook-names-are-accurate] every -guard declares type:guard and every -nudge type:nudge.',
    )
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main()
}
