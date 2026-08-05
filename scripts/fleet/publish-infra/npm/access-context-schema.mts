/*
 * @file Schema for the npm package access page's `window.__context__` payload —
 *   the subset the trusted-publisher flows read.
 *
 *   The page ships its state as data (the same payload the `x-spiferack: 1`
 *   fetch returns as JSON) and renders a view of it. Reading that data is exact
 *   where marker-scraping is not: a restyled summary, a React shell that has
 *   not hydrated, or a renamed CSS class all break markers while the payload
 *   keeps its shape.
 *
 *   Anchored on KEYS only. Nothing here may key on markup, chunk filenames, or
 *   `integrity="sha512-…"` attributes: those carry content digests that rotate
 *   on every npm deploy, so a matcher built on one is broken by design.
 *
 *   Validating rather than duck-typing is what makes a payload change fail
 *   loud. A silent mis-parse here reports a configured package as
 *   unconfigured, and the caller then plans a create over a live row.
 */

import { Type } from '@sinclair/typebox'
import type { Static } from '@sinclair/typebox'

/**
 * One OIDC trusted-publisher connection. `permissions` holds npm's own grant
 * tokens (`createStagedPackage` for stage publish, `createPackageVersion` for
 * direct publish); `deleted` is non-null for a revoked row, which readers skip.
 * `durable_ids` may carry nulls before npm resolves the GitHub numeric ids.
 */
export const OidcConnectionSchema = Type.Object(
  {
    config: Type.Object(
      {
        durable_ids: Type.Optional(
          Type.Object(
            {
              repository_id: Type.Union([Type.String(), Type.Null()]),
              repository_owner_id: Type.Union([Type.String(), Type.Null()]),
            },
            { additionalProperties: true },
          ),
        ),
        environment_name: Type.Optional(
          Type.Union([Type.String(), Type.Null()]),
        ),
        repository_name: Type.String(),
        repository_owner: Type.String(),
        workflow: Type.String(),
      },
      { additionalProperties: true },
    ),
    config_id: Type.Optional(Type.String()),
    created: Type.Optional(Type.String()),
    deleted: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    permissions: Type.Optional(Type.Array(Type.String())),
    publisher: Type.Optional(Type.String()),
    updated: Type.Optional(Type.String()),
  },
  {
    additionalProperties: true,
    description:
      'One trusted-publisher connection as the access page reports it. `additionalProperties` stays open on purpose: npm adds fields without warning, and a closed shape would reject a payload this flow can still read.',
  },
)

/**
 * The access page's package-settings form values. `publishingAccess` is the
 * 2FA posture (`tfa-always-required` on a package whose writes need 2FA), which
 * is why every trust write is gated.
 */
export const AccessFormDataSchema = Type.Object(
  {
    'package-settings': Type.Optional(
      Type.Object(
        {
          private: Type.Optional(
            Type.Object(
              { value: Type.Boolean() },
              { additionalProperties: true },
            ),
          ),
          publishingAccess: Type.Optional(
            Type.Object(
              { value: Type.String() },
              { additionalProperties: true },
            ),
          ),
        },
        { additionalProperties: true },
      ),
    ),
  },
  { additionalProperties: true },
)

/**
 * The fields the trusted-publisher flows consume off `window.__context__`.
 * `csrftoken` is present because the page's own writes carry it; this flow
 * reads it to recognize an authenticated page, never to log it.
 */
export const AccessContextSchema = Type.Object(
  {
    canEditPackage: Type.Optional(Type.Boolean()),
    csrftoken: Type.Optional(Type.String()),
    formData: Type.Optional(AccessFormDataSchema),
    oidcConnections: Type.Optional(Type.Array(OidcConnectionSchema)),
    package: Type.Optional(Type.String()),
    oidcPermissionsEnabled: Type.Optional(Type.Boolean()),
    stagedPublishingEnabled: Type.Optional(Type.Boolean()),
  },
  {
    additionalProperties: true,
    description:
      'The `window.__context__.context` subset the trusted-publisher read/write flows depend on.',
  },
)

