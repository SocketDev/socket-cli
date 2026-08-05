/*
 * @file Schemas for the npm ACCOUNT-SETTINGS `window.__context__` payloads,
 *   one per swept page plus the cumulative inventory they roll up into.
 *
 *   Sibling to `access-context-schema.mts`, which models the PACKAGE-side
 *   pages (access, staged-packages, public profile). This file covers the
 *   account side: settings/profile, settings/tokens, a granular access token's
 *   detail page, settings/billing, and an org's teams page.
 *
 *   Anchored on KEYS only, never on markup or chunk filenames — those carry
 *   content digests that rotate on every npm deploy, so a matcher built on one
 *   is broken by design.
 *
 *   `additionalProperties` stays open everywhere and nearly every field is
 *   optional. That is deliberate for an INVENTORY: a closed shape would reject
 *   a payload the sweep can still read, and turning an audit into a hard error
 *   because npm added a field is the wrong trade. Validation here answers "did
 *   the fields this audit READS survive npm's last deploy", not "is this
 *   payload exactly what we saw once".
 *
 *   Coverage is uneven ON PURPOSE, and the schema says so rather than guessing.
 *   `SettingsProfileContextSchema` is modelled from observed payloads. The
 *   token-list, billing, and org-teams shapes have NOT been observed, so they
 *   declare only the envelope fields every settings page carries; a sweep is
 *   what fills them in. Inventing field names for an unseen page would produce
 *   a schema that validates nothing and reads as though it validates
 *   everything.
 */

import { Type } from '@sinclair/typebox'
import type { Static, TSchema } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

// The staged-packages page is modelled once, on the package side, because the
// approve flow already depends on it. The sweep reuses that schema rather than
// keeping a second copy that could drift from the flow it describes.
import { StagedPackagesContextSchema } from './access-context-schema.mts'

/**
 * Fields EVERY settings page carries. npm renders one shell around each
 * settings view, so these arrive whichever page was asked for — which is why a
 * sweep can tell "the page answered" from "the page answered with content".
 *
 * `csrftoken` is declared because the payload carries it, never because a
 * reader wants it: `redactContext` replaces it before a payload reaches any
 * consumer, and declaring it keeps that redaction honest rather than implicit.
 */
export const SettingsEnvelopeSchema = Type.Object(
  {
    auditLogEnabled: Type.Optional(Type.Boolean()),
    csrftoken: Type.Optional(Type.String()),
    email: Type.Optional(Type.String()),
    stagedPublishingEnabled: Type.Optional(Type.Boolean()),
    userEmailVerified: Type.Optional(Type.Boolean()),
  },
  {
    additionalProperties: true,
    description:
      'The fields npm ships on every settings page, whichever view was requested.',
  },
)

/**
 * The two-factor device inventory. `mode` is the posture that decides whether
 * a WRITE needs a second factor: `auth-and-writes` means every publish and
 * stage promote prompts, which is why publishing cannot run off a bare token.
 *
 * `webauthn` being an EMPTY ARRAY is a meaningful reading, not a missing one —
 * it says the account has no hardware key, which paired with npm closing new
 * TOTP enrollment is the recovery gap the inventory reports.
 */
export const TfaDevicesSchema = Type.Object(
  {
    mode: Type.Optional(Type.String()),
    totp: Type.Optional(
      Type.Object(
        { pending: Type.Optional(Type.Boolean()) },
        { additionalProperties: true },
      ),
    ),
    webauthn: Type.Optional(Type.Array(Type.Unknown())),
  },
  { additionalProperties: true },
)

/**
 * One org membership row. `role` is what decides whether this identity can
 * approve its own staged release; `tfa_enforced` is the org's own posture,
 * which can be stricter than the account's.
 */
export const MembershipSchema = Type.Object(
  {
    org: Type.Object(
      {
        name: Type.String(),
        tfa_enforced: Type.Optional(Type.Boolean()),
      },
      { additionalProperties: true },
    ),
    role: Type.String(),
  },
  { additionalProperties: true },
)

