import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { pluralize } from '@socketsecurity/lib/words'

import { handlePatchDownload } from './handle-patch-download.mts'
import { outputPatchDiscoverResult } from './output-patch-discover-result.mts'
import ENV from '../../constants/env.mts'
import { getErrorCause } from '../../utils/error/errors.mjs'
import { getPackageFilesForScan } from '../../utils/fs/path-resolve.mjs'
import { setupSdk } from '../../utils/socket/sdk.mts'
import { fetchCreateOrgFullScan } from '../scan/fetch-create-org-full-scan.mts'
import { fetchSupportedScanFileNames } from '../scan/fetch-supported-scan-file-names.mts'

import type { OutputKind } from '../../types.mts'
import type { Spinner } from '@socketsecurity/lib/spinner'
import type { SocketSdk } from '@socketsecurity/sdk'
const logger = getDefaultLogger()


export type PatchVulnerability = {
  cve?: string
  severity?: string
}

export interface DiscoveredPatch {
  description: string | undefined
  freeCves: PatchVulnerability[]
  freeFeatures: string[]
  license: string | undefined
  paidCves: PatchVulnerability[]
  paidFeatures: string[]
  purl: string
  tier: string | undefined
  uuid: string | undefined
}

export interface HandlePatchDiscoverConfig {
  cwd: string
  interactive?: boolean
  outputKind: OutputKind
  scanId?: string
  spinner: Spinner | undefined
}

type CveRecord = {
  cveId: string | null
  ghsaId: string | null
  severity: string
  summary: string
}

type PurlObject = {
  artifactId?: string
  name: string
  namespace?: string
  subpath?: string
  type: string
  version?: string
}

type PatchData = {
  description: string
  freeCves: CveRecord[]
  freeFeatures: string[]
  license: string
  paidCves: CveRecord[]
  paidFeatures: string[]
  publishedAt: string
  tier: 'free' | 'enterprise'
  uuid: string
}

type ArtifactPatchRecord = {
  artifactId: string
  patch: PatchData | null
  purl: PurlObject
  purlString: string
}

