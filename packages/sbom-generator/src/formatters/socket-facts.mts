/**
 * Socket Facts CodeT5 Formatter
 *
 * Format Socket Facts (reachability analysis) into optimized prompts for CodeT5.
 * Dramatically improves signal-to-noise ratio by prioritizing reachable vulnerabilities.
 */

import type {
  CallStackEntry,
  Reachability,
  SocketFactArtifact,
  SocketFacts,
} from '../types/socket-facts.mts'
import type { EnrichedSbom } from '../enrichment/index.mts'

/**
 * Format options for Socket Facts CodeT5 output.
 */
export interface SocketFactsFormatOptions {
  /**
   * Analysis task type.
   */
  task?:
    | 'security-analysis'
    | 'vulnerability-detection'
    | 'dependency-audit'
    | 'license-compliance'

  /**
   * Prioritize reachable vulnerabilities (default: true).
   */
  prioritizeReachable?: boolean

  /**
   * Include call stacks for reachable vulnerabilities (default: true).
   */
  includeCallStacks?: boolean

  /**
   * Maximum call stack depth to include (default: 5).
   */
  maxCallStackDepth?: number

  /**
   * Minimum confidence score to include (0.0-1.0, default: 0.7).
   */
  minConfidence?: number

  /**
   * Include unreachable vulnerabilities in output (default: false).
   */
  includeUnreachable?: boolean

  /**
   * Maximum number of reachable vulnerabilities to include (default: 20).
   */
  maxReachableVulns?: number

  /**
   * Maximum number of unreachable vulnerabilities to include (default: 10).
   */
  maxUnreachableVulns?: number
}

/**
 * Enriched artifact with reachability context.
 */
interface EnrichedArtifact {
  artifact: SocketFactArtifact
  reachableVulns: Array<{
    vuln: Reachability
    metadata: SocketFactArtifact['vulnerabilities'][number]
  }>
  unreachableVulns: Array<{
    vuln: Reachability
    metadata: SocketFactArtifact['vulnerabilities'][number]
  }>
  riskScore: number
}

/**
 * Format Socket Facts for CodeT5 analysis.
 *
 * Optimizes token usage by focusing on reachable vulnerabilities while
 * providing rich context through call stacks and confidence scores.
 *
 * @param socketFacts - Socket Facts from reachability analysis
 * @param sbom - Optional SBOM for cross-reference
 * @param options - Formatting options
 * @returns Optimized prompt for CodeT5
 */
export function formatSocketFactsForCodeT5(
  socketFacts: SocketFacts,
  sbom?: EnrichedSbom,
  options: SocketFactsFormatOptions = {}
): string {
  const task = options.task || 'security-analysis'
  const prioritizeReachable = options.prioritizeReachable ?? true
  const includeCallStacks = options.includeCallStacks ?? true
  const maxCallStackDepth = options.maxCallStackDepth || 5
  const minConfidence = options.minConfidence || 0.7
  const includeUnreachable = options.includeUnreachable ?? false
  const maxReachableVulns = options.maxReachableVulns || 20
  const maxUnreachableVulns = options.maxUnreachableVulns || 10

  const sections: string[] = []

  // Task definition with reachability context.
  sections.push(buildTaskPrompt(task))

  // Project overview.
  sections.push(buildProjectOverview(socketFacts, sbom))

  // Enrich artifacts with reachability data.
  const enrichedArtifacts = enrichArtifactsWithReachability(
    socketFacts.components,
    minConfidence
  )

  // Prioritize by reachability and risk.
  const prioritized = prioritizeReachable
    ? prioritizeByReachability(enrichedArtifacts)
    : enrichedArtifacts

  // Critical issues (reachable vulnerabilities).
  const reachableIssues = extractReachableIssues(
    prioritized,
    maxReachableVulns
  )
  if (reachableIssues.length > 0) {
    sections.push(
      buildReachableIssuesSection(
        reachableIssues,
        includeCallStacks,
        maxCallStackDepth
      )
    )
  }

  // Unreachable vulnerabilities (if requested).
  if (includeUnreachable) {
    const unreachableIssues = extractUnreachableIssues(
      prioritized,
      maxUnreachableVulns
    )
    if (unreachableIssues.length > 0) {
      sections.push(buildUnreachableIssuesSection(unreachableIssues))
    }
  }

  // Component summary.
  sections.push(buildComponentSummary(prioritized.slice(0, 30)))

  // Dependency graph (if SBOM provided).
  if (sbom) {
    sections.push(buildDependencyGraph(prioritized, sbom))
  }

  // Analysis instructions.
  sections.push(buildAnalysisInstructions(task))

  return sections.join('\n\n')
}

