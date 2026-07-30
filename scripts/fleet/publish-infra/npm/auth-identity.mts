/**
 * @file Npm auth IDENTITY for publish flows. login.mts repairs a logged-OUT
 *   npm; this module owns the orthogonal failure: logged in as the WRONG
 *   user. Staged entries are visible only to the subject package's
 *   maintainers, so a non-maintainer login makes `pnpm stage list` read as
 *   EMPTY and every verify/approve silently no-ops — the operator debugs
 *   "0 staged entries" instead of "wrong account". ensureNpmIdentity reads
 *   who is needed, the packument's maintainers, who is logged in
 *   (`npm whoami`), and on mismatch prompts for the logout/login rotation on
 *   a TTY or fails LOUD with the exact commands otherwise. The maintainer
 *   read is a three-way discriminant — known / unpublished / unreachable —
 *   because only a 404, first publish, may pass silently: a transient
 *   registry failure on a KNOWN-published package would otherwise fail open
 *   and re-open the exact wrong-account trap this gate closes. npm commands
 *   run from npmScratchCwd() — see its doc for why the temp dir is the only
 *   cwd that dodges both the repo's devEngines veto and lib spawn's
 *   untrusted-root PATH sanitization. Also a CLI:
 *   `node scripts/fleet/publish-infra/npm/auth-identity.mts <package>`.
 */

import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import {
  httpJson,
  HttpResponseError,
} from '@socketsecurity/lib-stable/http-request'
import { confirm } from '@socketsecurity/lib-stable/stdio/prompts'

import { NPM_REGISTRY_URL } from '../../constants/npm-registry.mts'
import { ensureNpmLogin } from './login.mts'
import { npmScratchCwd } from './shared.mts'
import { logger, runCapture, runInherit } from '../shared.mts'

/**
 * The npm username the local machine is logged in as, or undefined when
 * logged out, or npm is unusable. Runs from npmScratchCwd() — the repo's
 * devEngines veto in-repo `npm`, and a home-dir cwd makes lib spawn drop
 * every home-rooted PATH entry.
 */
export async function npmWhoami(): Promise<string | undefined> {
  const { code, stdout } = await runCapture('npm', ['whoami'], npmScratchCwd())
  const name = stdout.trim()
  return code === 0 && name ? name : undefined
}

/**
 * The maintainer read's three honest outcomes. `unpublished` (a 404) is the
 * only silent pass — a first publish has no maintainers to match.
 * `unreachable` (timeout / 5xx / proxy) must fail CLOSED: the package may be
 * published with a maintainer set this login is not in, and passing here
 * would re-open the empty-stage-list trap. `known` gates on membership —
 * including an empty set, which can never match.
 */
export type MaintainerRead =
  | { kind: 'known'; names: string[] }
  | { kind: 'unpublished' }
  | { detail: string; kind: 'unreachable' }

/**
 * Read the subject package's npm maintainers from the packument.
 */
export async function readPackageMaintainers(
  name: string,
): Promise<MaintainerRead> {
  const url = `${NPM_REGISTRY_URL}/${encodeURIComponent(name).replace('%40', '@')}`
  try {
    const json = await httpJson<{
      maintainers?: Array<{ name?: string | undefined }> | undefined
    }>(url, {
      headers: { accept: 'application/json' },
      timeout: 15_000,
    })
    const names = (json.maintainers ?? [])
      .map(m => m.name)
      .filter((n): n is string => typeof n === 'string' && n.length > 0)
    return { kind: 'known', names }
  } catch (e) {
    if (e instanceof HttpResponseError && e.response.status === 404) {
      return { kind: 'unpublished' }
    }
    return {
      detail: errorMessage(e),
      kind: 'unreachable',
    }
  }
}

export interface NpmIdentityReport {
  /**
   * True when the flow may proceed: the login matches a maintainer, or the
   * package has never been published, nothing to match on a first publish.
   */
  ok: boolean
  currentUser: string | undefined
  read: MaintainerRead
}

/**
 * Diagnosis lines for the identity state, in the four-ingredient shape —
 * used by verify/approve failure paths so an empty stage list names WHO was
 * looking, not just "0 entries".
 */
