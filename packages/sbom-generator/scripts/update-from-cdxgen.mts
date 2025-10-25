#!/usr/bin/env node
/**
 * Automation script to track cdxgen updates and generate migration tasks.
 *
 * This script:
 * 1. Fetches the latest cdxgen release from GitHub
 * 2. Compares with our current baseline (v11.11.0)
 * 3. Downloads and analyzes changes
 * 4. Generates migration report and tasks
 * 5. Updates LOCK-STEP-COMPLIANCE.md
 *
 * Usage:
 *   pnpm run update-from-cdxgen
 *   pnpm run update-from-cdxgen --check-only (no downloads)
 *   pnpm run update-from-cdxgen --target-version 11.12.0
 */

import { promises as fs } from 'node:fs'
import { createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, readdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { extract } from 'tar'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Current baseline version.
const CURRENT_BASELINE = '11.11.0'

// GitHub repository for cdxgen.
const CDXGEN_REPO = 'CycloneDX/cdxgen'

// Paths.
const PACKAGE_ROOT = path.resolve(__dirname, '..')
const LOCK_STEP_COMPLIANCE_PATH = path.join(PACKAGE_ROOT, 'LOCK-STEP-COMPLIANCE.md')
const MIGRATION_REPORT_DIR = path.resolve(PACKAGE_ROOT, '../../.claude')

interface CdxgenRelease {
  version: string
  publishedAt: string
  tarballUrl: string
  changelogUrl: string
  htmlUrl: string
}

interface ParserModule {
  name: string
  ecosystem: string
  path: string
  lastModified: string
}

interface MigrationTask {
  priority: 'critical' | 'high' | 'medium' | 'low'
  ecosystem: string
  description: string
  effort: 'small' | 'medium' | 'large'
  cdxgenCommit?: string
}

/**
 * Fetch the latest cdxgen release from GitHub.
 */
async function fetchLatestCdxgenRelease(): Promise<CdxgenRelease> {
  console.log('Fetching latest cdxgen release from GitHub...')

  const apiUrl = `https://api.github.com/repos/${CDXGEN_REPO}/releases/latest`

  const response = await fetch(apiUrl, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'socket-sbom-generator',
    },
  })

  if (!response.ok) {
    throw new Error(
      `GitHub API request failed: ${response.status} ${response.statusText}`
    )
  }

  const data = await response.json()

  // Extract version (remove 'v' prefix if present).
  const version = (data.tag_name as string).replace(/^v/, '')

  return {
    version,
    publishedAt: data.published_at as string,
    tarballUrl: data.tarball_url as string,
    changelogUrl: `https://github.com/${CDXGEN_REPO}/releases/tag/${data.tag_name}`,
    htmlUrl: data.html_url as string,
  }
}

/**
 * Compare two semantic versions.
 */
function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number)
  const parts2 = v2.split('.').map(Number)

  for (let i = 0; i < 3; i++) {
    const diff = (parts1[i] || 0) - (parts2[i] || 0)
    if (diff !== 0) {
      return diff
    }
  }

  return 0
}

/**
 * Download and extract cdxgen release tarball.
 */
