/**
 * @file Resolve a package.json script to the node script it delegates to, so
 *   the pre-commit hook can run that script directly instead of through `pnpm
 *   run`. `pnpm` on PATH is the Socket Firewall shim: it boots the sfw proxy,
 *   which boots pnpm, which re-resolves the workspace — seconds of startup
 *   before the script's first line, many times the work a staged-scope gate
 *   does, and the same wrapper whose deadlock the step budget exists to
 *   survive. Prints the script path when the body is exactly `node <path>` —
 *   that command runs identically under the repo-pinned node
 *   `_shared/resolve-node.sh` already put on PATH. Prints nothing for any other
 *   body (a `bun test`, a body carrying extra flags, a shell pipeline), so
 *   those keep the wrapper: the hook must run what `pnpm run <script>` runs,
 *   never a guess at it. Usage: node .git-hooks/_shared/pkg-script-target.mts
 *   <script-name>
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

/**
 * The script path a `node <path>` package-script body delegates to, or
 * undefined when the body is anything else. A body carrying flags or extra
 * arguments (`node --test 'a/**' 'b/**'`) is deliberately rejected: reproducing
 * it token by token is a guess, and a guess that drifts from the package script
 * gates the commit on something other than what `pnpm run` runs.
 */
export function resolveNodeScriptTarget(body: unknown): string | undefined {
  if (typeof body !== 'string') {
    return undefined
  }
  const parts = body.trim().split(/\s+/)
  return parts.length === 2 && parts[0] === 'node' ? parts[1] : undefined
}

/**
 * The `node <path>` target of the named script in the package.json at `cwd`,
 * or undefined when the manifest is absent, unreadable, or the body is not the
 * plain form. Every failure resolves to undefined — the caller falls back to
 * the pnpm wrapper, which is correct for any body this cannot reproduce.
 */
export function readPackageScriptTarget(
  scriptName: string,
): string | undefined {
  let scripts: unknown
  try {
    scripts = (
      JSON.parse(readFileSync('package.json', 'utf8')) as {
        scripts?: Record<string, unknown> | undefined
      }
    ).scripts
  } catch {
    return undefined
  }
  if (!scripts || typeof scripts !== 'object') {
    return undefined
  }
  return resolveNodeScriptTarget(
    (scripts as Record<string, unknown>)[scriptName],
  )
}

export function main(): void {
  const scriptName = process.argv[2]
  if (!scriptName) {
    return
  }
  const target = readPackageScriptTarget(scriptName)
  if (target) {
    process.stdout.write(target)
  }
}

// Entry guard, spelled inline: this file sits in `.git-hooks/`, which cannot
// import the `scripts/fleet/_shared/is-main-module.mts` helper.
const entry = process.argv[1]
if (entry && path.resolve(entry) === fileURLToPath(import.meta.url)) {
  main()
}
