/**
 * CodeT5 Formatters
 *
 * Format SBOM and Socket Facts into optimized prompts for CodeT5 analysis.
 * Reduces 50,000+ tokens to ~300 while preserving critical information.
 */

import type { EnrichedComponent, EnrichedSbom } from '../enrichment/index.mts'

// Export Socket Facts formatter.
export {
  formatSocketFactsForCodeT5,
  estimateSocketFactsTokenCount,
  type SocketFactsFormatOptions,
} from './socket-facts.mts'

/**
 * Format options for CodeT5.
 */
export interface FormatOptions {
  /**
   * Analysis task type.
   */
  task?:
    | 'security-analysis'
    | 'vulnerability-detection'
    | 'dependency-audit'
    | 'license-compliance'

  /**
   * Include dependency graph visualization.
   */
  includeGraph?: boolean

  /**
   * Maximum number of components to include (prioritizes high-risk).
   */
  maxComponents?: number

  /**
   * Minimum severity to include (filters out low-severity issues).
   */
  minSeverity?: 'low' | 'medium' | 'high' | 'critical'
}

/**
 * Format enriched SBOM for CodeT5 analysis.
 *
 * Optimizes token usage while preserving critical security information.
 *
 * @param sbom - Enriched SBOM with Socket data
 * @param options - Formatting options
 * @returns Optimized prompt for CodeT5
 */
export function formatSbomForCodeT5(
  sbom: EnrichedSbom,
  options: FormatOptions = {}
): string {
  const task = options.task || 'security-analysis'
  const maxComponents = options.maxComponents || 50
  const minSeverity = options.minSeverity || 'low'

  const sections: string[] = []

  // Task definition.
  sections.push(buildTaskPrompt(task))

  // Project overview.
  sections.push(buildProjectOverview(sbom))

  // Critical issues (highest priority).
  const criticalIssues = extractCriticalIssues(sbom, minSeverity)
  if (criticalIssues.length > 0) {
    sections.push(buildCriticalIssuesSection(criticalIssues))
  }

  // Component summary (prioritize high-risk packages).
  const prioritizedComponents = prioritizeComponents(
    sbom.components || [],
    maxComponents
  )
  sections.push(buildComponentSummary(prioritizedComponents))

  // Dependency graph (if requested).
  if (options.includeGraph) {
    sections.push(buildDependencyGraph(sbom))
  }

  // Analysis instructions.
  sections.push(buildAnalysisInstructions(task))

  return sections.join('\n\n')
}

/**
 * Build task-specific prompt.
 */
function buildTaskPrompt(task: string): string {
  const TASK_PROMPTS: Record<string, string> = {
    __proto__: null,
    'security-analysis':
      'TASK: Perform comprehensive security analysis of this project.',
    'vulnerability-detection':
      'TASK: Identify all known vulnerabilities and assess risk.',
    'dependency-audit':
      'TASK: Audit dependencies for security and supply chain risks.',
    'license-compliance':
      'TASK: Analyze license compliance and identify potential issues.',
  } as Record<string, string>

  return TASK_PROMPTS[task] || TASK_PROMPTS['security-analysis']
}

/**
 * Build project overview section.
 */