async function downloadCdxgenRelease(release: CdxgenRelease): Promise<string> {
  console.log(`Downloading cdxgen v${release.version}...`)

  // Create temp directory.
  const tempDir = await mkdtemp(path.join(tmpdir(), 'cdxgen-'))
  console.log(`Created temp directory: ${tempDir}`)

  try {
    // Download tarball.
    console.log('Downloading tarball...')
    const response = await fetch(release.tarballUrl)

    if (!response.ok) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`)
    }

    if (!response.body) {
      throw new Error('Response body is null')
    }

    // Extract tarball directly from stream.
    console.log('Extracting tarball...')

    // GitHub tarballs have a top-level directory (e.g., CycloneDX-cdxgen-abc1234).
    // We need to extract and find that directory.
    await extract({
      cwd: tempDir,
      // @ts-expect-error - tar types may not perfectly match Web Streams API.
      file: response.body,
    })

    // Find the extracted directory (should be only one).
    const entries = await readdir(tempDir)
    const extractedDir = entries.find(async entry => {
      const entryPath = path.join(tempDir, entry)
      const stats = await stat(entryPath)
      return stats.isDirectory()
    })

    if (!extractedDir) {
      throw new Error('Could not find extracted directory')
    }

    const cdxgenPath = path.join(tempDir, extractedDir)
    console.log(`Extracted to: ${cdxgenPath}`)

    return cdxgenPath
  } catch (e) {
    // Clean up temp directory on error.
    await fs.rm(tempDir, { recursive: true, force: true })
    throw e
  }
}

/**
 * Analyze cdxgen parser modules.
 */
async function analyzeCdxgenParsers(cdxgenPath: string): Promise<ParserModule[]> {
  console.log('Analyzing cdxgen parsers...')

  const parsersDir = path.join(cdxgenPath, 'lib/parsers')
  const modules: ParserModule[] = []

  // Mapping of cdxgen parser filenames to ecosystem names.
  const ECOSYSTEM_MAP: Record<string, string> = {
    __proto__: null,
    'js.js': 'npm',
    'python.js': 'pypi',
    'rust.js': 'cargo',
    'go.js': 'go',
    'java.js': 'maven',
    'ruby.js': 'rubygems',
    'dotnet.js': 'nuget',
    'github.js': 'actions',
  }

  try {
    const files = await readdir(parsersDir)

    for (const file of files) {
      if (!file.endsWith('.js')) {
        continue
      }

      const filePath = path.join(parsersDir, file)
      const stats = await stat(filePath)

      // Map filename to ecosystem.
      const ecosystem = ECOSYSTEM_MAP[file] || 'unknown'

      modules.push({
        name: file,
        ecosystem,
        path: filePath,
        lastModified: stats.mtime.toISOString(),
      })
    }
  } catch (e) {
    console.warn(`Warning: Could not read parsers directory: ${e}`)
    // Return empty array if directory doesn't exist.
    return []
  }

  console.log(`Found ${modules.length} parser modules`)
  return modules
}

/**
 * Compare our implementation with cdxgen parsers.
 */
async function compareImplementations(
  cdxgenParsers: ParserModule[]
): Promise<MigrationTask[]> {
  console.log('Comparing implementations...')

  const tasks: MigrationTask[] = []

  // Our implementation status.
  const OUR_PARSERS: Record<string, { implemented: boolean; score?: number }> = {
    __proto__: null,
    npm: { implemented: true, score: 95 },
    pypi: { implemented: false },
    cargo: { implemented: false },
    go: { implemented: false },
    maven: { implemented: false },
    rubygems: { implemented: false },
    nuget: { implemented: false },
    actions: { implemented: false },
    huggingface: { implemented: false },
    chrome: { implemented: false },
    openvsx: { implemented: false },
  }

  // Check for parsers in cdxgen that we haven't implemented.
  for (const parser of cdxgenParsers) {
    const { ecosystem } = parser

    if (ecosystem === 'unknown') {
      continue
    }

    const ourStatus = OUR_PARSERS[ecosystem]

    if (!ourStatus) {
      // cdxgen has a parser we don't track.
      tasks.push({
        priority: 'low',
        ecosystem,
        description: `cdxgen has ${parser.name} parser (not in our roadmap)`,
        effort: 'large',
      })
      continue
    }

    if (!ourStatus.implemented) {
      // We planned this parser but haven't implemented it yet.
      tasks.push({
        priority: 'high',
        ecosystem,
        description: `Implement ${ecosystem} parser (reference: cdxgen's ${parser.name})`,
        effort: ecosystem === 'maven' ? 'large' : 'medium',
      })
    }
  }

  // Check for implemented parsers that could be improved.
  for (const parser of cdxgenParsers) {
    const { ecosystem } = parser
    const ourStatus = OUR_PARSERS[ecosystem]

    if (ourStatus?.implemented && ourStatus.score && ourStatus.score < 98) {
      tasks.push({
        priority: 'medium',
        ecosystem,
        description: `Improve lock-step score (${ourStatus.score} → 98) by porting cdxgen improvements`,
        effort: 'small',
      })
    }
  }

  // Note: In a full implementation, we would:
  // 1. Parse cdxgen source files to identify new features.
  // 2. Compare file sizes/dates with previous baseline.
  // 3. Identify breaking changes or major refactors.
  // 4. Generate specific line-by-line diffs.

  return tasks
}

