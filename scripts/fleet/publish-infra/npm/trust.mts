#!/usr/bin/env node
/*
 * @file Configure npm Trusted Publishers through `npm trust` — the registry
 *   API, not the website. The web UI sits behind bot management that
 *   challenges an automated session per page (see
 *   docs/agents.md/fleet/npm-anti-bot-rhythm.md); the registry endpoint
 *   `POST /-/package/<pkg>/trust` that `npm trust` drives has no such
 *   challenge, so a whole workspace configures in one pass.
 *   Three details this wrapper exists to own, so no operator hand-runs npm:
 *
 *   1. The npm that runs is the one bundled with the repo's PINNED Node
 *      (pinned-npm.mts), never a stray Homebrew npm — these writes are
 *      2FA-gated and irreversible.
 *   2. Every npm spawn runs from a NEUTRAL cwd. A fleet repo's package.json
 *      declares `devEngines.packageManager: pnpm`, which makes npm refuse to
 *      run at all (EBADDEVENGINES), so the package name travels as an argument
 *      instead of the cwd.
 *   3. The first write prompts for 2FA web-auth, which needs a TTY. The spawn goes
 *      through the fleet PTY seam (shared.mts) so the prompt works from a
 *      non-TTY session. npm then grants a ~5-minute skip-2FA window, so
 *      packages are written SEQUENTIALLY with a short sleep — npm's own
 *      rate-limit guidance. The desired shape per package comes from
 *      trusted-publisher-plan.mts, so the two-workflow rule holds here exactly
 *      as it does in the browser driver: a plain package publishes from
 *      `npm-publish.yml`, a napi `<base>-<platform>` package from
 *      `npm-publish-napi.yml`. Dry-run is the default: it prints the plan and
 *      writes nothing. `--apply` performs the writes, verifies each by
 *      re-reading, and reports a summary. A package whose re-read does not
 *      match never aborts the rest. Usage: node
 *      scripts/fleet/publish-infra/npm/trust.mts [<pkg>…] [--repo <owner/name>]
 *      [--apply]
 */

import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { WIN32 } from '@socketsecurity/lib-stable/constants/platform'
import { httpRequest } from '@socketsecurity/lib-stable/http-request'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { isMainModule } from '../../_shared/is-main-module.mts'
import { runMain } from '../../_shared/run-main.mts'
import { REPO_ROOT } from '../../paths.mts'
import { buildPtyInvocation, runCapture } from '../shared.mts'
import { resolvePinnedNpm } from './pinned-npm.mts'
import { desiredTrustedPublisher } from './trusted-publisher-plan.mts'
import type { TrustedPublisherDesired } from './trusted-publisher-plan.mts'
import { resolveNpmWorkspaceLayout } from './workspace.mts'

import type { ScriptMeta } from '../../_shared/run-main.mts'

const logger = getDefaultLogger()

/**
 * `npm trust` landed in npm 11.10.0. An older npm has no subcommand to call,
 * so the run stops with the pinned-Node fix rather than a cryptic usage error.
 */
export const MIN_NPM_VERSION = '11.10.0'

/**
 * Pause between sequential writes. npm's trusted-publishing guidance pairs the
 * skip-2FA window with a short sleep so a batch does not trip rate limiting.
 */
export const WRITE_SPACING_MS = 2000

/**
 * A package's planned configuration, and whether the registry already carries
 * it. `matches` short-circuits the write: this flow is a reconciler, so an
 * already-correct row is a skip, not a rewrite.
 */
export interface TrustPlan {
  readonly desired: TrustedPublisherDesired
  readonly matches: boolean
  readonly pkg: string
}

export interface TrustFlags {
  readonly apply: boolean
  readonly packages: readonly string[]
  readonly repo: string | undefined
}

export function parseTrustArgs(argv: readonly string[]): TrustFlags {
  const packages: string[] = []
  let apply = false
  let repo: string | undefined
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const arg = argv[i]!
    if (arg === '--apply') {
      apply = true
    } else if (arg === '--repo') {
      repo = argv[i + 1]
      i += 1
    } else if (arg.startsWith('--repo=')) {
      repo = arg.slice('--repo='.length)
    } else if (!arg.startsWith('-')) {
      packages.push(arg)
    }
  }
  return { apply, packages, repo }
}

