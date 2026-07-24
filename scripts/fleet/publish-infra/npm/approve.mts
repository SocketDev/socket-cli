/**
 * @file `--approve` mode: list the user's staged packages, multi-select,
 *   run the pre-approve integrity gate, then batch-approve with one shared
 *   2FA OTP and create the git tag + GitHub release for each promoted
 *   package. `--yes` replaces both interactive prompts for agent/scripted
 *   runs: every eligible entry is selected, and with no `--otp` the registry
 *   challenge drives pnpm's web-OTP (a browser window to npmjs.com opens per
 *   approve call, so the human authenticates in the browser instead of the
 *   terminal).
 */

import os from 'node:os'
import process from 'node:process'

import { httpRequest } from '@socketsecurity/lib-stable/http-request'
import { sleep } from '@socketsecurity/lib/promises/timers'
import { checkbox, password } from '@socketsecurity/lib/stdio/prompts'

import { releaseBehindLiveGate } from '../release.mts'
import {
  logger,
  rootPath,
  runCapture,
  runInherit,
  runInheritTty,
} from '../shared.mts'
import { isAlreadyPublished } from './registry.mts'
import type { StageListEntry } from './shared.mts'
import {
  fetchPriorProvenanceMap,
  formatPriorProvenance,
  listStagedPackages,
} from './shared.mts'
import { scanStagedEntry } from './scan.mts'
import { verifyStagedEntry } from './staged.mts'

export interface ApproveChoice {
  checked: boolean
  name: string
  value: string
}

const NPM_REGISTRY = 'https://registry.npmjs.org'

// Best-effort: pop the default browser at `url`. Non-fatal when it can't
// (headless / CI) — the caller prints the URL either way.
async function openBrowser(url: string, cwd: string): Promise<void> {
  const opener =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'start'
        : 'xdg-open'
  try {
    await runCapture(opener, [url], cwd)
  } catch {
    // Printing the URL is the fallback; nothing to do.
  }
}

/**
 * The registry's web-login protocol, done by hand: create a session
 * (POST /-/v1/login), hand the human the login URL (opening the browser
 * best-effort), poll `doneUrl` until the token arrives, persist it with
 * `npm config set`. `npm login` isn't spawnable here: without a TTY its web
 * flow bails to the legacy `Username:` prompt, which EOFs and dies in
 * agent-driven runs — and those runs are the reason `--yes` exists.
 */
async function webLogin(home: string): Promise<boolean> {
  // `npm-auth-type: web` is load-bearing: without it the registry 401s the
  // session create (it gates the endpoint on the client declaring web auth).
  const created = await httpRequest(`${NPM_REGISTRY}/-/v1/login`, {
    body: '{}',
    headers: {
      'content-type': 'application/json',
      'npm-auth-type': 'web',
      'npm-command': 'login',
    },
    method: 'POST',
  })
  if (!created.ok) {
    logger.fail(`Web-login session create failed (${created.status}).`)
    return false
  }
  const session = created.json<{
    doneUrl?: string | undefined
    loginUrl?: string | undefined
  }>()
  if (!session.loginUrl || !session.doneUrl) {
    logger.fail('Web-login session response missing loginUrl/doneUrl.')
    return false
  }
  logger.log(`Authenticate in the browser: ${session.loginUrl}`)
  await openBrowser(session.loginUrl, home)
  // Poll until authenticated: 202 (+ retry-after) while pending, 200 + token
  // once the human completes the browser challenge. Cap at ~10 minutes.
  const deadline = Date.now() + 10 * 60 * 1000
  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    const done = await httpRequest(session.doneUrl, {
      headers: { 'npm-auth-type': 'web', 'npm-command': 'login' },
    })
    if (done.status === 200) {
      const { token } = done.json<{ token?: string | undefined }>()
      if (!token) {
        logger.fail('Web-login done response carried no token.')
        return false
      }
      const { code } = await runCapture(
        'npm',
        [
          'config',
          'set',
          `//registry.npmjs.org/:_authToken=${token}`,
          '--location=user',
        ],
        home,
      )
      if (code !== 0) {
        logger.fail(
          `Persisting the npm token failed (npm config set → ${code}).`,
        )
        return false
      }
      logger.success('npm web login complete; token saved to the user npmrc.')
      return true
    }
    if (done.status !== 202) {
      logger.fail(`Web-login poll failed (${done.status}).`)
      return false
    }
    const retryAfterHeader = done.headers['retry-after']
    const retryAfter = Number(
      Array.isArray(retryAfterHeader) ? retryAfterHeader[0] : retryAfterHeader,
    )
    // eslint-disable-next-line no-await-in-loop
    await sleep(
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000,
    )
  }
  logger.fail('Web-login timed out after 10 minutes.')
  return false
}

/**
 * Ensure local npm auth before touching the staging endpoints — they 401
 * without a token, and `pnpm stage list`'s failure output parses as an EMPTY
 * stage list, which would silently no-op the whole approve. When logged out:
 * on a real terminal, defer to `npm login` (its web-first flow is the nicest
 * UX there); without a TTY, run the web-login protocol directly. npm
 * commands run from the OS home dir because the repo's devEngines pins pnpm
 * as the package manager and vetoes bare `npm` invocations in-repo.
 */
