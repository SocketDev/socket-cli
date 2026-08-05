/*
 * @file Reads the npm account-settings inventory through a signed-in browser
 *   session, redacting every payload as it arrives.
 *
 *   The settings pages are session-only: no registry token can see the staged
 *   queue, the token list, or the 2FA device inventory, so the read goes
 *   through the SAME durable profile the rest of the fleet's npm tooling uses.
 *   The session, the launch shape, and the human-verification PAUSE all come
 *   from `browser-session.mts` — this file adds no launch logic of its own,
 *   and never retries into a bot challenge.
 *
 *   The sweep is cumulative rather than a fixed list: the profile page's own
 *   `memberships` decide which org pages are read next, so the inventory
 *   follows the account instead of a hard-coded roster that drifts.
 *
 *   Every payload passes through `redactContext` at the moment it is parsed.
 *   Nothing downstream — a log line, a report file, an error message — can
 *   hold a `csrftoken` or an access token, because the unredacted form is
 *   never assigned to anything that outlives the parse.
 *
 *   The playwright I/O is isolated here; the pure catalog, redaction, and
 *   posture read live in `account-inventory.mts` and are unit-tested there.
 */

import process from 'node:process'

import type { Page } from 'playwright-core'

import { unwrapContext } from './access-context-schema.mts'
import { validateSettingsContext } from './account-context-schema.mts'
import type { ContextValidation } from './account-context-schema.mts'
import {
  hasTotpOnlyRecoveryRisk,
  readAccountPosture,
  redactContext,
  SETTINGS_PAGES,
  settingsPageUrl,
} from './account-inventory.mts'
import type { AccountPosture, SettingsPage } from './account-inventory.mts'
import {
  fetchInPage,
  NPM_ORIGIN,
  openNpmBrowserSession,
  runChallengeAware,
} from './browser-session.mts'
import type {
  ChallengeAwareStep,
  NpmBrowserSessionOptions,
} from './browser-session.mts'
import { logger } from '../shared.mts'
import { isMainModule } from '../../_shared/is-main-module.mts'
import { runMain } from '../../_shared/run-main.mts'
import type { ScriptMeta } from '../../_shared/run-main.mts'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'

/**
 * One swept page's result. `context` is present only on a clean read.
 */
export interface InventoryEntry {
  context?: Record<string, unknown> | undefined
  error?: string | undefined
  id: string
  status: number
  url: string
  /**
   * How the payload measured against its page's schema. Absent on a failed
   * read, since there was no payload to check.
   */
  validation?: ContextValidation | undefined
}

/**
 * The whole sweep. `findings` names what an operator should act on.
 */
export interface AccountInventory {
  account: string
  entries: InventoryEntry[]
  findings: string[]
  posture: AccountPosture | undefined
}

// Read one settings page and hand back its REDACTED context. The redaction
// happens here, at the parse, so no caller can be handed the raw payload.
async function readSettingsPayload(
  page: Page,
  url: string,
  label: string,
): Promise<{ context?: Record<string, unknown> | undefined; status: number }> {
  const attempt = async (): Promise<
    ChallengeAwareStep<{
      context?: Record<string, unknown> | undefined
      status: number
    }>
  > => {
    const last = await fetchInPage(page, url, 'application/json')
    if (last.status === 401 || last.status === 403) {
      throw new Error(
        `${label} needs sign-in (HTTP ${last.status}). Re-run and sign in.`,
      )
    }
    if (last.status < 200 || last.status >= 300) {
      return { kind: 'challenge' }
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(last.body)
    } catch {
      // An HTML body from a settings URL is npm's challenge interstitial, not
      // a payload. Treat it as a challenge so the operator gets the PAUSE
      // rather than a parse error that reads like a broken script.
      return { kind: 'challenge' }
    }
    const redacted = redactContext(unwrapContext(parsed))
    return {
      kind: 'done',
      value: {
        context: redacted as Record<string, unknown>,
        status: last.status,
      },
    }
  }
  return runChallengeAware(page, attempt, { label, url })
}

// One page into one entry. A failed page is recorded and the sweep continues:
// a billing page that 404s must not cost the operator the token inventory.
async function sweepPage(
  page: Page,
  id: string,
  url: string,
): Promise<InventoryEntry> {
  try {
    const { context, status } = await readSettingsPayload(page, url, id)
    // Validated AFTER redaction on purpose: the schemas describe the shape the
    // audit reads, and every credential field is optional, so a redacted
    // payload still satisfies them. Checking the raw form first would mean
    // holding it longer than the parse.
    return {
      context,
      id,
      status,
      url,
      validation: validateSettingsContext(id, context),
    }
  } catch (e) {
    return { error: errorMessage(e), id, status: 0, url }
  }
}

