/**
 * Lockfile Analyzer - Multi-ecosystem lockfile parser with security enrichment.
 *
 * @module @socketsecurity/lockfile-analyzer
 */

import { parseLockfile as parseFile } from './parsers/index.mjs'
import { enrichWithSocket } from './enrichment/socket-enricher.mjs'
import { formatForCodeT5 } from './formatters/codet5-formatter.mjs'

/**
 * Parse a lockfile into canonical dependency graph format.
 *
 * @param {string} lockfilePath - Path to lockfile
 * @param {object} options - Parse options
 * @param {string} options.type - Lockfile type (auto-detected if not provided)
 * @param {boolean} options.includeDevDependencies - Include dev dependencies
 * @returns {Promise<DependencyGraph>}
 */
export async function parseLockfile(lockfilePath, options = {}) {
  return parseFile(lockfilePath, options)
}

/**
 * Analyze a lockfile with full pipeline: parse, enrich, format, analyze.
 *
 * @param {string} lockfilePath - Path to lockfile
 * @param {object} options - Analysis options
 * @param {string} options.socketApiToken - Socket.dev API token
 * @param {object} options.codeT5Model - CodeT5 model instance (optional)
 * @param {string} options.task - Analysis task type
 * @returns {Promise<AnalysisResult>}
 */
export async function analyzeLockfile(lockfilePath, options = {}) {
  const {
    codeT5Model,
    socketApiToken,
    task = 'security-analysis',
  } = options

  // Step 1: Parse lockfile into canonical format.
  const deps = await parseLockfile(lockfilePath)

  // Step 2: Enrich with Socket.dev security data.
  const enriched = socketApiToken
    ? await enrichWithSocket(deps, { apiToken: socketApiToken })
    : deps

  // Step 3: Format for CodeT5 input.
  const prompt = formatForCodeT5(enriched, { task })

  // Step 4: Run CodeT5 analysis (if model provided).
  let analysis = null
  if (codeT5Model) {
    analysis = await codeT5Model.generate(prompt)
  }

  // Step 5: Extract structured insights.
  const insights = extractInsights(enriched)

  return {
    dependencies: enriched.dependencies,
    metadata: enriched.metadata,
    prompt,
    analysis,
    insights,
  }
}

/**
 * Extract structured insights from enriched dependency graph.
 *
 * @param {DependencyGraph} graph - Enriched dependency graph
 * @returns {object} Structured insights
 */
function extractInsights(graph) {
  const critical = []
  const warnings = []
  const recommendations = []

  for (const dep of graph.dependencies) {
    if (!dep.security) {
      continue
    }

    // Critical issues.
    if (dep.security.issues?.length > 0) {
      for (const issue of dep.security.issues) {
        if (issue.severity === 'critical' || issue.severity === 'high') {
          critical.push(`${dep.name}@${dep.version} - ${issue.title} (${issue.cve || 'No CVE'})`)
        }
      }
    }

    // Warnings.
    if (dep.security.score < 50) {
      warnings.push(`${dep.name}@${dep.version} has low security score (${dep.security.score}/100)`)
    }

    if (dep.security.maintenance === 'low') {
      warnings.push(`${dep.name}@${dep.version} is unmaintained`)
    }

    // Recommendations.
    if (dep.security.issues?.length > 0) {
      recommendations.push(`Update ${dep.name} to latest secure version`)
    }
  }

  return {
    critical: critical.length > 0 ? critical : null,
    criticalCount: critical.length,
    recommendations: recommendations.length > 0 ? recommendations : null,
    summary: `Found ${critical.length} critical issues, ${warnings.length} warnings`,
    warnings: warnings.length > 0 ? warnings : null,
    warningsCount: warnings.length,
  }
}

/**
 * Compare two lockfiles to detect changes.
 *
 * @param {string} oldLockfile - Path to old lockfile
 * @param {string} newLockfile - Path to new lockfile
 * @returns {Promise<LockfileDiff>}
 */
export async function diffLockfiles(oldLockfile, newLockfile) {
  const oldDeps = await parseLockfile(oldLockfile)
  const newDeps = await parseLockfile(newLockfile)

  const added = []
  const removed = []
  const updated = []

  const oldMap = new Map(
    oldDeps.dependencies.map((d) => [d.name, d.version])
  )
  const newMap = new Map(
    newDeps.dependencies.map((d) => [d.name, d.version])
  )

  // Find added and updated.
  for (const [name, version] of newMap) {
    if (!oldMap.has(name)) {
      added.push({ name, version })
    } else if (oldMap.get(name) !== version) {
      updated.push({
        name,
        oldVersion: oldMap.get(name),
        newVersion: version,
      })
    }
  }

  // Find removed.
  for (const [name, version] of oldMap) {
    if (!newMap.has(name)) {
      removed.push({ name, version })
    }
  }

  return {
    added,
    addedCount: added.length,
    removed,
    removedCount: removed.length,
    summary: `+${added.length} added, -${removed.length} removed, ~${updated.length} updated`,
    updated,
    updatedCount: updated.length,
  }
}

export { enrichWithSocket } from './enrichment/socket-enricher.mjs'
export { formatForCodeT5 } from './formatters/codet5-formatter.mjs'
export { detectLockfileType } from './parsers/detector.mjs'
