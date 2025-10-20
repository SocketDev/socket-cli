/**
 * Patch Download Handler
 *
 * Handles downloading patches from the Socket API and storing them locally.
 * Supports downloading by UUID or from scan results.
 *
 * Features:
 * - Download patches by UUID
 * - Download patches from scan results
 * - Save blobs to _cacache with integrity verification
 * - Update manifest with downloaded patch metadata
 * - Track download status and timestamps
 *
 * API Integration:
 * - Uses streamPatchesFromScan() for scan-based discovery
 * - Uses viewPatch() to get patch details and blob hashes
 * - Uses downloadPatch() to fetch blob content
 *
 * Storage:
 * - Uses cacache for content storage: ~/.socket/_cacache
 * - Keys follow pattern: socket:patch:blob:<uuid>:<filepath-hash>
 * - Integrity verified using SSRI format
 *
 * Data Flow:
 * 1. Get patch UUIDs (from args or scan)
 * 2. For each UUID, viewPatch() to get metadata
 * 3. For each file in patch, downloadPatch() blob content
 * 4. Save blobs to cacache with integrity verification
 * 5. Update manifest with status='downloaded'
 */

import crypto from 'node:crypto'

// @ts-expect-error - No type declarations available.
import ssri from 'ssri'

import * as cacache from '@socketsecurity/lib/cacache'
import { logger } from '@socketsecurity/lib/logger'
import { pluralize } from '@socketsecurity/lib/words'

import { outputPatchDownloadResult } from './output-patch-download-result.mts'
import ENV from '../../constants/env.mts'
import { addPatch } from '../../utils/manifest/patches.mts'
import { setupSdk } from '../../utils/socket/sdk.mts'

import type { OutputKind } from '../../types.mts'
import type { PatchRecord } from '../../utils/manifest/patches.mts'
import type { Spinner } from '@socketsecurity/lib/spinner'
import type { SocketSdk } from '@socketsecurity/sdk'

export type HandlePatchDownloadConfig = {
  cwd: string
  outputKind: OutputKind
  scanId?: string
  spinner: Spinner
  uuids: string[]
}

export type PatchDownloadResult = {
  downloaded: Array<{
    purl: string
    uuid: string
  }>
  failed: Array<{
    error: string
    uuid: string
  }>
}

type PatchViewResponse = {
  description?: string
  files: Record<
    string,
    {
      afterHash: string | null
      beforeHash: string | null
      socketBlob: string
    }
  >
  license?: string
  publishedAt: string
  purl: string
  tier: 'free' | 'paid'
  uuid: string
  vulnerabilities: Record<
    string,
    {
      cves: string[]
      description: string
      severity: string
      summary: string
    }
  >
}

type ArtifactPatches = {
  artifactId: string
  patches: Array<{
    description?: string
    license?: string
    publishedAt: string
    securityAlerts: Array<{
      cveId?: string
      description: string
      ghsaId: string
      severity: string
      summary: string
    }>
    tier: 'free' | 'paid'
    uuid: string
  }>
}

/**
 * Download patches from Socket API.
 */
export async function handlePatchDownload({
  cwd,
  outputKind,
  scanId,
  spinner,
  uuids,
}: HandlePatchDownloadConfig): Promise<void> {
  // Setup SDK.
  const sdkResult = await setupSdk()
  if (!sdkResult.ok) {
    spinner.failAndStop('Failed to initialize Socket SDK')
    await outputPatchDownloadResult(
      {
        ok: false,
        cause: sdkResult.cause,
        message: sdkResult.message,
      },
      { outputKind },
    )
    return
  }

  const sdk = sdkResult.data

  // Get organization slug.
  const orgSlug = await getOrgSlug(sdk)
  if (!orgSlug) {
    spinner.failAndStop('Failed to determine organization')

    // Check if SOCKET_CLI_API_TOKEN is set to provide helpful guidance.
    const hasEnvToken = !!ENV.SOCKET_CLI_API_TOKEN
    const errorMessage = hasEnvToken
      ? 'Could not determine organization from API token. Try running `socket login` or set SOCKET_CLI_ORG_SLUG environment variable.'
      : 'Could not determine organization from API token. Run `socket login` first.'

    await outputPatchDownloadResult(
      {
        ok: false,
        cause: errorMessage,
        message: 'Organization Error',
      },
      { outputKind },
    )
    return
  }

  // Collect UUIDs to download.
  let patchUuids = uuids

  if (scanId) {
    spinner.start('Fetching patches from scan...')
    const scanUuids = await collectPatchesFromScan(sdk, orgSlug, scanId)
    if (!scanUuids.length) {
      spinner.failAndStop('No patches found in scan')
      await outputPatchDownloadResult(
        {
          ok: false,
          cause: `Scan ${scanId} has no patches available`,
          message: 'No Patches Found',
        },
        { outputKind },
      )
      return
    }
    patchUuids = scanUuids
    spinner.successAndStop(
      `Found ${patchUuids.length} ${pluralize('patch', { count: patchUuids.length })} in scan`,
    )
  }

  if (!patchUuids.length) {
    spinner.failAndStop('No patches to download')
    await outputPatchDownloadResult(
      {
        ok: false,
        cause: 'Must provide patch UUIDs or --scan flag',
        message: 'No UUIDs Provided',
      },
      { outputKind },
    )
    return
  }

  // Download each patch.
  const results: PatchDownloadResult = {
    downloaded: [],
    failed: [],
  }

  for (const uuid of patchUuids) {
    try {
      spinner.start(`Downloading patch ${uuid}...`)
      // eslint-disable-next-line no-await-in-loop
      await downloadPatch(sdk, orgSlug, uuid, cwd)
      // eslint-disable-next-line no-await-in-loop
      const patchDetails = await sdk.viewPatch(orgSlug, uuid)
      results.downloaded.push({
        purl: patchDetails.purl,
        uuid,
      })
      spinner.successAndStop(`Downloaded patch ${uuid}`)
    } catch (e: any) {
      spinner.failAndStop(`Failed to download patch ${uuid}`)
      results.failed.push({
        error: e.message,
        uuid,
      })
      logger.error(`Failed to download patch ${uuid}: ${e.message}`)
    }
  }

  // Output results.
  await outputPatchDownloadResult(
    {
      ok: true,
      data: results,
    },
    { outputKind },
  )
}