/**
 * Build task-specific prompt with reachability awareness.
 */
function buildTaskPrompt(task: string): string {
  const TASK_PROMPTS: Record<string, string> = {
    __proto__: null,
    'security-analysis':
      'TASK: Perform reachability-aware security analysis of this project.\n\n' +
      'REACHABILITY CONTEXT:\n' +
      '- Vulnerabilities marked REACHABLE require immediate attention\n' +
      '- Vulnerabilities marked UNREACHABLE are low priority (dead code)\n' +
      '- Call stacks show the path from your code to vulnerable code\n' +
      '- Confidence scores indicate analysis certainty (0.0-1.0)',
    'vulnerability-detection':
      'TASK: Identify reachable vulnerabilities and assess exploitability.\n\n' +
      'REACHABILITY CONTEXT:\n' +
      '- Focus on REACHABLE vulnerabilities that can be exploited\n' +
      '- Use call stacks to understand attack surface\n' +
      '- Prioritize by confidence score and severity',
    'dependency-audit':
      'TASK: Audit dependencies with reachability analysis.\n\n' +
      'REACHABILITY CONTEXT:\n' +
      '- Identify which dependencies are actually used (not dead code)\n' +
      '- Focus on reachable security issues\n' +
      '- Recommend upgrades for actively used vulnerable packages',
    'license-compliance':
      'TASK: Analyze license compliance with usage context.\n\n' +
      'REACHABILITY CONTEXT:\n' +
      '- Focus on licenses of actively used dependencies\n' +
      '- Dead code dependencies have lower compliance risk',
  } as Record<string, string>

  return TASK_PROMPTS[task] || TASK_PROMPTS['security-analysis']
}

/**
 * Build project overview section.
 */
function buildProjectOverview(
  socketFacts: SocketFacts,
  sbom?: EnrichedSbom
): string {
  const totalComponents = socketFacts.components.length
  const reachableCount = socketFacts.components.filter(c =>
    c.reachability?.some(r => r.state === 'reachable')
  ).length

  const lines = ['PROJECT OVERVIEW:']

  if (sbom?.metadata?.component) {
    lines.push(`Name: ${sbom.metadata.component.name}`)
    lines.push(`Version: ${sbom.metadata.component.version}`)
  }

  lines.push(`Total Dependencies: ${totalComponents}`)
  lines.push(
    `Reachability Analysis: ${socketFacts.tier1ReachabilityScanId ? 'Complete' : 'Partial'}`
  )
  lines.push(`Components with Reachable Vulnerabilities: ${reachableCount}`)

  return lines.join('\n')
}

/**
 * Enrich artifacts with reachability categorization.
 */
function enrichArtifactsWithReachability(
  components: SocketFactArtifact[],
  minConfidence: number
): EnrichedArtifact[] {
  return components
    .map(artifact => {
      const reachableVulns: EnrichedArtifact['reachableVulns'] = []
      const unreachableVulns: EnrichedArtifact['unreachableVulns'] = []

      // Categorize vulnerabilities by reachability.
      for (const reachability of artifact.reachability || []) {
        if (
          reachability.confidence !== undefined &&
          reachability.confidence < minConfidence
        ) {
          continue
        }

        const metadata = artifact.vulnerabilities?.find(
          v => v.ghsaId === reachability.vulnerability
        )

        if (metadata) {
          if (reachability.state === 'reachable') {
            reachableVulns.push({ vuln: reachability, metadata })
          } else if (reachability.state === 'unreachable') {
            unreachableVulns.push({ vuln: reachability, metadata })
          }
        }
      }

      // Calculate risk score.
      let riskScore = 0

      if (reachableVulns.length > 0) {
        riskScore += reachableVulns.length * 100
        riskScore += reachableVulns.reduce(
          (sum, { vuln }) => sum + (vuln.confidence || 0) * 50,
          0
        )
      }

      if (artifact.direct) {
        riskScore += 20
      }

      if (artifact.dead) {
        riskScore -= 50
      }

      return {
        artifact,
        reachableVulns,
        unreachableVulns,
        riskScore,
      }
    })
    .filter(e => e.reachableVulns.length > 0 || e.unreachableVulns.length > 0)
}

/**
 * Prioritize artifacts by reachability and risk.
 */
function prioritizeByReachability(
  enriched: EnrichedArtifact[]
): EnrichedArtifact[] {
  return enriched.sort((a, b) => {
    // Reachable vulnerabilities first.
    if (a.reachableVulns.length !== b.reachableVulns.length) {
      return b.reachableVulns.length - a.reachableVulns.length
    }

    // Then by risk score.
    return b.riskScore - a.riskScore
  })
}

