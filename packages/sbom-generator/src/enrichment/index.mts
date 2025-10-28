/**
 * Socket.dev Enrichment
 *
 * Enrich SBOM components with Socket.dev security data.
 */

import type { Component, Sbom } from '../types/sbom.mts'

/**
 * Enrichment options.
 */
export interface EnrichOptions {
  /**
   * Socket.dev API token.
   */
  apiToken: string

  /**
   * Socket API base URL (defaults to production).
   */
  apiBaseUrl?: string

  /**
   * Timeout for API requests (milliseconds).
   */
  timeout?: number
}

/**
 * Enriched SBOM with Socket security data.
 */
export interface EnrichedSbom extends Sbom {
  components?: EnrichedComponent[]
}

/**
 * Component with Socket security data.
 */
export interface EnrichedComponent extends Component {
  socket?: SocketSecurityData
}

/**
 * Socket security data for a component.
 */
export interface SocketSecurityData {
  /**
   * Socket security score (0-100).
   */
  score: number

  /**
   * Security issues found.
   */
  issues: SocketIssue[]

  /**
   * Supply chain risk level.
   */
  supplyChainRisk: 'low' | 'medium' | 'high' | 'critical'

  /**
   * Package quality metrics.
   */
  quality?: {
    maintenance: number
    popularity: number
    quality: number
  }

  /**
   * License information.
   */
  licenseInfo?: {
    spdxId: string
    name: string
    isOsiApproved: boolean
  }

  /**
   * Package URL on Socket.dev.
   */
  socketUrl: string
}

/**
 * Socket security issue.
 */
export interface SocketIssue {
  /**
   * Issue type (CVE, malware, typosquat, etc.).
   */
  type: string

  /**
   * Issue severity.
   */
  severity: 'low' | 'medium' | 'high' | 'critical'

  /**
   * Issue title.
   */
  title: string

  /**
   * Issue description.
   */
  description: string

  /**
   * CVE ID (if applicable).
   */
  cve?: string

  /**
   * CVSS score (if applicable).
   */
  cvss?: number

  /**
   * Recommended fix.
   */
  fix?: string
}

/**
 * Enrich SBOM with Socket.dev security data.
 *
 * @param sbom - CycloneDX SBOM
 * @param options - Enrichment options
 * @returns Enriched SBOM
 */
export async function enrichSbomWithSocket(
  sbom: Sbom,
  options: EnrichOptions,
): Promise<EnrichedSbom> {
  if (!options.apiToken) {
    throw new Error('Socket.dev API token is required')
  }

  const enrichedComponents: EnrichedComponent[] = []

  // Enrich each component with Socket data.
  for (const component of sbom.components || []) {
    const enriched = await enrichComponent(component, options)
    enrichedComponents.push(enriched)
  }

  // Return enriched SBOM.
  return {
    ...sbom,
    components: enrichedComponents,
  }
}

/**
 * Enrich single component with Socket data.
 */
async function enrichComponent(
  component: Component,
  options: EnrichOptions,
): Promise<EnrichedComponent> {
  // Extract ecosystem and package info from PURL.
  const packageInfo = parsePurl(component.purl)
  if (!packageInfo) {
    return component
  }

  try {
    // Fetch Socket data for package.
    const socketData = await fetchSocketData(packageInfo, options)

    return {
      ...component,
      socket: socketData,
    }
  } catch (e) {
    // If Socket API fails, return component without enrichment.
    console.error(
      `Failed to enrich ${component.name}@${component.version}: ${e instanceof Error ? e.message : String(e)}`,
    )
    return component
  }
}

/**
 * Parse PURL into ecosystem and package info.
 */
function parsePurl(
  purl: string | undefined,
): { ecosystem: string; name: string; version: string } | null {
  if (!purl) {
    return null
  }

  // PURL format: pkg:ecosystem/name@version.
  const match = /^pkg:([^/]+)\/(.+?)@(.+)$/.exec(purl)
  if (!match) {
    return null
  }

  return {
    ecosystem: match[1]!,
    name: match[2]!,
    version: match[3]!,
  }
}

/**
 * Fetch Socket security data for package.
 */
async function fetchSocketData(
  packageInfo: { ecosystem: string; name: string; version: string },
  options: EnrichOptions,
): Promise<SocketSecurityData> {
  const baseUrl = options.apiBaseUrl || 'https://api.socket.dev'
  const timeout = options.timeout || 30_000

  // Build Socket API URL.
  const url = `${baseUrl}/v0/package/${packageInfo.ecosystem}/${encodeURIComponent(packageInfo.name)}/${encodeURIComponent(packageInfo.version)}`

  // Make API request.
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${options.apiToken}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`Socket API returned ${response.status}`)
    }

    const data = (await response.json()) as SocketApiResponse

    // Transform Socket API response to our format.
    return transformSocketResponse(data, packageInfo)
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Socket API response (simplified).
 */
interface SocketApiResponse {
  score?: number
  issues?: Array<{
    type: string
    severity: string
    title: string
    description: string
    cve?: string
    cvss?: number
    fix?: string
  }>
  supplyChainRisk?: string
  quality?: {
    maintenance: number
    popularity: number
    quality: number
  }
  license?: {
    spdxId: string
    name: string
    isOsiApproved: boolean
  }
}

/**
 * Transform Socket API response to security data format.
 */
function transformSocketResponse(
  response: SocketApiResponse,
  packageInfo: { ecosystem: string; name: string; version: string },
): SocketSecurityData {
  return {
    score: response.score || 0,
    issues:
      response.issues?.map(issue => ({
        type: issue.type,
        severity: issue.severity as 'low' | 'medium' | 'high' | 'critical',
        title: issue.title,
        description: issue.description,
        ...(issue.cve && { cve: issue.cve }),
        ...(issue.cvss !== undefined && { cvss: issue.cvss }),
        ...(issue.fix && { fix: issue.fix }),
      })) || [],
    supplyChainRisk:
      (response.supplyChainRisk as 'low' | 'medium' | 'high' | 'critical') ||
      'low',
    quality: response.quality,
    licenseInfo: response.license,
    socketUrl: `https://socket.dev/${packageInfo.ecosystem}/package/${encodeURIComponent(packageInfo.name)}`,
  }
}