export async function ensureNpmLogin(): Promise<boolean> {
  const home = os.homedir()
  const { code } = await runCapture('npm', ['whoami'], home)
  if (code === 0) {
    return true
  }
  logger.log('Not logged in to npm — starting browser login…')
  if (process.stdin.isTTY) {
    const login = await runInherit('npm', ['login'], home)
    if (login !== 0) {
      logger.fail(`npm login exited ${login}.`)
      return false
    }
    return true
  }
  return await webLogin(home)
}

/**
 * Build the checkbox choices for the approve multi-select: one row per eligible
 * staged entry, labelled `name@version` with the prior-provenance annotation,
 * valued by its stageId, pre-checked so the default is "approve all". Pure over
 * the eligible list + the prior-provenance map.
 */
export function buildApproveChoices(
  eligible: readonly StageListEntry[],
  priorProvenance: ReadonlyMap<string, boolean>,
): ApproveChoice[] {
  return eligible.map(e => ({
    checked: true,
    name: `${e.name}@${e.version}${formatPriorProvenance(priorProvenance.get(e.name!))}`,
    value: e.stageId!,
  }))
}

/**
 * `--approve` mode: list the user's staged packages, multi-select, batch
 * approve with one OTP.
 *
 * Filters out any staged entries whose name@version is already public (e.g. a
 * re-stage after a partial approve). Empty selection is a no-op. The OTP is
 * read via a hidden-character prompt; a single OTP value is reused across all
 * approve calls in the same batch — npm accepts the same TOTP within its ~30s
 * validity window. With `yes` both prompts are skipped: all eligible entries
 * are selected, and (absent `otpFromFlag`) 2FA falls through to the browser
 * web-OTP challenge.
 */