/**
 * Get organization slug from SDK.
 */
async function getOrgSlug(sdk: SocketSdk): Promise<string | undefined> {
  // Check if SOCKET_CLI_ORG_SLUG is explicitly set in environment.
  if (ENV.SOCKET_CLI_ORG_SLUG) {
    return ENV.SOCKET_CLI_ORG_SLUG
  }

  // Check if defaultOrg is set in config (from socket login).
  const { getConfigValueOrUndef } = await import('../../utils/config.mts')
  const defaultOrg = getConfigValueOrUndef('defaultOrg')
  if (defaultOrg) {
    return defaultOrg
  }

  // Otherwise, try to fetch from API.
  try {
    const orgs = await sdk.getOrganizations()
    if (Array.isArray(orgs) && orgs.length > 0) {
      return orgs[0]?.slug
    }
    return undefined
  } catch (_e) {
    return undefined
  }
}

/**
 * Collect patch UUIDs from a scan.
 */
async function collectPatchesFromScan(
  sdk: SocketSdk,
  orgSlug: string,
  scanId: string,
): Promise<string[]> {
  const uuids: string[] = []

  try {
    const stream = await sdk.streamPatchesFromScan(orgSlug, scanId)
    const reader = stream.getReader()

    while (true) {
      // eslint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read()
      if (done) {
        break
      }

      const artifactPatches = value as ArtifactPatches
      for (const patch of artifactPatches.patches) {
        uuids.push(patch.uuid)
      }
    }
  } catch (e: any) {
    logger.error(`Failed to stream patches from scan: ${e.message}`)
  }

  return uuids
}

/**
 * Hash a file path to create a unique, filesystem-safe identifier.
 */
function hashFilePath(filePath: string): string {
  return crypto.createHash('sha256').update(filePath).digest('hex').slice(0, 16)
}

/**
 * Build cacache key for a patch blob.
 */
function buildBlobKey(uuid: string, filePath: string): string {
  return `socket:patch:blob:${uuid}:${hashFilePath(filePath)}`
}

/**
 * Download a single patch and save to cacache.
 */
async function downloadPatch(
  sdk: SocketSdk,
  orgSlug: string,
  uuid: string,
  cwd: string,
): Promise<void> {
  // Get patch details.
  const patchDetails: PatchViewResponse = (await (sdk as any).viewPatch(
    orgSlug,
    uuid,
  )) as PatchViewResponse

  // Download each file blob.
  for (const [filePath, fileInfo] of Object.entries(patchDetails.files)) {
    if (!fileInfo.socketBlob) {
      continue
    }

    // Download blob content.
    // eslint-disable-next-line no-await-in-loop
    const content = await (sdk as any).downloadPatch(fileInfo.socketBlob)

    // Compute integrity using ssri.
    const integrity = ssri.fromData(Buffer.from(content, 'utf-8'), {
      algorithms: ['sha256'],
    })
    const integrityString = integrity.toString()

    // Store in cacache with integrity verification.
    const cacheKey = buildBlobKey(uuid, filePath)
    // eslint-disable-next-line no-await-in-loop
    await cacache.put(cacheKey, content, {
      integrity: integrityString,
      metadata: {
        uuid,
        filePath,
        purl: patchDetails.purl,
        downloadedAt: new Date().toISOString(),
        afterHash: fileInfo.afterHash,
        beforeHash: fileInfo.beforeHash,
      },
    })
  }

  // Build patch record for manifest.
  const patchRecord: PatchRecord = {
    uuid: patchDetails.uuid,
    exportedAt: patchDetails.publishedAt,
    files: Object.fromEntries(
      Object.entries(patchDetails.files).map(([filePath, fileInfo]) => [
        filePath,
        {
          beforeHash: fileInfo.beforeHash || '',
          afterHash: fileInfo.afterHash || '',
        },
      ]),
    ),
    description: patchDetails.description,
    license: patchDetails.license,
    tier: patchDetails.tier,
    vulnerabilities: patchDetails.vulnerabilities
      ? Object.fromEntries(
          Object.entries(patchDetails.vulnerabilities).map(
            ([ghsaId, vuln]) => [
              ghsaId,
              {
                cves: vuln.cves,
                summary: vuln.summary,
                severity: vuln.severity,
                description: vuln.description,
              },
            ],
          ),
        )
      : undefined,
    status: 'downloaded',
    downloadedAt: new Date().toISOString(),
  }

  // Add to manifest.
  await addPatch(patchDetails.purl, patchRecord, cwd)
}
