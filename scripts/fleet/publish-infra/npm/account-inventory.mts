/*
 * @file The npm account-settings inventory: which settings pages an audit
 *   reads, and the redaction that makes their payloads safe to keep.
 *
 *   Every settings page ships its state as data — the same payload an
 *   `x-spiferack: 1` fetch returns as JSON — and that payload carries live
 *   credentials beside the state worth auditing: a `csrftoken` good for the
 *   session, an OAuth `linkStateValue`, and on the token pages the access
 *   token itself. Collecting pages by hand puts all three into whatever
 *   transcript or file the collection lands in, which is how an audit of a
 *   publishing identity turns into a credential leak.
 *
 *   `redactContext` is the seam that makes a sweep safe: it strips the
 *   credential-bearing fields as the payload is read, so no caller ever holds
 *   a secret it could log. Value-shape detection derives from the fleet's one
 *   secret catalog (`token-patterns.mts`) instead of a second copy, so a
 *   vendor shape added there is caught here for free.
 *
 *   Pure by design: no playwright, no network, no filesystem. The I/O lives in
 *   `account-inventory-read.mts` so this module is unit-tested on its own.
 */

import { scanSecretValues } from '../../../../.claude/hooks/fleet/_shared/token-patterns.mts'

/**
 * Written in place of a credential-bearing value.
 */
export const REDACTED = '[redacted]'

/**
 * Written in place of a bulky field an audit never reads.
 */
export const OMITTED = '[omitted]'

// Keys whose entire value is a credential. Matched whole rather than as a
// substring so `stagedPublishingEnabled` and `tokenCount` survive the walk.
const SECRET_KEY_EXACT =
  /^(?:apikey|csrftoken|password|secret|sessionid|token)$/i

// Keys whose NAME carries a credential marker anywhere in it. npm varies the
// spelling between pages (`csrftoken`, `csrfToken`, `_csrf`), so this pass is
// substring-matched where the exact list is not.
const SECRET_KEY_PART = /bearer|cookie|csrf|linkstate|privatekey/i

// Bulky fields with no audit value: signed avatar URLs and the SPA's own asset
// manifest, which together dwarf the state worth keeping.
const OMITTED_KEYS = new Set(['avatars', 'chunks'])

// Deep enough for every payload these pages ship. The cap is a backstop
// against pathological nesting, not a depth the pages are expected to reach.
const MAX_DEPTH = 12

/**
 * A copy of `value` with every credential-bearing field replaced. Walks
 * objects and arrays; leaves other primitives alone.
 *
 * Two passes, because a secret can hide behind either its key or its shape:
 * a field NAMED like a credential is redacted whatever it holds, and a string
 * that MATCHES a known token shape is redacted whatever it is called. The
 * second pass is what catches a token npm moves to a field this list has
 * never seen.
 */
export function redactContext(value: unknown): unknown {
  return redactValue(value, 0, new WeakSet())
}

// `ancestors` holds only the objects currently being walked, added on the way
// down and removed on the way back up. That makes it a cycle guard rather than
// a de-duplicator: the same object appearing twice as siblings is legitimate
// and must be kept, while an object containing itself must not recurse.
function redactValue(
  value: unknown,
  depth: number,
  ancestors: WeakSet<object>,
): unknown {
  if (typeof value === 'string') {
    return scanSecretValues(value) ? REDACTED : value
  }
  if (value === null || typeof value !== 'object') {
    return value
  }
  if (depth >= MAX_DEPTH) {
    return OMITTED
  }
  const node = value as object
  if (ancestors.has(node)) {
    return OMITTED
  }
  ancestors.add(node)
  try {
    if (Array.isArray(value)) {
      return value.map(entry => redactValue(entry, depth + 1, ancestors))
    }
    const source = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    const keys = Object.keys(source)
    for (let i = 0, { length } = keys; i < length; i += 1) {
      const key = keys[i]!
      if (OMITTED_KEYS.has(key)) {
        out[key] = OMITTED
      } else if (SECRET_KEY_EXACT.test(key) || SECRET_KEY_PART.test(key)) {
        out[key] = REDACTED
      } else {
        out[key] = redactValue(source[key], depth + 1, ancestors)
      }
    }
    return out
  } finally {
    ancestors.delete(node)
  }
}

/**
 * One settings page in the sweep.
 */
export interface SettingsPage {
  /**
   * Key this page's payload is filed under in the inventory.
   */
  id: string
  /**
   * Path template; `<account>` is the signed-in user or an org.
   */
  path: string
  /**
   * What this page answers that no other page in the sweep does.
   */
  reads: string
  /**
   * Whether `<account>` names the signed-in user or an organization.
   */
  scope: 'org' | 'user'
}