/**
 * Extract reachable issues for critical section.
 */
function extractReachableIssues(
  enriched: EnrichedArtifact[],
  maxCount: number
): Array<{
  artifact: SocketFactArtifact
  vuln: Reachability
  metadata: SocketFactArtifact['vulnerabilities'][number]
}> {
  const issues: Array<{
    artifact: SocketFactArtifact
    vuln: Reachability
    metadata: SocketFactArtifact['vulnerabilities'][number]
  }> = []

  for (const { artifact, reachableVulns } of enriched) {
    for (const { vuln, metadata } of reachableVulns) {
      issues.push({ artifact, vuln, metadata })
    }
  }

  // Sort by confidence (highest first).
  issues.sort((a, b) => (b.vuln.confidence || 0) - (a.vuln.confidence || 0))

  return issues.slice(0, maxCount)
}

/**
 * Extract unreachable issues.
 */
function extractUnreachableIssues(
  enriched: EnrichedArtifact[],
  maxCount: number
): Array<{
  artifact: SocketFactArtifact
  vuln: Reachability
  metadata: SocketFactArtifact['vulnerabilities'][number]
}> {
  const issues: Array<{
    artifact: SocketFactArtifact
    vuln: Reachability
    metadata: SocketFactArtifact['vulnerabilities'][number]
  }> = []

  for (const { artifact, unreachableVulns } of enriched) {
    for (const { vuln, metadata } of unreachableVulns) {
      issues.push({ artifact, vuln, metadata })
    }
  }

  return issues.slice(0, maxCount)
}

/**
 * Build reachable issues section.
 */
function buildReachableIssuesSection(
  issues: Array<{
    artifact: SocketFactArtifact
    vuln: Reachability
    metadata: SocketFactArtifact['vulnerabilities'][number]
  }>,
  includeCallStacks: boolean,
  maxCallStackDepth: number
): string {
  const lines = ['CRITICAL ISSUES (REACHABLE):']

  for (const { artifact, vuln, metadata } of issues) {
    const confidence = vuln.confidence?.toFixed(2) || '?'
    const ghsaId = metadata.ghsaId

    lines.push(
      `\n🔴 REACHABLE (confidence: ${confidence}): ${artifact.name}@${artifact.version} [${ghsaId}]`
    )

    if (metadata.reachabilityData?.publicComment) {
      lines.push(`   ${metadata.reachabilityData.publicComment}`)
    }

    if (includeCallStacks && vuln.callStack && vuln.callStack.length > 0) {
      lines.push(
        `   Call Stack (${Math.min(vuln.callStack.length, maxCallStackDepth)} hops):`
      )

      for (const [
        index,
        entry,
      ] of vuln.callStack
        .slice(0, maxCallStackDepth)
        .entries()) {
        const location = formatSourceLocation(entry)
        lines.push(`   ${index + 1}. ${location}`)
      }
    }

    lines.push(`   Recommendation: Upgrade to fix ${ghsaId}`)
  }

  return lines.join('\n')
}

/**
 * Build unreachable issues section.
 */
function buildUnreachableIssuesSection(
  issues: Array<{
    artifact: SocketFactArtifact
    vuln: Reachability
    metadata: SocketFactArtifact['vulnerabilities'][number]
  }>
): string {
  const lines = ['VULNERABILITIES (UNREACHABLE):']

  for (const { artifact, vuln, metadata } of issues) {
    const confidence = vuln.confidence?.toFixed(2) || '?'
    const ghsaId = metadata.ghsaId

    lines.push(
      `\n⚪ UNREACHABLE (confidence: ${confidence}): ${artifact.name}@${artifact.version} [${ghsaId}]`
    )

    if (vuln.reason) {
      lines.push(`   Status: ${vuln.reason}`)
    } else if (artifact.dead) {
      lines.push(`   Status: Dead code (never imported)`)
    } else if (artifact.dev) {
      lines.push(`   Status: Dev dependency (not in production)`)
    }
  }

  return lines.join('\n')
}

/**
 * Build component summary section.
 */