/**
 * Generate migration report markdown.
 */
function generateMigrationReport(
  currentVersion: string,
  latestRelease: CdxgenRelease,
  tasks: MigrationTask[]
): string {
  const timestamp = new Date().toISOString().split('T')[0]

  let report = `# cdxgen Migration Report\n\n`
  report += `**Generated**: ${timestamp}\n`
  report += `**Current Baseline**: v${currentVersion}\n`
  report += `**Latest cdxgen**: v${latestRelease.version}\n`
  report += `**Published**: ${latestRelease.publishedAt}\n`
  report += `**Changelog**: ${latestRelease.changelogUrl}\n\n`

  report += `---\n\n`
  report += `## Summary\n\n`

  if (compareVersions(latestRelease.version, currentVersion) <= 0) {
    report += `✅ **Up to date** - No migration needed.\n\n`
    return report
  }

  report += `⚠️ **Update available** - ${tasks.length} migration tasks identified.\n\n`

  // Group by priority.
  const byPriority = {
    critical: tasks.filter(t => t.priority === 'critical'),
    high: tasks.filter(t => t.priority === 'high'),
    medium: tasks.filter(t => t.priority === 'medium'),
    low: tasks.filter(t => t.priority === 'low'),
  }

  report += `### Priority Breakdown\n\n`
  report += `- 🔴 **Critical**: ${byPriority.critical.length} tasks\n`
  report += `- 🟠 **High**: ${byPriority.high.length} tasks\n`
  report += `- 🟡 **Medium**: ${byPriority.medium.length} tasks\n`
  report += `- 🟢 **Low**: ${byPriority.low.length} tasks\n\n`

  report += `---\n\n`
  report += `## Migration Tasks\n\n`

  for (const [priority, priorityTasks] of Object.entries(byPriority)) {
    if (priorityTasks.length === 0) {
      continue
    }

    const emoji =
      priority === 'critical'
        ? '🔴'
        : priority === 'high'
          ? '🟠'
          : priority === 'medium'
            ? '🟡'
            : '🟢'

    report += `### ${emoji} ${priority.charAt(0).toUpperCase() + priority.slice(1)} Priority\n\n`

    for (const task of priorityTasks) {
      report += `#### ${task.ecosystem}\n\n`
      report += `**Description**: ${task.description}\n\n`
      report += `**Effort**: ${task.effort}\n\n`

      if (task.cdxgenCommit) {
        report += `**Reference**: https://github.com/${CDXGEN_REPO}/commit/${task.cdxgenCommit}\n\n`
      }

      report += `---\n\n`
    }
  }

  report += `## Recommended Actions\n\n`
  report += `1. Review critical and high priority tasks immediately\n`
  report += `2. Schedule medium priority tasks for next sprint\n`
  report += `3. Consider low priority tasks for future iterations\n`
  report += `4. Update LOCK-STEP-COMPLIANCE.md after porting changes\n\n`

  return report
}

/**
 * Update LOCK-STEP-COMPLIANCE.md with new baseline version.
 */