/**
 * Semver-ish "is `version` at least `minimum`" over the numeric prefix of each
 * part, which is all a floor check needs. Pure so the guard is unit-testable.
 */
export function meetsMinimumVersion(version: string, minimum: string): boolean {
  const parse = (v: string): number[] =>
    v
      .replace(/^v/, '')
      .split('.')
      .map(part => Number.parseInt(part, 10) || 0)
  const have = parse(version)
  const want = parse(minimum)
  for (let i = 0; i < 3; i += 1) {
    const a = have[i] ?? 0
    const b = want[i] ?? 0
    if (a !== b) {
      return a > b
    }
  }
  return true
}

/**
 * The napi platform tokens declared by the repo at `repoRoot`, or an empty
 * list. Drives the two-workflow rule: a package named `<base>-<platform>` for
 * one of these publishes from the napi workflow.
 *
 * The platforms belong to the repo the packages BELONG to, which is not always
 * the cwd — `--repo owner/name` configures another member's packages, and
 * reading the cwd's config there would plan every platform package onto the
 * plain workflow.
 */
export function readNapiPlatforms(repoRoot: string): string[] {
  const file = path.join(repoRoot, '.config', 'repo', 'socket-wheelhouse.json')
  if (!existsSync(file)) {
    return []
  }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
      napi?: { platforms?: unknown | undefined } | undefined
    }
    const platforms = parsed?.napi?.platforms
    return Array.isArray(platforms)
      ? platforms.filter((p): p is string => typeof p === 'string')
      : []
  } catch {
    return []
  }
}

/**
 * The checkout whose config declares the target packages' platforms. Without
 * `--repo` that is this repo; with it, the sibling checkout beside this one,
 * matching the layout every fleet member shares (`~/projects/<name>`). Falls
 * back to this repo when the sibling is not checked out, which yields the
 * plain workflow for every package — correct for a repo with no napi packages,
 * and visible in the printed plan when it is not.
 */
export function resolveTargetRepoRoot(repo: string | undefined): string {
  if (!repo) {
    return REPO_ROOT
  }
  const slash = repo.indexOf('/')
  const name = slash >= 0 ? repo.slice(slash + 1) : repo
  if (!name || name === path.basename(REPO_ROOT)) {
    return REPO_ROOT
  }
  const sibling = path.join(path.dirname(REPO_ROOT), name)
  return existsSync(sibling) ? sibling : REPO_ROOT
}

/**
 * Every package name a repo publishes: its workspace packages, including the
 * generated napi platform packages, or the single package a non-workspace repo
 * ships. This is what makes the bare `pnpm run trust --apply` complete — an
 * operator naming nine packages by hand is nine chances to miss one, and a
 * missed platform package fails its publish at release time, not here.
 */
export function enumerateRepoPackages(repoRoot: string): string[] {
  const layout = resolveNpmWorkspaceLayout(repoRoot)
  const names = new Set<string>()
  if (layout.subject?.name) {
    names.add(layout.subject.name)
  }
  const { packages } = layout
  for (let i = 0, { length } = packages; i < length; i += 1) {
    const pkg = packages[i]!
    if (pkg.name) {
      names.add(pkg.name)
    }
  }
  return [...names].toSorted()
}

/**
 * The `npm trust github` argv for one package. The package name is an
 * ARGUMENT, never the cwd, because npm refuses to run inside a repo whose
 * devEngines names pnpm.
 */
export function buildTrustWriteArgs(
  pkg: string,
  desired: TrustedPublisherDesired,
): string[] {
  return [
    'trust',
    'github',
    pkg,
    '--file',
    desired.workflowFilename,
    '--repository',
    `${desired.repositoryOwner}/${desired.repositoryName}`,
    '--environment',
    desired.environmentName,
    '--allow-publish',
    '--allow-stage-publish',
    '--yes',
  ]
}

/**
 * Whether `listOutput` from `npm trust list <pkg>` already describes
 * `desired`. The output is human-formatted, so this looks for each field's
 * value rather than parsing a shape npm may restyle: a row that names the
 * right repo, workflow, and environment is the row we would write.
 */