/**
 * What an operator should act on, read off the posture. Kept beside the sweep
 * so a finding is reported the moment the state that proves it is in hand.
 */
export function inventoryFindings(posture: AccountPosture): string[] {
  const findings: string[] = []
  if (hasTotpOnlyRecoveryRisk(posture)) {
    findings.push(
      'Two-factor is TOTP-only while npm has closed new TOTP enrollment. Losing that device leaves no sanctioned way to re-enroll the same factor. Register a WebAuthn key while the option is open.',
    )
  }
  if (posture.auditLogEnabled === false) {
    findings.push(
      'The audit log is off, so a publish or a stage promote leaves no record of who performed it.',
    )
  }
  return findings
}

/**
 * Sweep the account's settings pages and return the redacted inventory. The
 * caller supplies nothing but session options: the account comes from whoever
 * is signed in, and the orgs come from that account's own memberships.
 */
export async function readAccountInventory(
  options?: NpmBrowserSessionOptions | undefined,
): Promise<AccountInventory> {
  const session = await openNpmBrowserSession(options)
  const { page, user } = session
  try {
    const entries: InventoryEntry[] = []
    const userPages = SETTINGS_PAGES.filter(
      (p: SettingsPage) => p.scope === 'user',
    )
    for (let i = 0, { length } = userPages; i < length; i += 1) {
      const settingsPage = userPages[i]!
      const url = settingsPageUrl(NPM_ORIGIN, settingsPage, user)
      entries.push(await sweepPage(page, settingsPage.id, url))
      logger.log(`Read ${settingsPage.id} for ${user}.`)
    }
    const profile = entries.find(e => e.id === 'profile')?.context
    const posture = profile ? readAccountPosture(profile) : undefined
    // The orgs come from the profile the sweep just read, so the inventory
    // follows the account rather than a roster that drifts out of date.
    const orgPage = SETTINGS_PAGES.find((p: SettingsPage) => p.scope === 'org')
    if (orgPage && posture) {
      for (const { org } of posture.orgRoles) {
        const url = settingsPageUrl(NPM_ORIGIN, orgPage, org)
        entries.push(await sweepPage(page, `${orgPage.id}:${org}`, url))
        logger.log(`Read ${orgPage.id} for ${org}.`)
      }
    }
    return {
      account: user,
      entries,
      findings: posture ? inventoryFindings(posture) : [],
      posture,
    }
  } finally {
    await session.close()
  }
}

// Print the sweep. `--json` emits the redacted inventory for a consumer;
// the default prints the posture and findings for a human.
async function main(): Promise<void> {
  const wantsJson = process.argv.slice(2).includes('--json')
  const inventory = await readAccountInventory()
  if (wantsJson) {
    logger.log(JSON.stringify(inventory, undefined, 2))
    return
  }
  logger.log('')
  logger.log(`npm account inventory for ${inventory.account}`)
  for (const entry of inventory.entries) {
    const state = entry.error
      ? `FAILED — ${entry.error}`
      : `HTTP ${entry.status}`
    logger.log(`  ${entry.id}: ${state}`)
  }
  const { posture } = inventory
  if (posture) {
    logger.log('')
    logger.log(`  two-factor mode: ${posture.twoFactorMode ?? 'unknown'}`)
    logger.log(`  webauthn keys: ${posture.webauthnDeviceCount ?? 'unknown'}`)
    logger.log(`  audit log: ${posture.auditLogEnabled ?? 'unknown'}`)
    logger.log(
      `  staged publishing: ${posture.stagedPublishingEnabled ?? 'unknown'}`,
    )
    logger.log(`  org roles: ${posture.orgRoles.length}`)
  }
  if (inventory.findings.length) {
    logger.log('')
    logger.log('Findings:')
    for (const finding of inventory.findings) {
      logger.log(`  - ${finding}`)
    }
  }
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'reads the npm account-settings inventory through a signed-in browser session, redacting every payload',
  help: `Usage: node scripts/fleet/publish-infra/npm/account-inventory-read.mts [flags]

  --json  emit the redacted inventory as JSON instead of the human summary`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
