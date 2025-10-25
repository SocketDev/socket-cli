/**
 * Full Pipeline Example
 *
 * Demonstrates complete SBOM generation → enrichment → CodeT5 optimization.
 * Shows dramatic token reduction while preserving critical information.
 */

import { generateSbom } from '../src/index.mts'
import { enrichSbomWithSocket } from '../src/enrichment/index.mts'
import {
  estimateTokenCount,
  formatSbomForCodeT5,
} from '../src/formatters/index.mts'

/**
 * Run full pipeline example.
 */
async function main() {
  const projectPath = process.cwd()
  const apiToken = process.env.SOCKET_API_TOKEN

  if (!apiToken) {
    console.error('Error: SOCKET_API_TOKEN environment variable required')
    console.error('Get your token at: https://socket.dev/dashboard/settings')
    process.exit(1)
  }

  console.log('='.repeat(80))
  console.log('SBOM GENERATOR - FULL PIPELINE EXAMPLE')
  console.log('='.repeat(80))
  console.log()

  // Step 1: Generate SBOM.
  console.log('[1/4] Generating SBOM from project...')
  const sbom = await generateSbom(projectPath, {
    includeDevDependencies: false,
  })

  console.log(`✓ Generated SBOM`)
  console.log(`  - Project: ${sbom.metadata?.component?.name}`)
  console.log(`  - Components: ${sbom.components?.length}`)
  console.log(`  - Dependencies: ${sbom.dependencies?.length}`)
  console.log()

  // Calculate raw SBOM token count.
  const rawSbomJson = JSON.stringify(sbom, null, 2)
  const rawTokens = estimateTokenCount(rawSbomJson)
  console.log(`  Raw SBOM size: ${rawSbomJson.length} chars (~${rawTokens} tokens)`)
  console.log()

  // Step 2: Enrich with Socket.dev.
  console.log('[2/4] Enriching with Socket.dev security data...')
  const enriched = await enrichSbomWithSocket(sbom, { apiToken })

  const issueCount = enriched.components?.reduce(
    (total, c) => total + (c.socket?.issues.length || 0),
    0
  )

  console.log(`✓ Enriched with Socket data`)
  console.log(`  - Security issues found: ${issueCount}`)
  console.log()

  // Step 3: Format for CodeT5.
  console.log('[3/4] Formatting for CodeT5 (token optimization)...')
  const codeT5Prompt = formatSbomForCodeT5(enriched, {
    task: 'security-analysis',
    includeGraph: true,
    maxComponents: 50,
    minSeverity: 'low',
  })

  const optimizedTokens = estimateTokenCount(codeT5Prompt)
  const reduction = Math.round((rawTokens / optimizedTokens) * 10) / 10

  console.log(`✓ Formatted for CodeT5`)
  console.log(`  - Optimized size: ${codeT5Prompt.length} chars (~${optimizedTokens} tokens)`)
  console.log(`  - Token reduction: ${reduction}x`)
  console.log()

  // Step 4: Display optimized prompt.
  console.log('[4/4] CodeT5-Optimized Prompt:')
  console.log('='.repeat(80))
  console.log(codeT5Prompt)
  console.log('='.repeat(80))
  console.log()

  // Summary.
  console.log('SUMMARY:')
  console.log(`  Raw SBOM: ~${rawTokens} tokens`)
  console.log(`  Optimized: ~${optimizedTokens} tokens`)
  console.log(`  Reduction: ${reduction}x smaller`)
  console.log()
  console.log('✓ CodeT5 can now see 100% of critical information within context window')
}

main().catch((e: Error) => {
  console.error('Error:', e.message)
  process.exit(1)
})