export async function handlePatchDiscover({
  cwd,
  interactive = false,
  outputKind,
  scanId,
  spinner,
}: HandlePatchDiscoverConfig): Promise<void> {
  try {
    // Setup SDK.
    spinner?.start('Initializing Socket SDK...')
    const sdkResult = await setupSdk()
    if (!sdkResult.ok) {
      spinner?.failAndStop('Failed to initialize Socket SDK')
      await outputPatchDiscoverResult(sdkResult, outputKind)
      return
    }

    const sdk = sdkResult.data

    // Get organization slug.
    spinner?.text('Fetching organization information...')
    const orgSlug = await getOrgSlug(sdk)
    if (!orgSlug) {
      spinner?.failAndStop('Could not determine organization')

      // Check if SOCKET_CLI_API_TOKEN is set to provide helpful guidance.
      const hasEnvToken = !!ENV.SOCKET_CLI_API_TOKEN
      const errorMessage = hasEnvToken
        ? 'Could not determine organization from API token. Try running `socket login` or set SOCKET_CLI_ORG_SLUG environment variable.'
        : 'Could not determine organization from API token. Run `socket login` first.'

      await outputPatchDiscoverResult(
        {
          ok: false,
          cause: errorMessage,
          message: 'Organization Error',
        },
        outputKind,
      )
      return
    }

    let activeScanId = scanId

    // Create scan if no scan ID provided.
    if (!scanId) {
      spinner?.text('Preparing to scan dependencies...')

      // Get supported files for scanning.
      const supportedFilesResult = await fetchSupportedScanFileNames({
        spinner: spinner ?? undefined,
      })
      if (!supportedFilesResult.ok) {
        spinner?.failAndStop('Failed to fetch supported file types')
        await outputPatchDiscoverResult(supportedFilesResult, outputKind)
        return
      }

      spinner?.text('Searching for package files...')

      // Get package files for scanning.
      const packagePaths = await getPackageFilesForScan(
        ['.'],
        supportedFilesResult.data,
        { cwd },
      )

      if (packagePaths.length === 0) {
        spinner?.successAndStop('No package files found to scan')
        logger.log('No package files found to scan')
        await outputPatchDiscoverResult(
          {
            ok: true,
            data: { patches: [] },
          },
          outputKind,
        )
        return
      }

      spinner?.text(
        `Creating scan with ${packagePaths.length} package ${pluralize('file', { count: packagePaths.length })}...`,
      )

      logger.log(
        `[DEBUG] Package files to scan: ${packagePaths.join(', ')}`,
      )

      // Create scan (silent by default, background operation).
      const scanResult = await fetchCreateOrgFullScan(
        packagePaths,
        orgSlug,
        {
          branchName: '',
          commitHash: '',
          commitMessage: '',
          committers: '',
          pullRequest: 0,
          repoName: 'patch-discover',
        },
        {
          cwd,
          tmp: true,
        },
      )

      if (!scanResult.ok) {
        spinner?.failAndStop('Failed to create scan')
        await outputPatchDiscoverResult(scanResult, outputKind)
        return
      }

      activeScanId = scanResult.data?.id

      logger.log(`[DEBUG] Scan created with ID: ${activeScanId}`)

      if (!activeScanId) {
        spinner?.failAndStop('Scan creation did not return scan ID')
        await outputPatchDiscoverResult(
          {
            ok: false,
            cause: 'Scan creation did not return scan ID',
            message: 'Scan Error',
          },
          outputKind,
        )
        return
      }

      spinner?.successAndStop('Scan created successfully')
    }

    // Validate scan ID before streaming.
    if (!activeScanId) {
      spinner?.failAndStop('No scan ID available')
      await outputPatchDiscoverResult(
        {
          ok: false,
          cause: 'No scan ID available',
          message: 'Scan Error',
        },
        outputKind,
      )
      return
    }

    // Stream patches from scan.
    spinner?.start('Discovering available patches...')
    const patches = await streamPatchesFromScan(sdk, orgSlug, activeScanId)

    if (patches.length === 0) {
      spinner?.successAndStop('No patches available for scanned dependencies')
      await outputPatchDiscoverResult(
        {
          ok: true,
          data: { patches: [] },
        },
        outputKind,
      )
      return
    }

    // Fetch scan data to enrich patches with package names.
    spinner?.start('Fetching package details...')
    const enrichedPatches = await enrichPatchesWithPackageNames(
      sdk,
      orgSlug,
      activeScanId,
      patches,
    )

    spinner?.successAndStop(
      `Found ${enrichedPatches.length} available ${pluralize('patch', { count: enrichedPatches.length })}`,
    )

    // If interactive mode, show patch selector UI.
    if (interactive) {
      if (enrichedPatches.length === 0) {
        logger.log('No patches available to select')
        await outputPatchDiscoverResult(
          {
            ok: true,
            data: { patches: enrichedPatches },
          },
          outputKind,
        )
        return
      }

      // Show interactive patch selector.
      const selectedPatches = await showPatchSelector(enrichedPatches)

      if (selectedPatches.length === 0) {
        logger.log('No patches selected')
        return
      }

      logger.log('')
      logger.log(
        `Downloading ${selectedPatches.length} ${pluralize('patch', { count: selectedPatches.length })}...`,
      )

      const scanIds = selectedPatches
        .map(p => p.uuid)
        .filter((uuid): uuid is string => !!uuid)

      // Call download handler.
      if (spinner) {
        await handlePatchDownload({
          cwd,
          outputKind,
          ...(scanId ? { scanId } : {}),
          spinner,
          uuids: scanIds,
        })
      } else {
        logger.error('Spinner is required for patch download')
      }
    } else {
      await outputPatchDiscoverResult(
        {
          ok: true,
          data: { patches: enrichedPatches },
        },
        outputKind,
      )
    }
  } catch (e) {
    spinner?.stop()

    const message = 'Failed to discover patches'
    const cause = getErrorCause(e)

    await outputPatchDiscoverResult(
      {
        ok: false,
        code: 1,
        message,
        cause,
      },
      outputKind,
    )
  }
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
    const orgs = await sdk.listOrganizations()
    if (Array.isArray(orgs) && orgs.length > 0) {
      return orgs[0]?.slug
    }
    return undefined
  } catch (_e) {
    return undefined
  }
}

/**
 * Shimmering text component with purple gradient effect.
 */
function ShimmerText({
  Text,
  children,
  createElement,
  useEffect,
  useState,
}: {
  children: string
  createElement: any
  Text: any
  useEffect: any
  useState: any
}): any {
  const [frame, setFrame] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setFrame((f: number) => (f + 1) % 20)
    }, 100)
    return () => clearInterval(interval)
  }, [])

  const colors = ['#8B5CF6', '#A78BFA', '#C4B5FD', '#DDD6FE']
  const colorIndex = Math.floor(frame / 5) % colors.length

  return createElement(
    Text,
    { bold: true, color: colors[colorIndex] },
    children,
  )
}

/**
 * Patch selector app component with multi-select checkboxes.
 */