/**
 * The staged-packages settings page's payload, the same `x-spiferack` contract
 * one page over. `stagedVersions.total` is the queue depth: zero means nothing
 * awaits approval, which is what distinguishes "the publish landed" from "the
 * publish is held" — a fresh reservation reads as absent from the registry for
 * a moment either way, so the queue is the deciding signal.
 *
 * `approveURL`/`rejectURL` are the page's own action endpoints and
 * `approvedStageId` names the last stage promoted; the approve flow posts to
 * them with the `csrftoken`, which this schema declares so a shape change is
 * caught before a POST is aimed at a stale path.
 */
export const StagedPackagesContextSchema = Type.Object(
  {
    approveURL: Type.Optional(Type.String()),
    approvedStageId: Type.Optional(Type.String()),
    csrftoken: Type.Optional(Type.String()),
    failedApproveStageId: Type.Optional(Type.String()),
    listURL: Type.Optional(Type.String()),
    rejectURL: Type.Optional(Type.String()),
    stagedPublishingEnabled: Type.Optional(Type.Boolean()),
    stagedVersions: Type.Optional(
      Type.Object(
        {
          objects: Type.Array(Type.Unknown()),
          total: Type.Number(),
        },
        { additionalProperties: true },
      ),
    ),
  },
  {
    additionalProperties: true,
    description:
      "The `window.__context__.context` subset the staged-publish approve flow reads from the account's staged-packages settings page.",
  },
)

/**
 * One row of the profile page's package inventory. Two fields make this the
 * fleet's best audit surface:
 *
 * - `lastPublish.maintainer` names WHO published last. `GitHub Actions` means a
 *   workflow did; a person's name means a local publish, which the fleet allows
 *   only for a `0.0.0` name reservation.
 * - `dist-tags.staged` appears when a staged version awaits approval, so the
 *   inventory shows a held release without opening the staged queue.
 */
export const ProfilePackageSchema = Type.Object(
  {
    'dist-tags': Type.Optional(Type.Record(Type.String(), Type.String())),
    freeze_status: Type.Optional(Type.Unknown()),
    is_high_impact: Type.Optional(Type.Boolean()),
    lastPublish: Type.Optional(
      Type.Object(
        {
          maintainer: Type.Optional(Type.String()),
          time: Type.Optional(Type.String()),
        },
        { additionalProperties: true },
      ),
    ),
    name: Type.String(),
    private: Type.Optional(Type.Boolean()),
    publish_requires_tfa: Type.Optional(Type.Unknown()),
    version: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
)

/**
 * The profile page's payload. `packages.total` is the full count while
 * `objects` holds one page of it, so a consumer that reads only the first page
 * sees 25 of 224 — `urls.next` is how the rest is reached, and ignoring it
 * would silently audit a twelfth of the account.
 */
export const ProfileContextSchema = Type.Object(
  {
    packages: Type.Optional(
      Type.Object(
        {
          objects: Type.Array(ProfilePackageSchema),
          total: Type.Number(),
          urls: Type.Optional(
            Type.Object(
              { next: Type.Optional(Type.Union([Type.String(), Type.Null()])) },
              { additionalProperties: true },
            ),
          ),
        },
        { additionalProperties: true },
      ),
    ),
    pagination: Type.Optional(
      Type.Object(
        { page: Type.Number(), perPage: Type.Number() },
        { additionalProperties: true },
      ),
    ),
  },
  {
    additionalProperties: true,
    description:
      "The `window.__context__.context` subset an audit reads from an account's profile page: the package inventory and its pagination.",
  },
)

/**
 * The context fields sit at two depths depending on how the payload arrived:
 * the HTML page embeds them under `window.__context__.context`, while an
 * `x-spiferack: 1` JSON fetch returns them at the TOP level (`packages`,
 * `scope`, `pagination`, …). Reading only the nested path against a JSON
 * response finds nothing and reports an empty inventory — a silent zero rather
 * than an error.
 */
export function unwrapContext(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object') {
    return {}
  }
  const outer = payload as { context?: unknown | undefined }
  const inner = outer.context
  if (inner && typeof inner === 'object') {
    return inner as Record<string, unknown>
  }
  return payload as Record<string, unknown>
}