export async function runApprove(config: {
  dryRun: boolean
  noScan: boolean
  otpFromFlag: string | undefined
  skipRelease?: boolean | undefined
  yes: boolean
}): Promise<void> {
  const { dryRun, noScan, otpFromFlag, skipRelease, yes } = {
    __proto__: null,
    ...config,
  } as typeof config
  if (!(await ensureNpmLogin())) {
    process.exitCode = 1
    return
  }
  const staged = await listStagedPackages()
  if (staged.length === 0) {
    logger.log('No packages currently staged.')
    return
  }

  // Filter out already-published versions. If a stage upload was
  // approved earlier but the entry lingers in stage list (registry
  // quirk), don't offer it for re-approval.
  const eligible: StageListEntry[] = []
  for (const entry of staged) {
    // eslint-disable-next-line no-await-in-loop
    if (
      entry.name &&
      entry.version &&
      !(await isAlreadyPublished(entry.name, entry.version, rootPath))
    ) {
      eligible.push(entry)
    }
  }
  if (eligible.length === 0) {
    logger.log('All staged entries are already published; nothing to approve.')
    return
  }

  // Fetch prior-version provenance for each unique package name so the
  // approver can spot regressions (last public version had provenance
  // but the staged one's parent name has lost trust metadata between
  // versions — a workflow drift signal). Cheap: one fetch per unique
  // name, abbreviated packument (no _npmUser needed; we only check
  // attestations presence as a proxy for "this name is OIDC-published").
  const priorProvenance = await fetchPriorProvenanceMap(eligible)

  const choices = buildApproveChoices(eligible, priorProvenance)
  let selected: string[] | undefined
  if (yes) {
    // --yes (agent / scripted runs, no TTY): approve everything eligible —
    // the same set the interactive default offers (every row pre-checked).
    // The rows still print so the prior-provenance annotations stay visible.
    logger.log('--yes: approving all staged packages:')
    for (const choice of choices) {
      logger.log(`  ${choice.name}`)
    }
    selected = choices.map(c => c.value)
  } else {
    selected = (await checkbox({
      message: 'Select staged packages to approve:',
      choices,
    })) as string[] | undefined
  }
  if (!selected || selected.length === 0) {
    logger.log('Nothing selected; exiting.')
    return
  }

  if (dryRun) {
    logger.log('[dry-run] would approve:')
    for (const stageId of selected) {
      const entry = eligible.find(e => e.stageId === stageId)
      logger.log(`  ${entry?.name}@${entry?.version} (id: ${stageId})`)
    }
    logger.success(
      `Dry-run complete. Re-run without --dry-run to prompt for OTP and promote.`,
    )
    return
  }

  // OTP resolution order:
  //   1. --otp <code> flag (CI / scripted use).
  //   2. --yes with no --otp: skip the prompt entirely and let the registry
  //      challenge drive pnpm's web-OTP (browser) flow directly.
  //   3. Interactive prompt; entering a TOTP code uses it for all
  //      approvals; entering nothing falls through to pnpm's per-call
  //      web-OTP flow (the registry challenges and pnpm opens a browser
  //      window to npmjs.com for each approve call).
  // Passing the same TOTP to every approve in a batch is fine: npm
  // accepts the same code for the duration of its ~30s validity window.
  let otp = otpFromFlag
  if (!otp && yes) {
    logger.log(
      'No --otp supplied; npm opens a browser window (web-OTP) to authenticate each approve — complete the 2FA there.',
    )
  } else if (!otp) {
    const entered = (await password({
      message:
        '2FA OTP (TOTP code for batch; leave blank for browser web-OTP):',
      mask: '*',
    })) as string | undefined
    if (entered) {
      otp = entered
    }
  }

  // Pre-approve integrity gate: verify EACH selected staged package before the
  // promote loop. A mismatch (or unresolvable staged digest) drops the entry;
  // if nothing survives, return before any `pnpm stage approve` runs so the
  // 2FA / OAuth promote is never reached on a divergent artifact.
  const verified: string[] = []
  for (const stageId of selected) {
    const entry = eligible.find(e => e.stageId === stageId)
    // eslint-disable-next-line no-await-in-loop
    if (entry && (await verifyStagedEntry(entry))) {
      verified.push(stageId)
    }
  }
  if (verified.length === 0) {
    logger.fail(
      'No selected package passed pre-approve verification; nothing approved.',
    )
    process.exitCode = 1
    return
  }
  if (verified.length < selected.length) {
    logger.fail(
      `${selected.length - verified.length}/${selected.length} failed pre-approve verify; ` +
        `approving only the ${verified.length} verified. Reject the rest (pnpm stage reject <id>).`,
    )
    process.exitCode = 1
  }

  // Full-scan gate: the shasum verify above proved the staged bytes match
  // the local pack, so a Socket scan of the local artifact IS a scan of the
  // upload. Entries that fail drop out, mirroring the verify gate.
  let gated = verified
  if (noScan) {
    logger.log('--no-scan: skipping the Socket full-scan gate.')
  } else {
    const scanned: string[] = []
    for (let i = 0, { length } = verified; i < length; i += 1) {
      const stageId = verified[i]!
      const entry = eligible.find(e => e.stageId === stageId)
      if (
        entry?.name &&
        entry.version &&
        // eslint-disable-next-line no-await-in-loop
        (await scanStagedEntry({ name: entry.name, version: entry.version }))
      ) {
        scanned.push(stageId)
      }
    }
    if (scanned.length === 0) {
      logger.fail(
        'No selected package passed the Socket scan gate; nothing approved.',
      )
      process.exitCode = 1
      return
    }
    if (scanned.length < verified.length) {
      logger.fail(
        `${verified.length - scanned.length}/${verified.length} failed the scan gate; ` +
          `approving only the ${scanned.length} that scanned clean.`,
      )
      process.exitCode = 1
    }
    gated = scanned
  }

  let approved = 0
  let failed = 0
  const approvedEntries: StageListEntry[] = []
  for (let i = 0, { length } = gated; i < length; i += 1) {
    const stageId = gated[i]!
    const args = ['stage', 'approve', stageId]
    if (otp) {
      args.push('--otp', otp)
    }
    // TTY-wrapped: the registry's web-OTP challenge (no --otp) refuses
    // non-interactive stdio instead of opening the browser.
    // eslint-disable-next-line no-await-in-loop
    const code = await runInheritTty('pnpm', args, rootPath)
    if (code === 0) {
      approved += 1
      const entry = eligible.find(e => e.stageId === stageId)
      if (entry) {
        approvedEntries.push(entry)
      }
    } else {
      failed += 1
      logger.fail(`Approve ${stageId} exited ${code}`)
    }
  }
  if (failed > 0) {
    logger.fail(`${failed}/${gated.length} failed; ${approved} approved`)
    process.exitCode = 1
    return
  }
  logger.success(`Approved ${approved} package${approved === 1 ? '' : 's'}`)

  // Approve is the moment a staged package becomes public, so the git tag +
  // GitHub release are created here rather than at --staged time. This runs
  // locally where git, gh, and npm are all authenticated; the CI --staged step
  // holds only an OIDC npm token (no contents:write / GH_TOKEN), so a release
  // attempt there fails and is also premature (nothing is public yet).
  // `skipRelease` (--no-release) hands the tag + release to the caller — the
  // publish pipeline's release stage owns them there, with verify-time
  // checksums.
  if (skipRelease) {
    logger.log(
      '--no-release: leaving the tag + GitHub release to the caller ' +
        '(publish-pipeline release stage).',
    )
    return
  }
  for (let i = 0, { length } = approvedEntries; i < length; i += 1) {
    const entry = approvedEntries[i]!
    if (entry.name && entry.version) {
      // The tag + immutable release are the LAST markers: cut them only once
      // the approved version is actually resolvable on the registry.
      // eslint-disable-next-line no-await-in-loop
      const released = await releaseBehindLiveGate({
        isLive: () => isAlreadyPublished(entry.name!, entry.version!, rootPath),
        pkg: { name: entry.name, version: entry.version },
        registry: 'npm',
      })
      if (!released) {
        process.exitCode = 1
      }
    }
  }
}