export function listOutputMatches(
  listOutput: string,
  desired: TrustedPublisherDesired,
): boolean {
  const haystack = listOutput.toLowerCase()
  const slug =
    `${desired.repositoryOwner}/${desired.repositoryName}`.toLowerCase()
  return (
    haystack.includes(slug) &&
    haystack.includes(desired.workflowFilename.toLowerCase()) &&
    haystack.includes(desired.environmentName.toLowerCase())
  )
}

/**
 * The four-ingredient block for a write whose re-read did not come back as
 * planned. Named per field so the operator can finish the row by hand if npm
 * partially accepted it.
 */
export function formatVerifyFailure(
  pkg: string,
  desired: TrustedPublisherDesired,
  listOutput: string,
): string {
  return [
    `the trusted publisher for ${pkg} did not verify after the write.`,
    `  Where: https://www.npmjs.com/package/${pkg}/access`,
    `  Saw:   ${listOutput.trim() || '(no configuration)'}`,
    `  Wanted: repo ${desired.repositoryOwner}/${desired.repositoryName}, ` +
      `workflow ${desired.workflowFilename}, environment ${desired.environmentName}.`,
    `  Fix:   re-run this command for ${pkg} alone; if it fails again, the ` +
      'registry rejected the claim — check the workflow filename exists on the default branch.',
  ].join('\n')
}

/**
 * The report for a package whose verify read was REFUSED rather than answered.
 * `writeExitCode` is the only evidence about the write itself, and it is stated
 * as evidence rather than a verdict: the row may be set, and the next run's
 * read — once a session can read — settles it either way.
 */
export function formatUnverifiable(
  pkg: string,
  desired: TrustedPublisherDesired,
  writeExitCode: number,
): string {
  return [
    `${pkg}: the write ${writeExitCode === 0 ? 'reported success' : `exited ${writeExitCode}`}, ` +
      'but the verify read was refused for a one-time password, so this run ' +
      'cannot say whether the row is set.',
    `  Wanted: repo ${desired.repositoryOwner}/${desired.repositoryName}, ` +
      `workflow ${desired.workflowFilename}, environment ${desired.environmentName}.`,
    `  Check:  https://www.npmjs.com/package/${pkg}/access`,
    '  Next:   re-run once a session can read; an already-correct row reports ' +
      'as conforming and is never rewritten.',
  ].join('\n')
}

/**
 * The human gate for the first write. npm challenges the first
 * account-changing call with 2FA web-auth and then grants a short window, so
 * one approval covers the batch.
 */
export function formatAuthGate(count: number): string {
  return [
    '🖐  HUMAN GATE — npm 2FA for the trusted-publisher batch [1/1]',
    `  Need: npm gates account changes behind 2FA, so the first of ${count} ` +
      'write(s) prompts for browser approval.',
    '  Mind: this is the registry API, not the website — no bot-management ' +
      'challenge; 2FA-bypass tokens are refused here by design.',
    '  A) You: approve the npmjs.com URL npm prints below in your browser.',
    '  B) Me: I drive every write once approval lands — npm grants a ' +
      '~5-minute window, so one approval covers the whole batch.',
    '  Then: each package is written, re-read, and reported in the summary.',
  ].join('\n')
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Whether `output` is npm refusing an account operation for want of a
 * one-time password. Every `npm trust` call — the reads included — is an
 * account operation, so a session that has not authenticated sees this on the
 * FIRST read rather than at the first write.
 */
export function isOtpRequired(output: string): boolean {
  return /\bEOTP\b|requires a one-time password/i.test(output)
}

/**
 * Run npm and collect BOTH streams. npm reports an EOTP refusal — and the
 * approval URLs with it — on stderr, so a stdout-only capture reads as silence
 * and the caller concludes the session is authenticated when it is not.
 */
export async function runCaptureBoth(
  cmd: string,
  args: readonly string[],
  cwd: string,
): Promise<{ code: number; output: string }> {
  const child = spawn(cmd, [...args], {
    cwd,
    shell: WIN32,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.process.stdout?.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8')
  })
  child.process.stderr?.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8')
  })
  const code = await new Promise<number>(resolve => {
    child.process.on('close', (exitCode: number | null) => {
      resolve(exitCode ?? 1)
    })
  })
  void child.catch(() => undefined)
  return { code, output }
}

