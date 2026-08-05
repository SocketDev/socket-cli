/**
 * @file Resolve the npm that ships with the repo's PINNED Node, rather than
 *   whichever npm sits on PATH.
 *   WHY THIS EXISTS. The two disagree, and the gap is not cosmetic. A promote
 *   run against a Homebrew npm 11.17.0 while `.node-version` pinned Node 26.5.0
 *   used a binary BELOW the repo's own `engines.npm` floor of >=12.0.2 — the
 *   staging API surface (`npm stage approve|reject`) is exactly where that
 *   matters, because it is 2FA-gated and irreversible. The pinned Node bundles
 *   npm 12.0.1; PATH offered 11.17.0.
 *   Also WHY NPM AT ALL for staging: pnpm's `stage` commands print the web-auth
 *   URL and then block on an interactive ENTER before opening the browser, so
 *   they cannot complete from an agent channel — they sit until
 *   ERR_PNPM_WEBAUTH_TIMEOUT. npm's flow opens the browser and polls, which the
 *   `npm-web-auth.mts` PTY wrapper already services. npm is the runner for
 *   stage operations; pnpm remains the package manager everywhere else.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

/**
 * The trimmed `.node-version` pin at `repoRoot`, or undefined when absent or
 * unreadable.
 */
export function readNodePin(repoRoot: string): string | undefined {
  try {
    return (
      readFileSync(path.join(repoRoot, '.node-version'), 'utf8').trim() ||
      undefined
    )
  } catch {
    return undefined
  }
}

/**
 * Candidate npm paths for `version`, in the order a resolver should try them.
 * Covers the version managers the fleet runs on: fnm, nvm, and asdf. Pure so
 * the layout knowledge is testable without those managers installed.
 */
export function pinnedNpmCandidates(
  version: string,
  home: string,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const bin = platform === 'win32' ? 'npm.cmd' : 'npm'
  const v = version.startsWith('v') ? version : `v${version}`
  const bare = v.slice(1)
  return [
    path.join(
      home,
      '.local/share/fnm/node-versions',
      v,
      'installation/bin',
      bin,
    ),
    path.join(home, '.fnm/node-versions', v, 'installation/bin', bin),
    path.join(home, '.nvm/versions/node', v, 'bin', bin),
    path.join(home, '.asdf/installs/nodejs', bare, 'bin', bin),
  ]
}

export interface PinnedNpmResolution {
  // Absolute path to the resolved npm, or undefined when none was found.
  readonly npmPath: string | undefined
  // The `.node-version` pin the lookup used, when the repo declares one.
  readonly pin: string | undefined
  // Why a caller should refuse, or undefined when the resolution is usable.
  readonly refusal: string | undefined
}

/**
 * Locate the npm bundled with the pinned Node.
 *
 * Returns a refusal rather than throwing: a caller mid-release wants to report
 * What / Where / Saw / Fix and stop, not unwind a stack. `exists` is injected
 * so the lookup is testable without a version manager on the box.
 */
export function resolvePinnedNpm(config: {
  exists?: ((p: string) => boolean) | undefined
  home: string
  platform?: NodeJS.Platform | undefined
  repoRoot: string
}): PinnedNpmResolution {
  const cfg = { __proto__: null, ...config } as typeof config
  const fileExists = cfg.exists ?? existsSync
  const pin = readNodePin(cfg.repoRoot)
  if (!pin) {
    return {
      npmPath: undefined,
      pin: undefined,
      refusal:
        'no .node-version pin.\n' +
        `  What:  staging runs npm, and the npm to run is the one bundled with the pinned Node.\n` +
        `  Where: ${cfg.repoRoot}/.node-version\n` +
        `  Saw:   the file is absent or empty; wanted a version such as 26.5.0.\n` +
        `  Fix:   add the pin, or pass an explicit npm path.`,
    }
  }
  const candidates = pinnedNpmCandidates(pin, cfg.home, cfg.platform)
  for (let i = 0, { length } = candidates; i < length; i += 1) {
    // oxlint-disable-next-line socket/prefer-exists-sync -- injected seam, not a wrapper: the fnm/nvm/asdf layouts must be probed in tests on a box where none of those managers are installed.
    if (fileExists(candidates[i]!)) {
      return { npmPath: candidates[i]!, pin, refusal: undefined }
    }
  }
  return {
    npmPath: undefined,
    pin,
    refusal:
      `no npm found for the pinned Node ${pin}.\n` +
      `  What:  a stage operation is 2FA-gated and irreversible, so it runs the\n` +
      `         PINNED npm rather than whatever PATH offers — those disagreed by a\n` +
      `         major once, below the repo's own engines.npm floor.\n` +
      `  Where: looked under fnm, nvm, and asdf layouts for ${pin}.\n` +
      `  Saw:   none of ${candidates.length} candidate paths exist.\n` +
      `  Fix:   install Node ${pin} with your version manager, then re-run.`,
  }
}

// The npm stage subcommands. `publish` is deliberately ABSENT: staging an
// upload is CI's job through npm-publish.yml, never a local run.
export const NPM_STAGE_SUBCOMMANDS: readonly string[] = [
  'approve',
  'download',
  'list',
  'reject',
  'view',
]

/**
 * True when `subcommand` is a stage operation this layer will run.
 */
export function isNpmStageSubcommand(subcommand: string): boolean {
  return NPM_STAGE_SUBCOMMANDS.includes(subcommand)
}