async function updateLockStepCompliance(newVersion: string): Promise<void> {
  console.log(`Updating LOCK-STEP-COMPLIANCE.md with baseline v${newVersion}...`)

  const content = await fs.readFile(LOCK_STEP_COMPLIANCE_PATH, 'utf8')

  // Update baseline version.
  const updatedContent = content.replace(
    /\*\*Baseline Version\*\*: CycloneDX v1\.5 \+ cdxgen v[\d.]+/,
    `**Baseline Version**: CycloneDX v1.5 + cdxgen v${newVersion}`
  )

  // Update last updated date.
  const timestamp = new Date().toISOString().split('T')[0]
  const finalContent = updatedContent.replace(
    /\*\*Last Updated\*\*: \d{4}-\d{2}-\d{2}/,
    `**Last Updated**: ${timestamp}`
  )

  await fs.writeFile(LOCK_STEP_COMPLIANCE_PATH, finalContent, 'utf8')
  console.log('✓ Updated LOCK-STEP-COMPLIANCE.md')
}

/**
 * Main execution.
 */
async function main() {
  console.log('🔍 Checking for cdxgen updates...\n')

  try {
    // Parse command-line arguments.
    const args = process.argv.slice(2)
    const checkOnly = args.includes('--check-only')
    const targetVersionArg = args.find(arg => arg.startsWith('--target-version='))
    const targetVersion = targetVersionArg
      ? targetVersionArg.split('=')[1]
      : undefined

    // Fetch latest release.
    let latestRelease: CdxgenRelease

    if (targetVersion) {
      console.log(`Using target version: v${targetVersion}\n`)
      // TODO: Fetch specific version from GitHub.
      throw new Error('Target version not yet implemented')
    } else {
      latestRelease = await fetchLatestCdxgenRelease()
    }

    // Compare versions.
    const comparison = compareVersions(latestRelease.version, CURRENT_BASELINE)

    if (comparison <= 0) {
      console.log(
        `✅ Up to date! Current baseline v${CURRENT_BASELINE} is the latest.\n`
      )
      return
    }

    console.log(
      `⚠️  Update available: v${CURRENT_BASELINE} → v${latestRelease.version}\n`
    )

    if (checkOnly) {
      console.log('--check-only flag detected. Exiting without analysis.\n')
      return
    }

    // Download and extract release.
    const cdxgenPath = await downloadCdxgenRelease(latestRelease)

    // Analyze parsers.
    const cdxgenParsers = await analyzeCdxgenParsers(cdxgenPath)

    // Compare implementations.
    const tasks = await compareImplementations(cdxgenParsers)

    // Generate migration report.
    const report = generateMigrationReport(CURRENT_BASELINE, latestRelease, tasks)

    // Write migration report.
    const reportPath = path.join(
      MIGRATION_REPORT_DIR,
      'cdxgen-migration-report.md'
    )
    await fs.writeFile(reportPath, report, 'utf8')
    console.log(`\n✓ Migration report written to: ${reportPath}`)

    // Generate migration tasks.
    const tasksMarkdown = tasks
      .map(
        t =>
          `- [ ] **[${t.priority.toUpperCase()}]** ${t.ecosystem}: ${t.description} (effort: ${t.effort})`
      )
      .join('\n')

    const tasksPath = path.join(MIGRATION_REPORT_DIR, 'cdxgen-migration-tasks.md')
    await fs.writeFile(
      tasksPath,
      `# cdxgen Migration Tasks\n\n${tasksMarkdown}\n`,
      'utf8'
    )
    console.log(`✓ Migration tasks written to: ${tasksPath}`)

    // Ask user if they want to update baseline.
    console.log(
      `\n📝 Review migration tasks and update LOCK-STEP-COMPLIANCE.md manually.`
    )
    console.log(
      `   Or run: pnpm run update-from-cdxgen --update-baseline v${latestRelease.version}`
    )
  } catch (e) {
    console.error('\n❌ Error:', e instanceof Error ? e.message : String(e))
    process.exit(1)
  }
}

// Run main function.
main()
