/** @fileoverview Enhanced scan with project context awareness and rich progress. */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import { getProjectContext } from '../../utils/project-context.mts'
import { MultiProgress, Spinner } from '../../utils/rich-progress.mts'

interface EnhancedScanOptions {
  targetPath: string
  orgSlug: string
  outputKind?: 'json' | 'markdown' | 'text'
  showProgress?: boolean
  autoDetect?: boolean
}

export async function runEnhancedScan(options: EnhancedScanOptions): Promise<void> {
  const { targetPath, orgSlug, outputKind = 'text', showProgress = true, autoDetect = true } = options

  if (!autoDetect || outputKind === 'json') {
    // Skip enhancements for JSON output or when disabled
    return
  }

  // Detect project context
  const contextSpinner = new Spinner('Analyzing project structure...')
  if (showProgress) {
    contextSpinner.start()
  }

  const context = await getProjectContext(targetPath)

  if (!context) {
    contextSpinner.fail('Unable to detect project type')
    return
  }

  contextSpinner.succeed(
    `Detected ${colors.cyan(context.type)} project` +
    (context.framework ? ` using ${colors.cyan(context.framework)}` : '') +
    (context.isMonorepo ? ' ' + colors.yellow('(monorepo)') : '')
  )

  // Show contextual suggestions
  const suggestions = getContextualSuggestions(context)
  if (suggestions.length > 0) {
    logger.log('\n💡 Suggestions based on your project:')
    for (const suggestion of suggestions) {
      logger.log(`   • ${suggestion}`)
    }
    logger.log('')
  }

  // Warn about missing lock files
  if (!context.hasLockFile) {
    logger.warn('⚠️  No lock file found!')
    logger.warn(`   Run \`${getPackageManagerCommand(context.type, 'install')}\` to generate one for accurate scanning`)
    logger.log('')
  }

  // For monorepos, show workspace information
  if (context.isMonorepo) {
    const workspaces = await detectWorkspaces(targetPath, context.type)
    if (workspaces.length > 0) {
      logger.log(`📦 Detected ${workspaces.length} workspace(s):`)
      for (const ws of workspaces.slice(0, 5)) {
        logger.log(`   • ${ws}`)
      }
      if (workspaces.length > 5) {
        logger.log(`   ... and ${workspaces.length - 5} more`)
      }
      logger.log('\n   💡 Use --recursive to scan all workspaces')
      logger.log('')
    }
  }
}

function getContextualSuggestions(context: any): string[] {
  const suggestions: string[] = []

  // Framework-specific suggestions
  if (context.framework === 'next' || context.framework === 'react') {
    suggestions.push('Consider using --prod to exclude dev dependencies from production scans')
  }

  if (context.framework === 'express' || context.framework === 'fastify') {
    suggestions.push('Backend detected - ensure production dependencies are properly separated')
  }

  // Package manager specific
  if (context.type === 'pnpm' && context.isMonorepo) {
    suggestions.push(`Use \`socket pnpm --recursive\` to scan all workspaces`)
  }

  if (context.type === 'yarn' && context.isMonorepo) {
    suggestions.push(`Yarn workspaces detected - each workspace will be analyzed`)
  }

  return suggestions
}

function getPackageManagerCommand(pm: string, command: string): string {
  switch (pm) {
    case 'pnpm':
      return `pnpm ${command}`
    case 'yarn':
      return `yarn ${command}`
    case 'npm':
      return `npm ${command}`
    default:
      return `npm ${command}`
  }
}

async function detectWorkspaces(targetPath: string, packageManager: string): Promise<string[]> {
  const workspaces: string[] = []

  // Check package.json workspaces field
  const pkgPath = join(targetPath, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(await import(pkgPath, { with: { type: 'json' } }).then(m => JSON.stringify(m.default)))
      if (pkg.workspaces) {
        const wsConfig = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces.packages
        if (Array.isArray(wsConfig)) {
          // Simple glob expansion (would need proper glob library for full support)
          for (const pattern of wsConfig) {
            if (pattern.includes('*')) {
              // Simplified: just show the pattern
              workspaces.push(pattern)
            } else {
              workspaces.push(pattern)
            }
          }
        }
      }
    } catch {
      // Ignore errors
    }
  }

  // Check pnpm-workspace.yaml
  if (packageManager === 'pnpm') {
    const pnpmWsPath = join(targetPath, 'pnpm-workspace.yaml')
    if (existsSync(pnpmWsPath)) {
      // Would need to parse YAML properly
      workspaces.push('pnpm workspaces detected')
    }
  }

  return workspaces
}

export class ScanProgressTracker {
  private progress?: MultiProgress
  private tasks: Map<string, { total: number; current: number }> = new Map()

  constructor(private enabled: boolean = true) {
    if (enabled) {
      this.progress = new MultiProgress({ hideCursor: true })
    }
  }

  addPhase(id: string, name: string, total: number): void {
    if (!this.enabled || !this.progress) return

    this.tasks.set(id, { total, current: 0 })
    this.progress.addTask(id, name, total)
  }

  updatePhase(id: string, current: number, message?: string): void {
    if (!this.enabled || !this.progress) return

    const task = this.tasks.get(id)
    if (task) {
      task.current = current
      this.progress.updateTask(id, current, message ? { message } : undefined)
    }
  }

  completePhase(id: string): void {
    if (!this.enabled || !this.progress) return

    const task = this.tasks.get(id)
    if (task) {
      this.progress.updateTask(id, task.total)
    }
  }

  failPhase(id: string, error: string): void {
    if (!this.enabled || !this.progress) return

    this.progress.failTask(id, error)
  }

  finish(): void {
    if (this.progress) {
      this.progress.stop()
    }
  }
}

/**
 * Create a progress tracker for scanning multiple files
 */
export function createScanProgress(
  files: string[],
  phases: Array<{ id: string; name: string; weight?: number }>,
  enabled: boolean = true,
): ScanProgressTracker {
  const tracker = new ScanProgressTracker(enabled)

  if (!enabled) return tracker

  // Add phases with weighted progress
  const totalWeight = phases.reduce((sum, p) => sum + (p.weight || 1), 0)
  const fileCount = files.length

  for (const phase of phases) {
    const phaseTotal = Math.max(1, Math.floor((fileCount * (phase.weight || 1)) / totalWeight))
    tracker.addPhase(phase.id, phase.name, phaseTotal)
  }

  return tracker
}