/**
 * An npm-served banner. Worth modelling because npm announces auth and
 * publishing deprecations here first — the `bypass2fa-gat-deprecation-2026`
 * banner is how the token-restriction timeline surfaced — so a sweep that
 * captures banners notices a policy change without anyone reading a changelog.
 */
export const AlertBannerSchema = Type.Object(
  {
    id: Type.Optional(Type.String()),
    level: Type.Optional(Type.String()),
    message: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
)

/**
 * The account settings/profile payload — the richest page in the sweep, and
 * the only one whose fields drive findings. Modelled from observed payloads.
 *
 * `isAddingNewTotpDeprecated` reads as a UI hint and is really a policy flag:
 * true means npm has closed new TOTP enrollment, so a TOTP-only account has no
 * sanctioned way to re-enroll that factor if it loses the device.
 */
export const SettingsProfileContextSchema = Type.Object(
  {
    auditLogEnabled: Type.Optional(Type.Boolean()),
    alertBanners: Type.Optional(Type.Array(AlertBannerSchema)),
    csrftoken: Type.Optional(Type.String()),
    isAddingNewTotpDeprecated: Type.Optional(Type.Boolean()),
    memberships: Type.Optional(
      Type.Object(
        {
          objects: Type.Array(MembershipSchema),
          total: Type.Optional(Type.Number()),
        },
        { additionalProperties: true },
      ),
    ),
    stagedPublishingEnabled: Type.Optional(Type.Boolean()),
    tfaDevices: Type.Optional(TfaDevicesSchema),
    tfaEnabled: Type.Optional(Type.Boolean()),
    user: Type.Optional(
      Type.Object({ name: Type.String() }, { additionalProperties: true }),
    ),
  },
  {
    additionalProperties: true,
    description:
      "The account settings/profile payload: two-factor posture, org memberships, and whether the account's actions are audited.",
  },
)

/**
 * One granular access token's detail page. The permission trio is what decides
 * whether a token could have performed a write: a token reading `Read only` on
 * packages with `No access` to orgs cannot publish or promote anything, so it
 * is excluded as the cause of an unexplained release.
 *
 * `token` holds npm's own MASKED rendering, keeping only the first and last
 * characters. It is declared so `redactContext` has a named field to strip
 * rather than relying on the value-shape pass to catch a partial string.
 */
export const GranularTokenContextSchema = Type.Object(
  {
    expires: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    name: Type.Optional(Type.String()),
    orgsPermission: Type.Optional(Type.String()),
    packagesAndScopesPermission: Type.Optional(Type.String()),
    selectedScopes: Type.Optional(Type.Array(Type.String())),
    token: Type.Optional(Type.String()),
  },
  {
    additionalProperties: true,
    description:
      "One granular access token's detail payload: what it may touch, and until when.",
  },
)

/**
 * The token LIST page. Envelope-only: the list's row shape has not been
 * observed, so nothing beyond the shared fields is claimed. A sweep that reads
 * this page is what supplies the real shape.
 */
export const TokensContextSchema = Type.Object(
  { ...SettingsEnvelopeSchema.properties },
  {
    additionalProperties: true,
    description:
      'The settings/tokens payload. Envelope-only until a sweep observes the row shape.',
  },
)

/**
 * The billing page. Envelope-only for the same reason as the token list, and
 * with an extra motive: a billing payload is the likeliest page in the sweep
 * to carry payment identifiers, so nothing here invites a reader to go looking
 * for fields beyond the envelope.
 */
export const BillingContextSchema = Type.Object(
  { ...SettingsEnvelopeSchema.properties },
  {
    additionalProperties: true,
    description:
      'The settings/billing payload. Envelope-only; payment fields are redacted, never modelled.',
  },
)

/**
 * An org's teams page. Envelope-only until observed.
 */
export const OrgTeamsContextSchema = Type.Object(
  { ...SettingsEnvelopeSchema.properties },
  {
    additionalProperties: true,
    description:
      "An org's settings/teams payload. Envelope-only until a sweep observes the roster shape.",
  },
)

/**
 * One swept page as it lands in the cumulative inventory. `context` is absent
 * on a failed read and `error` says why, so a partial sweep reports which
 * pages it could not reach instead of quietly returning fewer entries.
 */
export const InventoryEntrySchema = Type.Object(
  {
    context: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    error: Type.Optional(Type.String()),
    id: Type.String(),
    status: Type.Number(),
    url: Type.String(),
  },
  { additionalProperties: true },
)

/**
 * The cumulative inventory: every swept page, the posture read off the
 * profile, and the findings that posture produces.
 *
 * This is the shape a consumer may persist. Every `context` inside it has been
 * through `redactContext`, which is the invariant that makes persisting one
 * safe — an inventory assembled any other way must not be written to disk.
 */
export const AccountInventorySchema = Type.Object(
  {
    account: Type.String(),
    entries: Type.Array(InventoryEntrySchema),
    findings: Type.Array(Type.String()),
    posture: Type.Optional(
      Type.Object(
        {
          auditLogEnabled: Type.Optional(
            Type.Union([Type.Boolean(), Type.Undefined()]),
          ),
          orgRoles: Type.Array(
            Type.Object(
              { org: Type.String(), role: Type.String() },
              { additionalProperties: true },
            ),
          ),
        },
        { additionalProperties: true },
      ),
    ),
  },
  {
    additionalProperties: true,
    description:
      'The cumulative account inventory: every swept page redacted, plus the posture and findings derived from it.',
  },
)

/**
 * The schema for a swept page id, or undefined for a page the sweep does not
 * model. An org-teams entry is filed as `org-teams:<org>`, so the lookup
 * matches on the portion before the colon.
 */
export function contextSchemaFor(pageId: string): TSchema | undefined {
  const base = pageId.split(':')[0]
  switch (base) {
    case 'billing':
      return BillingContextSchema
    case 'granular-token':
      return GranularTokenContextSchema
    case 'org-teams':
      return OrgTeamsContextSchema
    case 'profile':
      return SettingsProfileContextSchema
    case 'staged-packages':
      return StagedPackagesContextSchema
    case 'tokens':
      return TokensContextSchema
    default:
      return undefined
  }
}

/**
 * The outcome of checking one payload against its page's schema.
 */
export interface ContextValidation {
  errors: string[]
  /**
   * False only when a schema exists AND the payload failed it.
   */
  ok: boolean
  /**
   * True when the sweep models no schema for this page yet.
   */
  unmodelled: boolean
}

/**
 * Check a swept payload against its page's schema. An unmodelled page passes
 * with `unmodelled: true` rather than failing — the sweep is how those pages
 * get modelled, so refusing to read one would prevent its own fix.
 *
 * Errors are collected rather than thrown: one malformed page must not cost
 * the operator the rest of the inventory.
 */
export function validateSettingsContext(
  pageId: string,
  context: unknown,
): ContextValidation {
  const schema = contextSchemaFor(pageId)
  if (!schema) {
    return { errors: [], ok: true, unmodelled: true }
  }
  if (Value.Check(schema, context)) {
    return { errors: [], ok: true, unmodelled: false }
  }
  const errors: string[] = []
  for (const error of Value.Errors(schema, context)) {
    errors.push(`${error.path || '/'}: ${error.message}`)
  }
  return { errors, ok: false, unmodelled: false }
}

export type AlertBanner = Static<typeof AlertBannerSchema>
export type BillingContext = Static<typeof BillingContextSchema>
export type GranularTokenContext = Static<typeof GranularTokenContextSchema>
export type Membership = Static<typeof MembershipSchema>
export type OrgTeamsContext = Static<typeof OrgTeamsContextSchema>
export type SettingsEnvelope = Static<typeof SettingsEnvelopeSchema>
export type SettingsProfileContext = Static<typeof SettingsProfileContextSchema>
export type TfaDevices = Static<typeof TfaDevicesSchema>
export type TokensContext = Static<typeof TokensContextSchema>