/**
 * Npm's browser-approval URL and the endpoint that reports the approval, as
 * printed in an EOTP refusal. `npm trust` does NOT poll for the approval the
 * way `npm login` does — it refuses, names both URLs, and expects the next
 * call to find an elevated session. This flow closes that loop itself.
 */
/**
 * Run a `npm trust` write through a PTY and answer its prompts.
 *
 * With a TTY npm takes its INTERACTIVE OTP path instead of refusing: it prints
 * an approval URL, waits at `Press ENTER to open in the browser...`, then polls
 * for the approval itself. The fleet's PTY helper inherits stdin, which is
 * empty in a non-interactive session, so that wait never ends. This answers the
 * prompt and opens the URL directly — the difference between a hang and a
 * completed write.
 */
export async function runTrustWriteInteractive(
  npmPath: string,
  args: readonly string[],
  neutralCwd: string,
): Promise<number> {
  const pty = buildPtyInvocation(process.platform, npmPath, [...args])
  const command = pty?.command ?? npmPath
  const commandArgs = pty ? [...pty.args] : [...args]
  const child = spawn(command, commandArgs, {
    cwd: neutralCwd,
    shell: WIN32,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let seen = ''
  let answered = false
  let opened = false
  const onChunk = (chunk: Buffer): void => {
    seen += chunk.toString('utf8')
    process.stdout.write(chunk)
    if (!answered && /press enter/i.test(seen)) {
      answered = true
      child.process.stdin?.write('\n')
    }
    if (!opened) {
      const url = urlAfterMarker(seen, 'auth/cli/')
      if (url) {
        opened = true
        void runCaptureBoth('open', [url], neutralCwd).catch(() => undefined)
      }
    }
  }
  child.process.stdout?.on('data', onChunk)
  child.process.stderr?.on('data', onChunk)
  const code = await new Promise<number>(resolve => {
    child.process.on('close', (exitCode: number | null) => {
      resolve(exitCode ?? 1)
    })
  })
  void child.catch(() => undefined)
  return code
}

export interface OtpChallenge {
  readonly authUrl: string
  readonly doneUrl: string
}

/**
 * The last whitespace-delimited token on the first line containing `marker`.
 * npm prints each URL alone at the end of its line, so the token IS the URL.
 *
 * Token scanning rather than a URL regex on purpose: these are URLs, not
 * filesystem paths, and normalizing them for a separator-regex match collapses
 * `https://` to `https:/` — which silently defeated the parse.
 */
export function urlAfterMarker(
  output: string,
  marker: string,
): string | undefined {
  const lines = output.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (!line.includes(marker)) {
      continue
    }
    const token = line.trim().split(/\s+/).pop()
    if (token?.startsWith('https:')) {
      return token
    }
  }
  return undefined
}

export function parseOtpChallenge(output: string): OtpChallenge | undefined {
  const authUrl = urlAfterMarker(output, 'auth/cli/')
  const doneUrl = urlAfterMarker(output, 'v1/done?authId=')
  return authUrl && doneUrl ? { authUrl, doneUrl } : undefined
}

/**
 * Whether `url` resolves to something a person can approve. npm's CLI has
 * printed EOTP approval URLs for routes the website no longer serves — both the
 * `auth/cli` page and its paired done endpoint answered 404 on 2026-08-04 —
 * and opening a 404 tells the operator nothing. Checking first is what lets
 * this flow fall through to the login protocol that does work.
 */
export async function isUrlReachable(url: string): Promise<boolean> {
  try {
    const response = await httpRequest(url)
    return response.status < 400
  } catch {
    return false
  }
}

/**
 * A fresh approval flow from the registry's web-login protocol — the same
 * `/-/v1/login` call `login.mts` makes, whose URLs the website does serve.
 * `npm-auth-type: web` is load-bearing: the endpoint 401s a client that does
 * not declare web auth.
 */
export async function createLoginChallenge(): Promise<
  OtpChallenge | undefined
> {
  try {
    const created = await httpRequest('https://registry.npmjs.org/-/v1/login', {
      body: '{}',
      headers: {
        'content-type': 'application/json',
        'npm-auth-type': 'web',
        'npm-command': 'login',
      },
      method: 'POST',
    })
    if (!created.ok) {
      return undefined
    }
    const session = created.json<{
      doneUrl?: string | undefined
      loginUrl?: string | undefined
    }>()
    return session.loginUrl && session.doneUrl
      ? { authUrl: session.loginUrl, doneUrl: session.doneUrl }
      : undefined
  } catch {
    return undefined
  }
}

/**
 * A challenge whose URLs actually resolve. npm's own EOTP pair is preferred
 * when it works; when it 404s, the registry's web-login protocol
 * (`login.mts`, which posts `/-/v1/login` with `npm-auth-type: web`) issues a
 * session that does — and a completed web login elevates the account for the
 * same ~5-minute window an OTP would, which is all these writes need.
 */
export async function resolveUsableChallenge(
  probeOutput: string,
): Promise<OtpChallenge | undefined> {
  const printed = parseOtpChallenge(probeOutput)
  if (printed && (await isUrlReachable(printed.authUrl))) {
    return printed
  }
  if (printed) {
    logger.log(
      "npm's own approval URL is not reachable, so this run falls back to the " +
        'registry login protocol.',
    )
  }
  return await createLoginChallenge()
}

/**
 * How long to wait for the operator's browser approval, and how often to ask
 * the done endpoint. A person is opening a page and clicking, so the budget is
 * generous and the poll is slow.
 */
export const OTP_APPROVAL_BUDGET_MS = 5 * 60_000
export const OTP_POLL_MS = 3000

/**
 * Whether npm's done endpoint reports the approval as complete. It answers 202
 * while the operator has not finished and 200 with the token once they have.
 */
export async function isApprovalComplete(
  doneUrl: string,
  npmPath?: string | undefined,
  neutralCwd?: string | undefined,
): Promise<boolean> {
  try {
    const response = await httpRequest(doneUrl, {
      headers: { 'npm-auth-type': 'web', 'npm-command': 'login' },
    })
    if (response.status !== 200) {
      return false
    }
    // The login protocol answers 200 with the session's token. Persisting it is
    // what makes the CLI use the newly elevated session; npm's own EOTP flow
    // returns no token and needs nothing saved.
    const { token } = response.json<{ token?: string | undefined }>()
    if (neutralCwd && npmPath && token) {
      await runCaptureBoth(
        npmPath,
        ['config', 'set', `//registry.npmjs.org/:_authToken=${token}`],
        neutralCwd,
      )
    }
    return true
  } catch {
    return false
  }
}

/**
 * Authenticate once before any read or write, so nine account operations cost
 * one approval — npm elevates the session for about five minutes.
 *
 * The probe is a read (`npm trust list`) because a read is idempotent: the
 * priming step must never be the thing that writes a row. On refusal this
 * OPENS the approval page in the operator's browser and polls npm's own done
 * endpoint until it reports success, so the URL never has to be copied out of
 * a log — which is what makes the flow work from a non-interactive session.
 */
export async function primeOtpSession(
  npmPath: string,
  probePkg: string,
  neutralCwd: string,
): Promise<boolean> {
  // Both streams: npm puts the refusal AND the approval URLs on stderr.
  const probe = await runCaptureBoth(
    npmPath,
    ['trust', 'list', probePkg],
    neutralCwd,
  )
  if (!isOtpRequired(probe.output)) {
    return true
  }
  const challenge = await resolveUsableChallenge(probe.output)
  if (!challenge) {
    logger.fail(
      'npm would not open an authentication flow this session.\n' +
        `  Where: ${npmPath} trust list ${probePkg}\n` +
        `  Saw:   ${probe.output.trim().slice(0, 200) || '(no output)'}\n` +
        "  Wanted: a reachable approval URL, from npm's EOTP message or the " +
        'registry login protocol.\n' +
        '  Fix:   configure the trusted publishers through the npmjs.com web UI ' +
        '(scripts/fleet/publish-infra/npm/trusted-publisher-browser.mts).',
    )
    return false
  }
  logger.log(
    'npm requires one browser approval before it will change trusted ' +
      'publishers. Opening the approval page now — approve it and this run ' +
      'continues on its own.',
  )
  // Open the page for the operator rather than printing a URL they would have
  // to copy: a redirected or piped run makes a printed URL unreachable.
  await runCapture('open', [challenge.authUrl], neutralCwd).catch(
    () => undefined,
  )
  const deadline = Date.now() + OTP_APPROVAL_BUDGET_MS
  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop -- serial: one operator, one approval.
    if (await isApprovalComplete(challenge.doneUrl, npmPath, neutralCwd)) {
      logger.success('approval received — continuing.')
      return true
    }
    // eslint-disable-next-line no-await-in-loop -- paced poll, not a retry ladder.
    await sleep(OTP_POLL_MS)
  }
  return false
}