/**
 * Each page is a COMPLETE payload for its own slice: `?page=N` answers with
 * `pagination.page: N`, its own 25 `objects`, and a `urls.next` for the page
 * after (verified across pages 0, 1, and 4 — 224 packages at 25 per page).
 *
 * The pages must still be walked. Clicking "show more" in the browser appends
 * rows client-side without rewriting the embedded payload, so re-reading a
 * loaded page's HTML keeps returning page 0; fetching `?page=N` is what
 * advances. A consumer that reads one page and stops audits 25 of 224 and
 * reports the other 199 as absent, which for a publish audit reads as
 * "nothing to fix".
 */
export function profilePackagesPageUrl(user: string, page: number): string {
  const account = encodeURIComponent(user)
  return `https://www.npmjs.com/~${account}?activeTab=packages&page=${page}`
}

/**
 * How many pages the inventory spans, from the total and the page size. The
 * count comes from `total`, never from the rows in hand.
 */
export function profilePackagesPageCount(
  total: number,
  perPage: number,
): number {
  if (perPage <= 0) {
    return 0
  }
  return Math.ceil(total / perPage)
}

/**
 * Whether `context`'s rows cover its own reported total. False means pages
 * remain, whatever the page's "show more" link happens to say.
 */
export function profilePackagesAreComplete(context: ProfileContext): boolean {
  const packages = context.packages
  if (!packages) {
    return false
  }
  return packages.objects.length >= packages.total
}

/**
 * The publisher recorded for `pkg`'s last release, or undefined when the row
 * does not say. `GitHub Actions` is the value a workflow publish leaves.
 */
export const CI_PUBLISHER = 'GitHub Actions'

export function lastPublishedBy(
  pkg: Static<typeof ProfilePackageSchema>,
): string | undefined {
  const who = pkg.lastPublish?.maintainer
  return typeof who === 'string' && who !== '' ? who : undefined
}

/**
 * Whether `pkg` carries a staged version awaiting approval — the `staged`
 * dist-tag, which npm adds beside `latest` while a release is held.
 */
export function stagedVersionOf(
  pkg: Static<typeof ProfilePackageSchema>,
): string | undefined {
  return pkg['dist-tags']?.['staged']
}

export type ProfilePackage = Static<typeof ProfilePackageSchema>
export type ProfileContext = Static<typeof ProfileContextSchema>
export type OidcConnection = Static<typeof OidcConnectionSchema>
export type AccessFormData = Static<typeof AccessFormDataSchema>
export type AccessContext = Static<typeof AccessContextSchema>
export type StagedPackagesContext = Static<typeof StagedPackagesContextSchema>

/**
 * The staged queue's depth, or undefined when the payload does not carry it.
 * Zero is a MEANINGFUL answer — nothing is held — so it stays distinct from
 * "the page did not say", which a bare falsy check would conflate.
 */
export function stagedQueueDepth(
  context: StagedPackagesContext,
): number | undefined {
  const total = context.stagedVersions?.total
  return typeof total === 'number' ? total : undefined
}

/**
 * Npm's grant tokens mapped to the rendered action strings the diff compares.
 * Both spellings of each grant are accepted: the payload and the form have used
 * different names for the same permission.
 */
export const OIDC_PERMISSION_ACTIONS: Readonly<Record<string, string>> = {
  createPackageVersion: 'npm publish',
  createStagedPackage: 'npm stage publish',
  publish: 'npm publish',
  stagePublish: 'npm stage publish',
}