/**
 * The pages worth sweeping, each earning its place by answering something the
 * others do not. The account's public profile inventory is deliberately absent:
 * `access-context-schema.mts` already models it, and it paginates.
 */
export const SETTINGS_PAGES: readonly SettingsPage[] = [
  {
    id: 'profile',
    path: '/settings/<account>/profile',
    reads:
      'Two-factor mode and device inventory, org memberships and roles, whether the audit log is on.',
    scope: 'user',
  },
  {
    id: 'tokens',
    path: '/settings/<account>/tokens',
    reads: 'Every token on the account with its type, scope, and expiry.',
    scope: 'user',
  },
  {
    id: 'staged-packages',
    path: '/settings/<account>/staged-packages',
    reads:
      'The approval queue: how many versions are held, and which stage was promoted last.',
    scope: 'user',
  },
  {
    id: 'billing',
    path: '/settings/<account>/billing',
    reads: 'Plan and payment state for the publishing identity.',
    scope: 'user',
  },
  {
    id: 'org-teams',
    path: '/settings/<account>/teams',
    reads: 'An org’s team roster and the package grants each team holds.',
    scope: 'org',
  },
]

/**
 * The absolute URL for `page` against `account`. The account is
 * percent-encoded because an org or user name reaches this from a config file
 * and a stray slash would otherwise re-point the fetch at another page.
 */
export function settingsPageUrl(
  origin: string,
  page: SettingsPage,
  account: string,
): string {
  return `${origin}${page.path.replace('<account>', encodeURIComponent(account))}`
}

/**
 * The detail page for one granular access token. Listed separately from
 * `SETTINGS_PAGES` because it needs an id the token list supplies, so it can
 * only be swept once that list has been read.
 */
export function granularTokenPageUrl(
  origin: string,
  account: string,
  tokenId: string,
): string {
  return `${origin}/settings/${encodeURIComponent(account)}/tokens/granular-access-tokens/${encodeURIComponent(tokenId)}`
}

/**
 * One org membership as the profile page reports it.
 */
export interface OrgRole {
  org: string
  role: string
}

/**
 * The audit-relevant posture of a publishing account.
 */
export interface AccountPosture {
  /**
   * Undefined when the payload does not say, which is distinct from false.
   */
  auditLogEnabled: boolean | undefined
  orgRoles: OrgRole[]
  stagedPublishingEnabled: boolean | undefined
  totpEnrollmentClosed: boolean | undefined
  twoFactorMode: string | undefined
  webauthnDeviceCount: number | undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

// Every membership row npm reports as `{ role, org: { name } }`. A row missing
// either half is skipped rather than defaulted, so a shape change shows up as a
// short list instead of a roster of empty strings.
function readOrgRoles(context: Record<string, unknown>): OrgRole[] {
  const objects = asRecord(context['memberships'])?.['objects']
  if (!Array.isArray(objects)) {
    return []
  }
  const roles: OrgRole[] = []
  for (const entry of objects) {
    const row = asRecord(entry)
    const org = asRecord(row?.['org'])?.['name']
    const role = row?.['role']
    if (typeof org === 'string' && typeof role === 'string') {
      roles.push({ org, role })
    }
  }
  return roles
}

/**
 * The posture fields an audit reports, read off a profile payload. Reads a
 * REDACTED context happily: none of these fields is credential-bearing, which
 * is the point — the audit never needs the secrets it strips.
 */
export function readAccountPosture(
  context: Record<string, unknown>,
): AccountPosture {
  const devices = asRecord(context['tfaDevices'])
  const webauthn = devices?.['webauthn']
  const mode = devices?.['mode']
  return {
    auditLogEnabled: asBoolean(context['auditLogEnabled']),
    orgRoles: readOrgRoles(context),
    stagedPublishingEnabled: asBoolean(context['stagedPublishingEnabled']),
    totpEnrollmentClosed: asBoolean(context['isAddingNewTotpDeprecated']),
    twoFactorMode: typeof mode === 'string' ? mode : undefined,
    webauthnDeviceCount: Array.isArray(webauthn) ? webauthn.length : undefined,
  }
}

/**
 * Whether the account's only second factor is TOTP while npm has closed new
 * TOTP enrollment. True means losing that one device leaves no sanctioned way
 * to re-enroll the same factor — the recovery path a publishing identity most
 * needs, and a gap a WebAuthn key closes while the option is still open.
 *
 * Undefined posture fields answer false: an unknown state is not a finding.
 */
export function hasTotpOnlyRecoveryRisk(posture: AccountPosture): boolean {
  return (
    posture.totpEnrollmentClosed === true && posture.webauthnDeviceCount === 0
  )
}