function buildComponentSummary(enriched: EnrichedArtifact[]): string {
  const lines = ['COMPONENT SUMMARY (PRIORITIZED BY REACHABILITY + RISK):']

  for (const [
    index,
    { artifact, reachableVulns, unreachableVulns },
  ] of enriched.entries()) {
    const reachableCount = reachableVulns.length
    const unreachableCount = unreachableVulns.length
    const statusBadge = reachableCount > 0 ? '🔴' : '⚪'

    let summary = `\n${index + 1}. ${artifact.name}@${artifact.version} ${statusBadge}`

    if (reachableCount > 0) {
      summary += ` [REACHABLE VULNS: ${reachableCount}]`
    } else if (unreachableCount > 0) {
      summary += ` [UNREACHABLE VULNS: ${unreachableCount}]`
    }

    if (artifact.dead) {
      summary += ' [DEAD CODE]'
    } else if (artifact.dev) {
      summary += ' [DEV]'
    } else if (artifact.direct) {
      summary += ' [DIRECT]'
    }

    lines.push(summary)

    // Show top reachable vulnerability.
    if (reachableCount > 0) {
      const topVuln = reachableVulns[0]
      const confidence = topVuln.vuln.confidence?.toFixed(2) || '?'
      lines.push(
        `   Confidence: ${confidence} - ${topVuln.metadata.reachabilityData?.publicComment || topVuln.metadata.ghsaId}`
      )
    }
  }

  return lines.join('\n')
}

/**
 * Build dependency graph section.
 */
function buildDependencyGraph(
  enriched: EnrichedArtifact[],
  sbom: EnrichedSbom
): string {
  const lines = ['DEPENDENCY GRAPH (REACHABILITY-AWARE):']

  const rootComponent = sbom.metadata?.component
  if (rootComponent) {
    lines.push(`\n${rootComponent.name}@${rootComponent.version}`)

    // Map artifacts by PURL for quick lookup.
    const artifactMap = new Map(
      enriched.map(e => [
        `pkg:${e.artifact.type}/${e.artifact.name}@${e.artifact.version}`,
        e,
      ])
    )

    // Show direct dependencies with reachability status.
    for (const e of enriched.filter(e => e.artifact.direct).slice(0, 10)) {
      const statusBadge = e.reachableVulns.length > 0 ? '🔴' : '⚪'
      const vulnCount =
        e.reachableVulns.length > 0
          ? ` [${e.reachableVulns.length} reachable vulns]`
          : ''

      lines.push(
        `  - ${e.artifact.name}@${e.artifact.version} ${statusBadge}${vulnCount}`
      )
    }
  }

  return lines.join('\n')
}

/**
 * Build analysis instructions.
 */
function buildAnalysisInstructions(task: string): string {
  const INSTRUCTIONS: Record<string, string> = {
    __proto__: null,
    'security-analysis': [
      'ANALYSIS REQUIREMENTS:',
      '- PRIORITIZE reachable vulnerabilities over unreachable ones',
      '- FOCUS on high-confidence reachability results (>0.8)',
      '- CONSIDER call stack depth: shorter = more direct threat',
      '- RECOMMEND version upgrades for reachable vulnerabilities',
      '- DEPRIORITIZE unreachable vulnerabilities (can defer fixes)',
      '- EXPLAIN reachability context in your analysis',
    ].join('\n'),
    'vulnerability-detection': [
      'ANALYSIS REQUIREMENTS:',
      '- List all REACHABLE CVEs with confidence scores',
      '- Identify exploitable vulnerabilities using call stacks',
      '- Provide patch availability for reachable issues',
      '- Recommend mitigation strategies prioritized by reachability',
    ].join('\n'),
    'dependency-audit': [
      'ANALYSIS REQUIREMENTS:',
      '- Evaluate health of ACTIVELY USED dependencies',
      '- Identify reachable vulnerabilities in production code',
      '- Assess security posture of direct dependencies',
      '- Recommend upgrades for packages with reachable issues',
    ].join('\n'),
    'license-compliance': [
      'ANALYSIS REQUIREMENTS:',
      '- List licenses of ACTIVELY USED dependencies',
      '- Deprioritize licenses of dead code dependencies',
      '- Flag copyleft licenses in production code',
      '- Recommend compliance actions for active dependencies',
    ].join('\n'),
  } as Record<string, string>

  return INSTRUCTIONS[task] || INSTRUCTIONS['security-analysis']
}

/**
 * Format source location for display.
 */
function formatSourceLocation(entry: CallStackEntry): string {
  const loc = entry.sourceLocation
  const file = loc.file.replace(/^node_modules\//, '')
  const line = loc.start.line
  const col = loc.start.column

  return `${file}:${line}:${col}`
}

/**
 * Calculate token count estimate for prompt.
 */
export function estimateSocketFactsTokenCount(prompt: string): number {
  // Rough estimate: 4 characters per token.
  return Math.ceil(prompt.length / 4)
}
