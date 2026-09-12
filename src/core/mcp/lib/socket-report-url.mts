/**
 * Build the socket.dev report URL for an artifact so a low score comes with a
 * click-through for the deeper analysis.
 *
 * Namespace handling is per-ecosystem: npm renders a scope as `@scope/name`,
 * the flat registries carry no namespace at all, and everything else joins on
 * a slash.
 */

import type { ArtifactData } from './artifacts.mts'

const SOCKET_REPORT_BASE_URL = 'https://socket.dev'

// Registries whose package identity is a single flat name; a namespace on one
// of these is not part of the public report path.
const FLAT_NAMESPACE_ECOSYSTEMS = new Set(['cargo', 'gem', 'nuget', 'pypi'])

export function buildSocketReportUrl(artifact: ArtifactData): string {
  const ecosystem = (artifact.type || 'npm').toLowerCase()
  const name = artifact.name || 'unknown'
  const namespace = artifact.namespace || undefined

  let packagePath: string
  if (ecosystem === 'npm') {
    packagePath = namespace ? `@${namespace}/${name}` : name
  } else if (FLAT_NAMESPACE_ECOSYSTEMS.has(ecosystem)) {
    packagePath = name
  } else {
    packagePath = namespace ? `${namespace}/${name}` : name
  }

  return `${SOCKET_REPORT_BASE_URL}/${ecosystem}/package/${packagePath}`
}