function buildProjectOverview(sbom: EnrichedSbom): string {
  const component = sbom.metadata?.component
  const totalComponents = sbom.components?.length || 0

  return [
    'PROJECT OVERVIEW:',
    `Name: ${component?.name || 'unknown'}`,
    `Version: ${component?.version || '0.0.0'}`,
    `Total Dependencies: ${totalComponents}`,
    component?.description ? `Description: ${component.description}` : null,
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * Extract critical issues from all components.
 */
function extractCriticalIssues(
  sbom: EnrichedSbom,
  minSeverity: string
): Array<{
  component: string
  version: string
  issue: {
    type: string
    severity: string
    title: string
    cve?: string
    cvss?: number
  }
}> {
  const SEVERITY_RANK: Record<string, number> = {
    __proto__: null,
    low: 1,
    medium: 2,
    high: 3,
    critical: 4,
  } as Record<string, number>

  const minRank = SEVERITY_RANK[minSeverity] || 1
  const criticalIssues: Array<{
    component: string
    version: string
    issue: {
      type: string
      severity: string
      title: string
      cve?: string
      cvss?: number
    }
  }> = []

  for (const component of (sbom.components || []) as EnrichedComponent[]) {
    if (!component.socket?.issues) {
      continue
    }

    for (const issue of component.socket.issues) {
      const issueRank = SEVERITY_RANK[issue.severity] || 1
      if (issueRank >= minRank) {
        criticalIssues.push({
          component: component.name,
          version: component.version,
          issue: {
            type: issue.type,
            severity: issue.severity,
            title: issue.title,
            cve: issue.cve,
            cvss: issue.cvss,
          },
        })
      }
    }
  }

  // Sort by severity (critical first).
  criticalIssues.sort((a, b) => {
    const rankA = SEVERITY_RANK[a.issue.severity] || 0
    const rankB = SEVERITY_RANK[b.issue.severity] || 0
    return rankB - rankA
  })

  return criticalIssues
}

/**
 * Build critical issues section.
 */
function buildCriticalIssuesSection(
  issues: Array<{
    component: string
    version: string
    issue: {
      type: string
      severity: string
      title: string
      cve?: string
      cvss?: number
    }
  }>
): string {
  const lines = ['CRITICAL ISSUES:']

  for (const { component, version, issue } of issues.slice(0, 20)) {
    const cveInfo = issue.cve ? ` [${issue.cve}]` : ''
    const cvssInfo = issue.cvss ? ` CVSS ${issue.cvss}` : ''
    lines.push(
      `- ${issue.severity.toUpperCase()}: ${component}@${version}${cveInfo}${cvssInfo}`
    )
    lines.push(`  ${issue.title}`)
  }

  return lines.join('\n')
}

/**
 * Prioritize components by risk.
 */
function prioritizeComponents(
  components: EnrichedComponent[],
  maxComponents: number
): EnrichedComponent[] {
  // Calculate risk score for each component.
  const scored = components.map(component => {
    let riskScore = 0

    if (component.socket) {
      // Score based on Socket data.
      riskScore += (100 - component.socket.score) * 10
      riskScore += component.socket.issues.length * 5

      for (const issue of component.socket.issues) {
        if (issue.severity === 'critical') {
          riskScore += 50
        } else if (issue.severity === 'high') {
          riskScore += 30
        } else if (issue.severity === 'medium') {
          riskScore += 10
        }
      }

      if (component.socket.supplyChainRisk === 'critical') {
        riskScore += 40
      } else if (component.socket.supplyChainRisk === 'high') {
        riskScore += 20
      }
    }

    return { component, riskScore }
  })

  // Sort by risk (highest first).
  scored.sort((a, b) => b.riskScore - a.riskScore)

  // Return top N components.
  return scored.slice(0, maxComponents).map(s => s.component)
}

/**
 * Build component summary section.
 */
function buildComponentSummary(components: EnrichedComponent[]): string {
  const lines = ['COMPONENT SUMMARY:']

  for (const component of components.slice(0, 30)) {
    const socketInfo = component.socket
      ? ` [Score: ${component.socket.score}, Issues: ${component.socket.issues.length}]`
      : ''

    lines.push(`- ${component.name}@${component.version}${socketInfo}`)

    if (socketInfo && component.socket!.issues.length > 0) {
      const topIssue = component.socket!.issues[0]
      lines.push(`  ${topIssue.severity.toUpperCase()}: ${topIssue.title}`)
    }
  }

  return lines.join('\n')
}

/**
 * Build dependency graph section.
 */
function buildDependencyGraph(sbom: EnrichedSbom): string {
  const lines = ['DEPENDENCY GRAPH:']

  const rootComponent = sbom.metadata?.component
  if (rootComponent) {
    lines.push(`${rootComponent.name}@${rootComponent.version}`)

    // Find root dependencies.
    const rootDeps = sbom.dependencies?.find(
      dep => dep.ref === rootComponent['bom-ref']
    )

    if (rootDeps?.dependsOn) {
      for (const depRef of rootDeps.dependsOn.slice(0, 20)) {
        const depComponent = (sbom.components as EnrichedComponent[])?.find(
          c => c['bom-ref'] === depRef
        )
        if (depComponent) {
          const issueCount = depComponent.socket?.issues.length || 0
          const issueInfo = issueCount > 0 ? ` (${issueCount} issues)` : ''
          lines.push(`  - ${depComponent.name}@${depComponent.version}${issueInfo}`)
        }
      }
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
      '- Identify all critical and high-severity vulnerabilities',
      '- Assess supply chain risks',
      '- Recommend specific version updates',
      '- Prioritize fixes by impact and exploitability',
    ].join('\n'),
    'vulnerability-detection': [
      'ANALYSIS REQUIREMENTS:',
      '- List all CVEs with CVSS scores',
      '- Identify exploitable vulnerabilities',
      '- Provide patch availability status',
      '- Recommend mitigation strategies',
    ].join('\n'),
    'dependency-audit': [
      'ANALYSIS REQUIREMENTS:',
      '- Evaluate dependency health and maintenance',
      '- Identify outdated or abandoned packages',
      '- Assess security posture',
      '- Recommend modern alternatives',
    ].join('\n'),
    'license-compliance': [
      'ANALYSIS REQUIREMENTS:',
      '- List all licenses used',
      '- Identify license conflicts',
      '- Flag copyleft licenses',
      '- Recommend compliance actions',
    ].join('\n'),
  } as Record<string, string>

  return (
    INSTRUCTIONS[task] ||
    INSTRUCTIONS['security-analysis']
  )
}

/**
 * Calculate token count estimate for prompt.
 */
export function estimateTokenCount(prompt: string): number {
  // Rough estimate: 4 characters per token.
  return Math.ceil(prompt.length / 4)
}