export async function main(): Promise<void> {
  const flags = parseTrustArgs(process.argv.slice(2))
  // The target checkout owns both the package list and the platform tokens, so
  // it is resolved once and both reads follow it.
  const targetRepoRoot = resolveTargetRepoRoot(flags.repo)
  // No names given: configure everything the target repo publishes. Naming
  // packages stays supported for a one-off repair.
  const packages = flags.packages.length
    ? [...flags.packages]
    : enumerateRepoPackages(targetRepoRoot)
  if (!packages.length) {
    logger.fail(
      'no publishable packages found.\n' +
        '  What:  this flow configures a trusted publisher per published package.\n' +
        `  Where: ${targetRepoRoot}\n` +
        '  Saw:   no package arguments and no publishable manifest in the repo.\n' +
        '  Fix:   name the packages explicitly, or run from a repo that publishes — ' +
        'pnpm run trust [@scope/pkg…] [--repo owner/name] [--apply]',
    )
    process.exitCode = 1
    return
  }
  const resolution = resolvePinnedNpm({
    home: os.homedir(),
    repoRoot: REPO_ROOT,
  })
  if (!resolution.npmPath) {
    logger.fail(`cannot resolve the pinned npm: ${resolution.refusal ?? ''}`)
    process.exitCode = 1
    return
  }
  const npmPath = resolution.npmPath
  // Neutral cwd: npm refuses to run inside a repo whose devEngines names pnpm.
  const neutralCwd = os.tmpdir()
  const versionRun = await runCapture(npmPath, ['--version'], neutralCwd)
  const npmVersion = versionRun.stdout.trim()
  if (!meetsMinimumVersion(npmVersion, MIN_NPM_VERSION)) {
    logger.fail(
      `the pinned npm is too old for \`npm trust\`.\n` +
        `  What:  trusted-publisher configuration needs npm ${MIN_NPM_VERSION} or newer.\n` +
        `  Where: ${npmPath}\n` +
        `  Saw:   npm ${npmVersion || '(unknown)'}; wanted >= ${MIN_NPM_VERSION}.\n` +
        `  Fix:   raise the .node-version pin to a Node whose bundled npm is ${MIN_NPM_VERSION}+.`,
    )
    process.exitCode = 1
    return
  }
  // `--repo owner/name` targets a SIBLING member's packages, so its platform
  // tokens come from that checkout — the cwd's config describes a different
  // repo and would plan every platform package onto the plain workflow.
  // Authenticate before the first read. Skipped for a dry run, which only
  // needs the plan — a plan built from unreadable current state still prints
  // every package as "would configure", which is the safe direction.
  if (
    flags.apply &&
    !(await primeOtpSession(npmPath, packages[0]!, neutralCwd))
  ) {
    logger.fail(
      'npm did not accept a one-time password, so nothing was changed.\n' +
        '  What:  every `npm trust` call is an account operation and needs 2FA.\n' +
        `  Where: ${npmPath}\n` +
        '  Saw:   the authentication prompt did not complete.\n' +
        '  Fix:   run this command from an ATTACHED terminal — npm prints a URL ' +
        'and waits for the browser approval, which a detached/background run ' +
        'can never receive.',
    )
    process.exitCode = 1
    return
  }
  const napiPlatforms = readNapiPlatforms(targetRepoRoot)
  const plans: TrustPlan[] = []
  for (let p = 0, { length } = packages; p < length; p += 1) {
    const pkg = packages[p]!
    const desired = desiredTrustedPublisher({
      napiPlatforms,
      pkg,
      repoOverride: flags.repo,
    })
    if (!desired) {
      logger.fail(
        `cannot derive a repository for ${pkg}.\n` +
          '  What:  a trusted publisher names the GitHub repo that may publish.\n' +
          `  Where: ${pkg}\n` +
          '  Saw:   no --repo and no repo derivable from the package name.\n' +
          '  Fix:   pass --repo <owner/name>.',
      )
      process.exitCode = 1
      continue
    }
    // eslint-disable-next-line no-await-in-loop -- sequential by design: npm rate-limits account reads.
    const listRun = await runCaptureBoth(
      npmPath,
      ['trust', 'list', pkg],
      neutralCwd,
    )
    plans.push({
      desired,
      matches: listOutputMatches(listRun.output, desired),
      pkg,
    })
  }
  const pending = plans.filter(plan => !plan.matches)
  logger.log(
    `npm trusted publishers — ${plans.length} package(s), ` +
      `${pending.length} to configure${flags.apply ? '' : ' [dry-run]'}`,
  )
  for (let i = 0, { length } = plans; i < length; i += 1) {
    const plan = plans[i]!
    const label = plan.matches ? 'conforms' : 'would configure'
    logger.log(
      `  ${plan.pkg}: ${label} — ${plan.desired.repositoryOwner}/` +
        `${plan.desired.repositoryName} ${plan.desired.workflowFilename} ` +
        `env ${plan.desired.environmentName}`,
    )
  }
  if (!flags.apply) {
    logger.log('Re-run with --apply to write these configurations.')
    return
  }
  if (!pending.length) {
    logger.success('every named package already conforms — nothing to write.')
    return
  }
  logger.log(formatAuthGate(pending.length))
  let configured = 0
  const failures: string[] = []
  // Packages whose write ran but whose result could not be read back. Held
  // apart from failures so the summary never claims a write failed when the
  // only thing that failed was reading it.
  const unverified: string[] = []
  for (let i = 0, { length } = pending; i < length; i += 1) {
    const plan = pending[i]!
    if (i > 0) {
      // eslint-disable-next-line no-await-in-loop -- sequential: one 2FA window, npm's own rate-limit guidance.
      await sleep(WRITE_SPACING_MS)
    }
    // A PTY makes npm take its interactive OTP path, which waits rather than
    // refusing; this answers that wait and opens the approval page.
    // eslint-disable-next-line no-await-in-loop -- sequential writes share one 2FA window.
    const code = await runTrustWriteInteractive(
      npmPath,
      buildTrustWriteArgs(plan.pkg, plan.desired),
      neutralCwd,
    )
    // eslint-disable-next-line no-await-in-loop -- the verify belongs to this package's turn.
    const verify = await runCaptureBoth(
      npmPath,
      ['trust', 'list', plan.pkg],
      neutralCwd,
    )
    if (code === 0 && listOutputMatches(verify.output, plan.desired)) {
      configured += 1
      logger.success(`${plan.pkg}: configured and verified.`)
      continue
    }
    // A REFUSED verify read is not a failed write. `npm trust list` needs the
    // same 2FA the write does, so a refusal says the row could not be READ —
    // reporting that as "did not verify" would claim knowledge this run does
    // not have, in the direction that hides a write that actually landed.
    if (isOtpRequired(verify.output)) {
      unverified.push(plan.pkg)
      logger.warn(formatUnverifiable(plan.pkg, plan.desired, code))
      continue
    }
    failures.push(plan.pkg)
    logger.fail(formatVerifyFailure(plan.pkg, plan.desired, verify.output))
  }
  const skipped = plans.length - pending.length
  logger.log(
    `Trusted-publisher summary: ${configured} configured, ${skipped} already ` +
      `conforming, ${unverified.length} unverifiable, ${failures.length} failed.`,
  )
  // An unverifiable package is an unfinished job, not a green one: the exit is
  // non-zero so a pipeline never treats "could not read" as "configured".
  if (failures.length || unverified.length) {
    process.exitCode = 1
  }
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'configures npm trusted publishers for workspace packages through the npm trust registry API',
  help: `Usage: node scripts/fleet/publish-infra/npm/trust.mts [<pkg>…] [flags]

  --apply              perform the writes and verify each (dry-run by default)
  --repo <owner/name>  override the repository the trusted publisher binds to`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