function createPatchSelectorApp({
  Box,
  Text,
  createElement,
  useApp,
  useEffect,
  useInput,
  useState,
}: any) {
  return function PatchSelectorApp({
    onSelect,
    patches,
  }: {
    onSelect: (selectedPatches: DiscoveredPatch[]) => void
    patches: DiscoveredPatch[]
  }): any {
    const { exit } = useApp()
    const [selectedIndex, setSelectedIndex] = useState(0)
    const [selectedPatches, setSelectedPatches] = useState(new Set<number>())

    useInput((input: string, key: any) => {
      if (input === 'q' || key.escape) {
        exit()
        onSelect([])
      } else if (key.ctrl && input === 'c') {
        exit()
        // eslint-disable-next-line n/no-process-exit
        process.exit(0)
      } else if (key.upArrow || input === 'k') {
        setSelectedIndex((prev: number) => Math.max(0, prev - 1))
      } else if (key.downArrow || input === 'j') {
        setSelectedIndex((prev: number) =>
          Math.min(patches.length - 1, prev + 1),
        )
      } else if (input === ' ') {
        // Toggle selection.
        setSelectedPatches((prev: Set<number>) => {
          const next = new Set(prev)
          if (next.has(selectedIndex)) {
            next.delete(selectedIndex)
          } else {
            next.add(selectedIndex)
          }
          return next
        })
      } else if (input === 'a') {
        // Select all.
        setSelectedPatches(new Set(patches.map((_: any, i: number) => i)))
      } else if (input === 'n') {
        // Select none.
        setSelectedPatches(new Set())
      } else if (key.return) {
        // Apply selected patches.
        const selected = patches.filter((_: any, i: number) =>
          selectedPatches.has(i),
        )
        exit()
        onSelect(selected)
      }
    })

    return createElement(
      Box,
      { flexDirection: 'column', paddingX: 2, paddingY: 1 },
      // Header.
      createElement(
        Box,
        {
          borderColor: 'magenta',
          borderStyle: 'double',
          marginBottom: 1,
          paddingX: 2,
          paddingY: 1,
        },
        createElement(
          Box,
          { flexDirection: 'column', width: '100%' },
          createElement(
            Box,
            { justifyContent: 'center', marginBottom: 1 },
            createElement(
              ShimmerText,
              { createElement, Text, useEffect, useState },
              '🛡️  Socket Security Patches',
            ),
          ),
          createElement(
            Box,
            { justifyContent: 'center' },
            createElement(
              Text,
              { dimColor: true },
              'Select patches to apply to your project',
            ),
          ),
        ),
      ),
      // Patch List.
      createElement(
        Box,
        {
          borderColor: 'cyan',
          borderStyle: 'single',
          flexDirection: 'column',
          marginBottom: 1,
          paddingX: 1,
        },
        patches.map((patch: DiscoveredPatch, index: number) => {
          const isSelected = selectedPatches.has(index)
          const isCursor = index === selectedIndex
          const checkbox = isSelected ? '[✓]' : '[ ]'
          const cursor = isCursor ? '▶ ' : '  '

          const vulnCount = patch.freeCves.length + patch.paidCves.length
          const vulnText =
            vulnCount > 0
              ? ` (${vulnCount} vuln${vulnCount > 1 ? 's' : ''})`
              : ''

          return createElement(
            Box,
            { key: index },
            createElement(
              Text,
              {
                backgroundColor: isCursor ? 'gray' : undefined,
                bold: isCursor,
                color: isCursor ? 'magenta' : undefined,
              },
              cursor,
              createElement(
                Text,
                { color: isSelected ? 'green' : 'white' },
                checkbox,
              ),
              ' ',
              createElement(
                Text,
                { color: 'cyan' },
                patch.purl || 'Unknown package',
              ),
              createElement(Text, { color: 'yellow' }, vulnText),
            ),
          )
        }),
      ),
      // Summary.
      createElement(
        Box,
        {
          borderColor: 'yellow',
          borderStyle: 'single',
          marginBottom: 1,
          paddingX: 2,
        },
        createElement(
          Text,
          { color: 'yellow' },
          `Selected: ${selectedPatches.size} / ${patches.length} patches`,
        ),
      ),
      // Controls.
      createElement(
        Box,
        {
          backgroundColor: 'black',
          borderColor: 'magenta',
          borderStyle: 'single',
          paddingX: 2,
        },
        createElement(
          Box,
          { flexDirection: 'column', width: '100%' },
          createElement(
            Text,
            { color: 'magenta' },
            createElement(Text, { bold: true }, 'Space:'),
            ' Toggle  ',
            createElement(Text, { bold: true }, 'a:'),
            ' All  ',
            createElement(Text, { bold: true }, 'n:'),
            ' None',
          ),
          createElement(
            Text,
            { color: 'magenta' },
            createElement(Text, { bold: true }, '↑/↓:'),
            ' Navigate  ',
            createElement(Text, { bold: true }, 'Enter:'),
            ' Apply  ',
            createElement(Text, { bold: true }, 'q/ESC:'),
            ' Cancel',
          ),
        ),
      ),
    )
  }
}

/**
 * Show interactive patch selector UI.
 */