export function describeNpmIdentity(report: NpmIdentityReport, pkg: string) {
  const { currentUser, read } = report
  const maintainerText =
    read.kind === 'known'
      ? read.names.join(', ') || '<none>'
      : read.kind === 'unpublished'
        ? '<unpublished — first publish, nothing to match>'
        : `<unreachable: ${read.detail}>`
  const lines = [
    `npm identity: ${currentUser ?? '<logged out>'}; ${pkg} maintainers: ${maintainerText}.`,
  ]
  if (!report.ok && read.kind === 'unreachable') {
    lines.push(
      `The maintainer read failed, so this identity CANNOT be verified — ` +
        `refusing rather than risking the wrong-account empty-stage-list trap.`,
      `Fix: retry when the registry is reachable, or verify by hand ` +
        `(\`npm view ${pkg} maintainers\`).`,
    )
  } else if (!report.ok) {
    lines.push(
      `Staged entries are visible only to maintainers, so this login reads ` +
        `an EMPTY stage list for ${pkg}.`,
      `Fix: rotate the login — \`npm logout\` then ` +
        `\`npm login --auth-type=web\` as a maintainer (run both from your ` +
        `home dir or /tmp; the repo's devEngines veto in-repo npm).`,
    )
  }
  return lines
}

/**
 * Compute the identity report for a publish subject: logged-in user vs the
 * packument's maintainers. Unpublished passes, first publish; unreachable
 * and non-membership, including an empty maintainer set, do not.
 */
export async function npmIdentityFor(pkg: string): Promise<NpmIdentityReport> {
  const [currentUser, read] = await Promise.all([
    npmWhoami(),
    readPackageMaintainers(pkg),
  ])
  const ok =
    read.kind === 'unpublished' ||
    (read.kind === 'known' &&
      currentUser !== undefined &&
      read.names.includes(currentUser))
  return { currentUser, ok, read }
}

/**
 * Ensure the local npm identity can operate on `pkg`'s staged entries:
 * logged out → run the login flow (login.mts); logged in as a non-maintainer
 * → on a TTY, offer the logout/login rotation and run it on consent;
 * otherwise fail LOUD with the exact repair commands. Returns true when the
 * flow may proceed. Rotation is NEVER automatic without consent: `npm
 * logout` revokes the current token, which a parallel publish flow (a bot
 * account, another repo's staging) may still depend on.
 */
export async function ensureNpmIdentity(pkg: string): Promise<boolean> {
  let report = await npmIdentityFor(pkg)
  if (report.currentUser === undefined) {
    if (!(await ensureNpmLogin())) {
      return false
    }
    report = await npmIdentityFor(pkg)
  }
  if (report.ok) {
    logger.log(describeNpmIdentity(report, pkg)[0]!)
    return true
  }
  for (const line of describeNpmIdentity(report, pkg)) {
    logger.fail(line)
  }
  if (report.read.kind === 'unreachable' || !process.stdin.isTTY) {
    return false
  }
  const rotate = await confirm({
    default: false,
    message: `Log out ${report.currentUser} and log in as a maintainer of ${pkg} now?`,
  })
  if (!rotate) {
    return false
  }
  const previousUser = report.currentUser
  const logout = await runInherit('npm', ['logout'], npmScratchCwd())
  if (logout !== 0) {
    logger.fail(`npm logout exited ${logout}.`)
    return false
  }
  if (!(await ensureNpmLogin())) {
    return false
  }
  report = await npmIdentityFor(pkg)
  if (!report.ok) {
    for (const line of describeNpmIdentity(report, pkg)) {
      logger.fail(line)
    }
    if (report.currentUser === previousUser) {
      logger.fail(
        `The identity did not rotate: npm logout only clears the user-npmrc ` +
          `token, so an env token (npm_config__authToken / NPM_TOKEN) or a ` +
          `global npmrc may be pinning ${previousUser ?? 'this login'}. ` +
          `Clear those, then retry.`,
      )
    }
    return false
  }
  logger.success(`npm identity ok: ${report.currentUser} maintains ${pkg}.`)
  return true
}

async function runCli(): Promise<void> {
  const pkg = process.argv[2]
  if (!pkg) {
    logger.fail(
      'Usage: node scripts/fleet/publish-infra/npm/auth-identity.mts <package>',
    )
    process.exitCode = 1
    return
  }
  if (!(await ensureNpmIdentity(pkg))) {
    process.exitCode = 1
  }
}

if (import.meta.main) {
  void runCli().catch((error: unknown) => {
    logger.error(error)
    process.exitCode = 1
  })
}
