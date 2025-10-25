/**
 * Basic SBOM Generation Example
 *
 * Simple example showing how to generate a CycloneDX SBOM from a project.
 * No Socket enrichment required - works immediately.
 */

import { generateSbom } from '../src/index.mts'

/**
 * Run basic SBOM generation example.
 */
async function main() {
  const projectPath = process.argv[2] || process.cwd()

  console.log('Generating SBOM for project:', projectPath)
  console.log()

  try {
    // Generate SBOM (auto-detects ecosystems).
    const sbom = await generateSbom(projectPath, {
      includeDevDependencies: false,
      deep: true,
    })

    // Display summary.
    console.log('✓ SBOM Generated Successfully')
    console.log()
    console.log('Project:', sbom.metadata?.component?.name)
    console.log('Version:', sbom.metadata?.component?.version)
    console.log('Serial Number:', sbom.serialNumber)
    console.log('Timestamp:', sbom.metadata?.timestamp)
    console.log()
    console.log('Components:', sbom.components?.length)
    console.log('Dependencies:', sbom.dependencies?.length)
    console.log()

    // Display first 5 components.
    console.log('Sample Components:')
    for (const component of sbom.components?.slice(0, 5) || []) {
      console.log(`  - ${component.name}@${component.version}`)
      if (component.licenses?.[0]?.license?.id) {
        console.log(`    License: ${component.licenses[0].license.id}`)
      }
    }
    console.log()

    // Output full SBOM as JSON.
    console.log('Full SBOM (JSON):')
    console.log(JSON.stringify(sbom, null, 2))
  } catch (e) {
    console.error('Error:', e instanceof Error ? e.message : String(e))
    process.exit(1)
  }
}

main()
