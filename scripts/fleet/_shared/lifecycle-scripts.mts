/**
 * @file Lifecycle-script hygiene shared by the publish pack surface and the
 *   pack-contents gate. npm/pnpm run a manifest's lifecycle scripts on the
 *   CONSUMER's machine (preinstall/install/postinstall on install; prepare on
 *   git deps; prepack when the consumer re-packs), so a lifecycle command
 *   whose `node <path>` target is a repo-only file breaks every install of
 *   the published tarball — the 4.0.3 sdk manifest shipped `preinstall` →
 *   `scripts/fleet/setup/bootstrap-zero-dep-packages.mjs` with no such file
 *   in the tarball. The pure core here answers one question both surfaces
 *   share: which declared lifecycle scripts reference local files the packed
 *   artifact will not carry.
 */

import { extractNodeScriptPath } from '../check/script-paths-resolve.mts'

/**
 * The lifecycle scripts a published manifest must be able to run from the
 * tarball alone: preinstall/install/postinstall fire on every consumer
 * install, prepare on git-dep consumers, prepack when a consumer re-packs.
 * Repo-side publish hooks (prepublishOnly, postpack, …) never execute on a
 * consumer machine, so they are deliberately not listed.
 */
export const LIFECYCLE_SCRIPT_NAMES = [
  'install',
  'postinstall',
  'prepack',
  'preinstall',
  'prepare',
] as const

/**
 * Every local `node <path>` target a script command references, across
 * compound `&&` / `||` / `;` chains. Non-`node <local-script>` segments (bin
 * tools, `node -e`, globs, doc placeholders) contribute nothing — same
 * tolerance as the script-paths-resolve check this reuses. Pure.
 */
export function extractLocalScriptTargets(command: string): string[] {
  const targets: string[] = []
  const segments = command.split(/&&|\|\||;/)
  for (let i = 0, { length } = segments; i < length; i += 1) {
    const target = extractNodeScriptPath(segments[i]!)
    if (target) {
      targets.push(target)
    }
  }
  return targets
}

export interface DanglingLifecycleScript {
  /**
   * The full script command as declared.
   */
  readonly command: string
  /**
   * The local targets the packed artifact will not carry.
   */
  readonly missing: string[]
  /**
   * The lifecycle script name (preinstall, install, …).
   */
  readonly name: string
}

/**
 * The declared lifecycle scripts whose `node <path>` targets are not all in
 * the pack file set (`hasFile` answers membership — tarball entry list on the
 * gate side, files-field coverage + on-disk existence on the pack side).
 * Lifecycle commands with no local script targets (bin tools, inline `node
 * -e`) resolve trivially and are never flagged. Pure given a pure `hasFile`.
 */
export function findDanglingLifecycleScripts(
  scripts: Readonly<Record<string, unknown>> | undefined,
  hasFile: (relPath: string) => boolean,
): DanglingLifecycleScript[] {
  if (!scripts) {
    return []
  }
  const dangling: DanglingLifecycleScript[] = []
  for (const name of LIFECYCLE_SCRIPT_NAMES) {
    const command = scripts[name]
    if (typeof command !== 'string') {
      continue
    }
    const missing = extractLocalScriptTargets(command).filter(t => !hasFile(t))
    if (missing.length) {
      dangling.push({ command, missing, name })
    }
  }
  return dangling
}