async function showPatchSelector(
  patches: DiscoveredPatch[],
): Promise<DiscoveredPatch[]> {
  const React = await import('react')
  const { Box, Text, render, useApp, useInput } = await import('ink')

  const PatchSelectorApp = createPatchSelectorApp({
    Box,
    Text,
    createElement: React.createElement,
    useApp,
    useEffect: React.useEffect,
    useInput,
    useState: React.useState,
  })

  return new Promise(resolve => {
    try {
      const app = render(
        React.createElement(PatchSelectorApp, {
          onSelect: (selectedPatches: DiscoveredPatch[]) => {
            app.unmount()
            resolve(selectedPatches)
          },
          patches,
        }),
      )
    } catch (err) {
      logger.error('[DEBUG] Error rendering PatchSelectorApp:', err)
      logger.error('[DEBUG] Error stack:', (err as Error).stack)
      throw err
    }
  })
}

/**
 * Enrich patches with package names by fetching scan artifact data.
 */
async function enrichPatchesWithPackageNames(
  sdk: SocketSdk,
  orgSlug: string,
  scanId: string,
  patches: DiscoveredPatch[],
): Promise<DiscoveredPatch[]> {
  try {
    // Fetch full scan data to get artifact details.
    const scanResult = await sdk.getFullScan(orgSlug, scanId)

    if (!scanResult.success || !scanResult.data) {
      logger.error(
        '[DEBUG] Failed to fetch scan data for enrichment',
      )
      return patches
    }

    // Build artifact ID to package info map.
    const artifactMap = new Map<string, { name: string; purl: string }>()

    // The scan data contains artifacts array with id and package info.
    const artifacts = (scanResult.data as any).artifacts || []

    for (const artifact of artifacts) {
      if (artifact.id && (artifact.name || artifact.purl)) {
        artifactMap.set(artifact.id, {
          name: artifact.name || artifact.purl || 'unknown',
          purl:
            artifact.purl ||
            `pkg:${artifact.type}/${artifact.name}@${artifact.version}`,
        })
      }
    }

    logger.log(
      `[DEBUG] Built artifact map with ${artifactMap.size} entries`,
    )

    // Enrich patches with package names.
    return patches.map(patch => {
      const artifactInfo = artifactMap.get(patch.purl)
      if (artifactInfo) {
        logger.log(
          `[DEBUG] Enriching patch: ${patch.purl} -> ${artifactInfo.purl}`,
        )
        return {
          ...patch,
          purl: artifactInfo.purl,
        }
      }
      return patch
    })
  } catch (e: any) {
    logger.error(`[DEBUG] Failed to enrich patches: ${e.message}`)
    return patches
  }
}

/**
 * Stream patches from a scan and collect all results.
 */
async function streamPatchesFromScan(
  sdk: SocketSdk,
  orgSlug: string,
  scanId: string,
): Promise<DiscoveredPatch[]> {
  const discoveredPatches: DiscoveredPatch[] = []

  try {
    const stream = await sdk.streamPatchesFromScan(orgSlug, scanId)
    const reader = stream.getReader()

    let chunkCount = 0

    while (true) {
      // eslint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read()
      if (done) {
        break
      }

      chunkCount++
      const record = value as unknown as ArtifactPatchRecord

      logger.log(
        `[DEBUG] Received chunk ${chunkCount}: artifactId=${record.artifactId}, purl=${record.purlString}, patch=${record.patch ? 'available' : 'null'}`,
      )

      // Skip records with no patch.
      if (!record.patch) {
        continue
      }

      const patch = record.patch

      // Convert freeCves to vulnerabilities.
      const freeCves: PatchVulnerability[] = patch.freeCves.map(cve => {
        const vuln = { __proto__: null } as PatchVulnerability
        if (cve.cveId) {
          vuln.cve = cve.cveId
        }
        if (cve.severity) {
          vuln.severity = cve.severity
        }
        return vuln
      })

      // Convert paidCves to vulnerabilities.
      const paidCves: PatchVulnerability[] = patch.paidCves.map(cve => {
        const vuln = { __proto__: null } as PatchVulnerability
        if (cve.cveId) {
          vuln.cve = cve.cveId
        }
        if (cve.severity) {
          vuln.severity = cve.severity
        }
        return vuln
      })

      discoveredPatches.push({
        description: patch.description,
        freeCves,
        freeFeatures: patch.freeFeatures,
        license: patch.license,
        paidCves,
        paidFeatures: patch.paidFeatures,
        purl: record.purlString,
        tier: patch.tier,
        uuid: patch.uuid,
      })
    }

    logger.log(
      `[DEBUG] Stream complete: received ${chunkCount} chunks, collected ${discoveredPatches.length} patches`,
    )
  } catch (e: any) {
    logger.error(`Failed to stream patches from scan: ${e.message}`)
  }

  return discoveredPatches
}
